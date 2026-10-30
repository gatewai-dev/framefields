/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
	imageToTensor,
	type SessionProvider,
	type VisionImageInput,
	type VisionModelStore,
	type VisionSession,
} from "@framefields/vision";
import { type Sam3Precision, sam3EncoderFiles } from "../models/registry.js";
import { sam3Floats, sam3Run } from "./text-selector.js";

/** One frame through the SAM 3 image encoder. */
export interface Sam3Features {
	/** The 1008² preprocessed input (the text selector reuses it). */
	readonly pixels: Float32Array;
	readonly feats0: Float32Array;
	readonly feats1: Float32Array;
	/** Lowest-resolution features, conditioned on memory per object. */
	readonly raw: Float32Array;
}

/** A tracker's hold on the shared encoder. */
export interface Sam3EncoderHandle {
	encode(image: VisionImageInput): Promise<Sam3Features>;
	release(): void;
}

/** Frames kept: clips of one source ask for the same frame back to back. */
const RECENT = 2;

/**
 * The encoder is most of SAM 3's per-frame cost (3.6 s at fp16 on an M1 Pro), and every
 * clip of a source sees identical pixels. So trackers on one provider and precision share
 * one session and the features of the last frames, keyed by pixel content.
 */
class SharedEncoder {
	private users = 0;
	private readonly recent: { key: string; features: Promise<Sam3Features> }[] =
		[];

	constructor(
		private readonly session: VisionSession,
		private readonly forget: () => void,
	) {}

	hold(): Sam3EncoderHandle {
		this.users++;
		let held = true;
		return {
			encode: (image) => this.encode(image),
			release: () => {
				if (!held) return;
				held = false;
				if (--this.users > 0) return;
				this.forget();
				this.recent.length = 0;
				this.session.release();
			},
		};
	}

	private encode(image: VisionImageInput): Promise<Sam3Features> {
		const key = frameKey(image);
		const hit = this.recent.find((entry) => entry.key === key);
		if (hit) return hit.features;
		const entry = { key, features: this.run(image) };
		this.recent.push(entry);
		if (this.recent.length > RECENT) this.recent.shift();
		entry.features.catch(() => {
			const index = this.recent.indexOf(entry);
			if (index >= 0) this.recent.splice(index, 1);
		});
		return entry.features;
	}

	private async run(image: VisionImageInput): Promise<Sam3Features> {
		const { tensor: pixels } = imageToTensor(image, {
			width: 1008,
			height: 1008,
			fit: "stretch",
			channels: "rgb",
			padValue: 0,
			mean: [127.5, 127.5, 127.5],
			std: [127.5, 127.5, 127.5],
		});
		const out = await sam3Run(this.session, [
			{ name: "pixel_values", data: pixels, dims: [1, 3, 1008, 1008] },
		]);
		return {
			pixels,
			feats0: sam3Floats(out, "image_embeddings.0"),
			feats1: sam3Floats(out, "image_embeddings.1"),
			raw: sam3Floats(out, "image_embeddings.2"),
		};
	}
}

const shared = new WeakMap<
	SessionProvider,
	Map<Sam3Precision, Promise<SharedEncoder>>
>();

/** Holds the process's SAM 3 encoder for `provider` at `precision`, creating it on first use. */
export async function holdSam3Encoder(
	store: VisionModelStore,
	provider: SessionProvider,
	precision: Sam3Precision,
): Promise<Sam3EncoderHandle> {
	let byPrecision = shared.get(provider);
	if (!byPrecision) {
		byPrecision = new Map();
		shared.set(provider, byPrecision);
	}
	const encoders = byPrecision;
	let encoder = encoders.get(precision);
	if (!encoder) {
		encoder = (async () => {
			const session = await provider.createSession(
				await store.ensure(`sam3-vision_encoder-${precision}`),
				{
					externalData: [
						{
							path: sam3EncoderFiles(precision).data,
							data: await store.ensure(`sam3-vision_encoder-${precision}-data`),
						},
					],
				},
			);
			return new SharedEncoder(session, () => encoders.delete(precision));
		})();
		encoders.set(precision, encoder);
		encoder.catch(() => encoders.delete(precision));
	}
	return (await encoder).hold();
}

/** Content key of a frame: size plus two 32-bit FNV-1a hashes over its bytes. */
function frameKey(image: VisionImageInput): string {
	const bytes = image.data;
	let a = 0x811c9dc5,
		b = 0x01000193 ^ bytes.length;
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i] ?? 0;
		a = Math.imul(a ^ byte, 0x01000193);
		b = Math.imul(b ^ byte, 0x5bd1e995) ^ (b >>> 15);
	}
	return `${image.width}x${image.height}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
