/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
	AutoSessionProvider,
	imageToTensor,
	type SessionProvider,
	type VisionImageInput,
	VisionModelStore,
	type VisionModelStoreOptions,
	type VisionSession,
	type VisionTensorInput,
	type VisionTensorOutputs,
} from "@framefields/vision";
import { assertSamLicenseAccepted } from "../license.js";
import { ensureSamModelsRegistered } from "../models/registry.js";
import { sam2Tokens } from "../sam2/memory.js";
import type { Sam2FrameResult } from "../sam2/types.js";
import { sam3DenseDecoder, sam3SupportGraphs } from "./graphs.js";
import { Sam3MemoryBank, sam3Position } from "./memory.js";
import { Sam3TextSelector, sam3Floats, sam3Run } from "./text-selector.js";
import { type Sam3Prompt, validateSam3Prompts } from "./types.js";

/** All graph and tokenizer revisions participate in ClipVision's persistent cache identity. */
export const SAM3_REVISION =
	"sam3-q4f16-429305c8-video-e942689a-support-68ce2746-text-fe8f8e12-v1";

export interface Sam3TrackerOptions extends VisionModelStoreOptions {
	readonly provider?: SessionProvider;
	readonly store?: VisionModelStore;
	readonly frameCount?: number;
	readonly textThreshold?: number;
	/** Explicitly agree to Meta's SAM License terms to download or run SAM models. */
	readonly acceptLicense?: boolean;
}

type Graph =
	| "vision_encoder"
	| "mask_decoder"
	| "dense_decoder"
	| "dense_prompt"
	| "pointer_position"
	| "memory_encoder"
	| "memory_attention";

function tensor(
	name: string,
	data: VisionTensorInput["data"],
	dims: readonly number[],
): VisionTensorInput {
	return { name, data, dims };
}

/** One explicitly selected SAM 3 instance, with full neural memory propagation on the provider. */
export class Sam3Tracker {
	private readonly sessions = new Map<Graph, VisionSession>();
	private readonly position = sam3Position();
	private bank?: Sam3MemoryBank;
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

		const store =
			options.store ??
			new VisionModelStore({
				...options,
				acceptLicense: options.acceptLicense ?? true,
			});
		const provider = options.provider ?? new AutoSessionProvider();
		const tracker = new Sam3Tracker(store, provider, options);
		try {
			tracker.sessions.set(
				"vision_encoder",
				await provider.createSession(
					await store.ensure("sam3-vision_encoder"),
					{
						externalData: [
							{
								path: "vision_encoder_q4f16.onnx_data",
								data: await store.ensure("sam3-vision_encoder-data"),
							},
						],
					},
				),
			);
			const support = sam3SupportGraphs(
				await store.ensure("sam3-support"),
				await store.ensure("sam3-support-data"),
			);
			tracker.bank = new Sam3MemoryBank(support.temporal);
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
	): Promise<Sam2FrameResult> {
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

		const { tensor: pixels } = imageToTensor(image, {
			width: 1008,
			height: 1008,
			fit: "stretch",
			channels: "rgb",
			padValue: 0,
			mean: [127.5, 127.5, 127.5],
			std: [127.5, 127.5, 127.5],
		});
		const vision = await this.run("vision_encoder", [
			tensor("pixel_values", pixels, [1, 3, 1008, 1008]),
		]);
		const raw = sam3Floats(vision, "image_embeddings.2"),
			features = prompt
				? this.initialFeatures(raw)
				: await this.condition(raw, frame);
		const points = prompt?.points ?? [{ x: 0, y: 0, label: -1 }];
		const inputs = [
			tensor(
				"feats0",
				sam3Floats(vision, "image_embeddings.0"),
				[1, 32, 288, 288],
			),
			tensor(
				"feats1",
				sam3Floats(vision, "image_embeddings.1"),
				[1, 64, 144, 144],
			),
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

		if (prompt?.text !== undefined) {
			this.selector ??= await Sam3TextSelector.create(
				this.store,
				this.provider,
			);
			if (!this.options.store) this.store.clearMemoryCache();
			const mask = await this.selector.select(
				pixels,
				prompt.text,
				this.options.textThreshold ?? 0.5,
			);
			const dense = await this.run("dense_prompt", [
				tensor("mask", mask, [1, 1, 288, 288]),
			]);
			inputs.push(
				tensor(
					"dense_prompt",
					sam3Floats(dense, "dense_prompt"),
					[1, 256, 72, 72],
				),
			);
		}

		const decoded = await this.run(
			prompt?.text !== undefined ? "dense_decoder" : "mask_decoder",
			inputs,
		);
		await this.remember(raw, decoded, frame, prompt !== undefined);
		this.lastFrame = frame;
		const score = sam3Floats(decoded, "object_score_logits")[0] ?? -Infinity;
		return {
			mask: sam3Mask(
				sam3Floats(decoded, "high_res_masks"),
				image.width,
				image.height,
				score,
			),
			width: image.width,
			height: image.height,
			score,
			iou: Math.max(...sam3Floats(decoded, "iou_scores")),
		};
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
	): Promise<Float32Array> {
		const bank = this.bank?.assemble(frame, this.options.frameCount ?? 16);
		if (!bank) throw new Error("Missing SAM 3 memory bank.");
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
		raw: Float32Array,
		decoded: VisionTensorOutputs,
		frame: number,
		prompted: boolean,
	): Promise<void> {
		const memory = await this.run("memory_encoder", [
			tensor("vision_features", raw, [1, 256, 72, 72]),
			tensor(
				"pred_masks_high_res",
				sam3Floats(decoded, "high_res_masks"),
				[1, 1, 1008, 1008],
			),
			tensor(
				"object_score_logits",
				sam3Floats(decoded, "object_score_logits"),
				[1, 1],
			),
			tensor("is_mask_from_pts", new Uint8Array([prompted ? 1 : 0]), [1]),
		]);
		this.bank?.remember(
			{
				frame,
				tokens: sam3Floats(memory, "memory_tokens").slice(),
				positions: sam3Floats(memory, "memory_pos_enc").slice(),
				pointer: sam3Floats(decoded, "object_pointer").slice(),
			},
			prompted,
		);
	}

	release(): void {
		for (const session of this.sessions.values()) session.release();
		this.sessions.clear();
		this.selector?.release();
		this.bank = undefined;
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
