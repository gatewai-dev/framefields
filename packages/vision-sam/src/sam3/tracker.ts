/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
	createDefaultSessionProvider,
	type SessionProvider,
	sessionCompute,
	type VisionImageInput,
	VisionModelStore,
	type VisionModelStoreOptions,
	type VisionSession,
	type VisionTensorInput,
	type VisionTensorOutputs,
} from "@framefields/vision";
import { assertSamLicenseAccepted } from "../license.js";
import {
	ensureSamModelsRegistered,
	SAM3_ENCODER,
	type Sam3Precision,
} from "../models/registry.js";
import { sam2Tokens } from "../sam2/memory.js";
import type { Sam2Point } from "../sam2/types.js";
import { holdSam3Encoder, type Sam3EncoderHandle } from "./encoder.js";
import { sam3DenseDecoder, sam3SupportGraphs } from "./graphs.js";
import { Sam3MemoryBank, sam3Position } from "./memory.js";
import { Sam3TextSelector, sam3Floats, sam3Run } from "./text-selector.js";
import {
	type Sam3FrameResult,
	type Sam3ObjectResult,
	type Sam3Prompt,
	validateSam3Prompts,
} from "./types.js";

/** Every graph and tokenizer revision, and the encoder precision: ClipVision's cache identity. */
export function sam3Revision(precision: Sam3Precision): string {
	return `sam3-${precision}-429305c8-video-e942689a-support-68ce2746-text-fe8f8e12-v2`;
}

/** The encoder precision a tracker on `provider` uses: the override, else the backend's best. */
export async function sam3Precision(
	provider: SessionProvider = createDefaultSessionProvider(),
	override?: Sam3Precision,
): Promise<Sam3Precision> {
	return override ?? SAM3_ENCODER[await sessionCompute(provider)];
}

export interface Sam3TrackerOptions extends VisionModelStoreOptions {
	readonly provider?: SessionProvider;
	readonly store?: VisionModelStore;
	readonly frameCount?: number;
	readonly textThreshold?: number;
	/** Most instances a text prompt selects. Default 1. */
	readonly maxObjects?: number;
	/** Image-encoder weights; defaults to the fastest for the provider's backend (`SAM3_ENCODER`). */
	readonly precision?: Sam3Precision;
	/** Explicitly agree to Meta's SAM License terms to download or run SAM models. */
	readonly acceptLicense?: boolean;
}

type Graph =
	| "mask_decoder"
	| "dense_decoder"
	| "dense_prompt"
	| "pointer_position"
	| "memory_encoder"
	| "memory_attention";

/** How an object is (re)seeded on a prompted frame. */
interface Seed {
	readonly points?: readonly Sam2Point[];
	readonly dense?: Float32Array;
	/**
	 * A mask seed's own 1008² logits (±10). Like SAM's `_use_mask_as_output`, the seed
	 * frame outputs and remembers the given mask; the decoder only supplies its pointer.
	 */
	readonly mask?: Float32Array;
}

/** Logit SAM uses for a given mask's pixels (and its object score): ±10. */
const MASK_LOGIT = 10;

function tensor(
	name: string,
	data: VisionTensorInput["data"],
	dims: readonly number[],
): VisionTensorInput {
	return { name, data, dims };
}

/**
 * Explicitly selected SAM 3 instances with full neural memory propagation on the provider.
 * The image encoder runs once per frame; each object keeps its own memory bank.
 */
export class Sam3Tracker {
	private readonly sessions = new Map<Graph, VisionSession>();
	private encoder?: Sam3EncoderHandle;
	private readonly position = sam3Position();
	private readonly banks: Sam3MemoryBank[] = [];
	private temporal?: Float32Array;
	private noMemory?: Float32Array;
	private selector?: Sam3TextSelector;
	private lastFrame = -1;
	private released = false;

	private constructor(
		private readonly store: VisionModelStore,
		private readonly provider: SessionProvider,
		private readonly options: Sam3TrackerOptions,
	) {}

	static async create(options: Sam3TrackerOptions = {}): Promise<Sam3Tracker> {
		assertSamLicenseAccepted("SAM 3 / 3.1", options);
		ensureSamModelsRegistered();
		if (
			options.frameCount !== undefined &&
			(!Number.isSafeInteger(options.frameCount) || options.frameCount < 1)
		)
			throw new Error("SAM 3 frameCount must be a positive integer.");
		if (
			options.textThreshold !== undefined &&
			(!Number.isFinite(options.textThreshold) ||
				options.textThreshold <= 0 ||
				options.textThreshold >= 1)
		)
			throw new Error("SAM 3 textThreshold must be between zero and one.");
		if (
			options.maxObjects !== undefined &&
			(!Number.isSafeInteger(options.maxObjects) || options.maxObjects < 1)
		)
			throw new Error("SAM 3 maxObjects must be a positive integer.");

		const store =
			options.store ??
			new VisionModelStore({
				...options,
				acceptLicense: options.acceptLicense ?? true,
			});
		const provider = options.provider ?? createDefaultSessionProvider();
		const tracker = new Sam3Tracker(store, provider, options);
		try {
			tracker.encoder = await holdSam3Encoder(
				store,
				provider,
				await sam3Precision(provider, options.precision),
			);
			const support = sam3SupportGraphs(
				await store.ensure("sam3-support"),
				await store.ensure("sam3-support-data"),
			);
			tracker.temporal = support.temporal;
			tracker.noMemory = support.noMemory;
			tracker.sessions.set(
				"dense_prompt",
				await provider.createSession(support.densePrompt),
			);
			tracker.sessions.set(
				"pointer_position",
				await provider.createSession(support.pointerPosition),
			);
			const decoder = await store.ensure("sam3-mask_decoder");
			tracker.sessions.set(
				"mask_decoder",
				await provider.createSession(decoder),
			);
			tracker.sessions.set(
				"dense_decoder",
				await provider.createSession(sam3DenseDecoder(decoder)),
			);
			for (const graph of ["memory_encoder", "memory_attention"] as const)
				tracker.sessions.set(
					graph,
					await provider.createSession(await store.ensure(`sam3-${graph}`)),
				);
			if (!options.store) store.clearMemoryCache();
			return tracker;
		} catch (error) {
			tracker.release();
			throw error;
		}
	}

	private run(
		graph: Graph,
		inputs: readonly VisionTensorInput[],
	): Promise<VisionTensorOutputs> {
		const session = this.sessions.get(graph);
		if (!session) throw new Error("SAM 3 tracker has been released.");
		return sam3Run(session, inputs);
	}

	async process(
		image: VisionImageInput,
		frame: number,
		prompt?: Omit<Sam3Prompt, "frame">,
	): Promise<Sam3FrameResult> {
		if (this.released) throw new Error("SAM 3 tracker has been released.");
		if (
			!Number.isSafeInteger(frame) ||
			frame < 0 ||
			(this.lastFrame >= 0 && frame !== this.lastFrame + 1)
		)
			throw new Error("SAM 3 propagation requires consecutive source frames.");
		if (prompt) validateSam3Prompts({ prompts: [{ ...prompt, frame }] });
		if (this.lastFrame < 0 && !prompt)
			throw new Error("SAM 3 needs a prompt on its first frame.");

		if (!this.encoder) throw new Error("SAM 3 tracker has been released.");
		const { pixels, feats0, feats1, raw } = await this.encoder.encode(image);
		const shared = [
			tensor("feats0", feats0, [1, 32, 288, 288]),
			tensor("feats1", feats1, [1, 64, 144, 144]),
		];
		const seeds = await this.seeds(pixels, prompt);
		const objects: Sam3ObjectResult[] = [];
		for (const [index, bank] of this.banks.entries()) {
			const seed = seeds.get(index);
			const features = seed
				? this.initialFeatures(raw)
				: await this.condition(raw, frame, bank);
			const decoded = await this.decode(shared, features, seed);
			const logits = seed?.mask ?? sam3Floats(decoded, "high_res_masks");
			const score = seed?.mask
				? MASK_LOGIT
				: (sam3Floats(decoded, "object_score_logits")[0] ?? -Infinity);
			await this.remember(bank, raw, decoded, frame, seed, logits, score);
			objects.push({
				id: index + 1,
				mask: sam3Mask(logits, image.width, image.height, score),
				score,
				iou: seed?.mask ? 1 : Math.max(...sam3Floats(decoded, "iou_scores")),
			});
		}
		this.lastFrame = frame;
		return { width: image.width, height: image.height, objects };
	}

	/** Objects a prompt (re)seeds, by index. Text re-selects every object; points address one. */
	private async seeds(
		pixels: Float32Array,
		prompt?: Omit<Sam3Prompt, "frame">,
	): Promise<Map<number, Seed>> {
		const seeds = new Map<number, Seed>();
		if (prompt?.points) {
			const index = (prompt.object ?? 1) - 1;
			if (index > this.banks.length)
				throw new Error(
					`SAM 3 prompt object ${index + 1} skips track IDs; the next new ID is ${this.banks.length + 1}.`,
				);
			if (index === this.banks.length) this.banks.push(this.newBank());
			seeds.set(index, { points: prompt.points });
		}
		if (prompt?.text !== undefined) {
			this.selector ??= await Sam3TextSelector.create(
				this.store,
				this.provider,
			);
			if (!this.options.store) this.store.clearMemoryCache();
			const masks = await this.selector.select(
				pixels,
				prompt.text,
				this.options.textThreshold ?? 0.5,
				this.options.maxObjects ?? 1,
			);
			this.banks.length = 0;
			for (const [index, logits] of masks.entries()) {
				this.banks.push(this.newBank());
				const binary = Float32Array.from(logits, (v) => (v > 0 ? 1 : 0));
				const dense = await this.run("dense_prompt", [
					tensor("mask", binary, [1, 1, 288, 288]),
				]);
				seeds.set(index, {
					dense: sam3Floats(dense, "dense_prompt"),
					mask: seedLogits(logits),
				});
			}
		}
		return seeds;
	}

	private newBank(): Sam3MemoryBank {
		if (!this.temporal) throw new Error("SAM 3 tracker has been released.");
		return new Sam3MemoryBank(this.temporal);
	}

	private decode(
		shared: readonly VisionTensorInput[],
		features: Float32Array,
		seed?: Seed,
	): Promise<VisionTensorOutputs> {
		const points = seed?.points ?? [{ x: 0, y: 0, label: -1 }];
		const inputs = [
			...shared,
			tensor("feats2", features, [1, 256, 72, 72]),
			tensor(
				"input_points",
				Float32Array.from(points.flatMap((p) => [p.x * 1008, p.y * 1008])),
				[1, 1, points.length, 2],
			),
			tensor("input_labels", Int32Array.from(points.map((p) => p.label)), [
				1,
				1,
				points.length,
			]),
		];
		if (!seed?.dense) return this.run("mask_decoder", inputs);
		return this.run("dense_decoder", [
			...inputs,
			tensor("dense_prompt", seed.dense, [1, 256, 72, 72]),
		]);
	}

	private initialFeatures(raw: Float32Array): Float32Array {
		if (!this.noMemory) throw new Error("Missing SAM 3 no-memory embedding.");
		return Float32Array.from(
			raw,
			(value, i) => value + (this.noMemory?.[Math.floor(i / 5184)] ?? 0),
		);
	}

	private async condition(
		raw: Float32Array,
		frame: number,
		memory: Sam3MemoryBank,
	): Promise<Float32Array> {
		const bank = memory.assemble(frame, this.options.frameCount ?? 16);
		const positions = await this.run("pointer_position", [
			tensor("encoding", bank.encoding, [16, 256]),
		]);
		const pointerPosition = new Float32Array(bank.pointerCount * 256),
			projected = sam3Floats(positions, "position");
		for (let i = 0; i < bank.pointerCount; i++)
			for (let token = 0; token < 4; token++)
				pointerPosition.set(
					projected.subarray(i * 64, (i + 1) * 64),
					(i * 4 + token) * 64,
				);
		const result = await this.run("memory_attention", [
			tensor("current_vision_features", sam2Tokens(raw), [5184, 1, 256]),
			tensor(
				"current_vision_position_embeddings",
				this.position,
				[5184, 1, 256],
			),
			tensor("spatial_memory", bank.spatial, [bank.spatial.length / 64, 1, 64]),
			tensor("spatial_memory_position_embeddings", bank.positions, [
				bank.positions.length / 64,
				1,
				64,
			]),
			tensor("pointer_memory", bank.pointers, [bank.pointerCount * 4, 1, 64]),
			tensor("pointer_memory_position_embeddings", pointerPosition, [
				bank.pointerCount * 4,
				1,
				64,
			]),
		]);
		const tokens = sam3Floats(result, "conditioned_features"),
			nchw = new Float32Array(tokens.length);
		for (let i = 0; i < 5184; i++)
			for (let channel = 0; channel < 256; channel++)
				nchw[channel * 5184 + i] = tokens[i * 256 + channel] ?? 0;
		return nchw;
	}

	private async remember(
		bank: Sam3MemoryBank,
		raw: Float32Array,
		decoded: VisionTensorOutputs,
		frame: number,
		seed: Seed | undefined,
		logits: Float32Array,
		score: number,
	): Promise<void> {
		const memory = await this.run("memory_encoder", [
			tensor("vision_features", raw, [1, 256, 72, 72]),
			tensor("pred_masks_high_res", logits, [1, 1, 1008, 1008]),
			tensor("object_score_logits", Float32Array.of(score), [1, 1]),
			tensor("is_mask_from_pts", new Uint8Array([seed ? 1 : 0]), [1]),
		]);
		bank.remember(
			{
				frame,
				tokens: sam3Floats(memory, "memory_tokens").slice(),
				positions: sam3Floats(memory, "memory_pos_enc").slice(),
				pointer: sam3Floats(decoded, "object_pointer").slice(),
			},
			seed !== undefined,
		);
	}

	release(): void {
		for (const session of this.sessions.values()) session.release();
		this.sessions.clear();
		this.encoder?.release();
		this.encoder = undefined;
		this.selector?.release();
		this.banks.length = 0;
		this.temporal = undefined;
		this.noMemory = undefined;
		this.released = true;
	}
}

/** Resize logits before thresholding; source pixels are the public mask coordinate system. */
export function sam3Mask(
	logits: Float32Array,
	width: number,
	height: number,
	score: number,
): Uint8Array {
	if (logits.length !== 1008 * 1008)
		throw new Error("Invalid SAM 3 high-resolution mask shape.");
	const mask = new Uint8Array(width * height);
	if (score <= 0) return mask;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const sy = Math.max(0, Math.min(1007, ((y + 0.5) * 1008) / height - 0.5)),
				sx = Math.max(0, Math.min(1007, ((x + 0.5) * 1008) / width - 0.5));
			const y0 = Math.floor(sy),
				x0 = Math.floor(sx),
				fy = sy - y0,
				fx = sx - x0,
				y1 = Math.min(1007, y0 + 1),
				x1 = Math.min(1007, x0 + 1);
			const top =
					(logits[y0 * 1008 + x0] ?? 0) * (1 - fx) +
					(logits[y0 * 1008 + x1] ?? 0) * fx,
				bottom =
					(logits[y1 * 1008 + x0] ?? 0) * (1 - fx) +
					(logits[y1 * 1008 + x1] ?? 0) * fx;
			mask[y * width + x] = top * (1 - fy) + bottom * fy > 0 ? 255 : 0;
		}
	return mask;
}

/** A 288² concept mask's logits as SAM's 1008² seed logits: bilinear, then ±10. */
function seedLogits(logits: Float32Array): Float32Array {
	const out = new Float32Array(1008 * 1008);
	for (let y = 0; y < 1008; y++) {
		const sy = Math.max(0, Math.min(287, ((y + 0.5) * 288) / 1008 - 0.5)),
			y0 = Math.floor(sy),
			y1 = Math.min(287, y0 + 1),
			fy = sy - y0;
		for (let x = 0; x < 1008; x++) {
			const sx = Math.max(0, Math.min(287, ((x + 0.5) * 288) / 1008 - 0.5)),
				x0 = Math.floor(sx),
				x1 = Math.min(287, x0 + 1),
				fx = sx - x0;
			const top =
					(logits[y0 * 288 + x0] ?? 0) * (1 - fx) +
					(logits[y0 * 288 + x1] ?? 0) * fx,
				bottom =
					(logits[y1 * 288 + x0] ?? 0) * (1 - fx) +
					(logits[y1 * 288 + x1] ?? 0) * fx;
			out[y * 1008 + x] =
				top * (1 - fy) + bottom * fy > 0 ? MASK_LOGIT : -MASK_LOGIT;
		}
	}
	return out;
}
