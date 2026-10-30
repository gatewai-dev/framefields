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
	type VisionTensor,
	type VisionTensorInput,
	type VisionTensorOutputs,
} from "@framefields/vision";
import { z } from "zod";
import { assertSamLicenseAccepted } from "../license.js";
import { ensureSamModelsRegistered } from "../models/registry.js";
import { Sam2MemoryBank, sam2Tokens } from "./memory.js";
import {
	type Sam2FrameResult,
	type Sam2Point,
	validateSam2Prompts,
} from "./types.js";

const constantsSchema = z.object({
	image_size: z.literal(512),
	memory_frames: z.literal(7),
	image_mean: z.tuple([z.number(), z.number(), z.number()]),
	image_std: z.tuple([
		z.number().positive(),
		z.number().positive(),
		z.number().positive(),
	]),
	memory_temporal_positional_encoding: z
		.array(z.array(z.number()).length(64))
		.length(7),
});
type Constants = z.infer<typeof constantsSchema>;
type Graph =
	| "vision_encoder"
	| "mask_decoder"
	| "memory_encoder"
	| "memory_attention"
	| "pointer_tpos";
const GRAPHS: readonly Graph[] = [
	"vision_encoder",
	"mask_decoder",
	"memory_encoder",
	"memory_attention",
	"pointer_tpos",
];
export const SAM2_TINY_REVISION = "66673b5db39371b7dd7847f4d3bc0d4f4179b79e";

export interface Sam2TrackerOptions extends VisionModelStoreOptions {
	readonly provider?: SessionProvider;
	readonly store?: VisionModelStore;
	/** Source sequence length; used to normalize object-pointer time positions for short videos. */
	readonly frameCount?: number;
	/** Explicitly agree to Meta's SAM License terms to download or run SAM models. */
	readonly acceptLicense?: boolean;
}

function floats(outputs: VisionTensorOutputs, name: string): Float32Array {
	const tensor = outputs[name];
	if (!tensor || !(tensor.data instanceof Float32Array))
		throw new Error(`Missing SAM 2 float output: ${name}`);
	return tensor.data;
}
function input(name: string, tensor: VisionTensor): VisionTensorInput {
	if (tensor.data instanceof BigInt64Array)
		throw new Error(`Unsupported SAM 2 input type: ${name}`);
	return { name, data: tensor.data, dims: tensor.dims };
}
function tensor(
	name: string,
	data: Float32Array | Int32Array,
	dims: readonly number[],
): VisionTensorInput {
	return { name, data, dims };
}

/** Complete pinned 512px SAM 2.1 Tiny video graph pipeline, one explicitly selected object. */
export class Sam2Tracker {
	private readonly sessions = new Map<Graph, VisionSession>();
	private readonly bank: Sam2MemoryBank;
	private lastFrame = -1;
	private released = false;
	private constructor(
		private readonly constants: Constants,
		private readonly frameCount = 16,
	) {
		this.bank = new Sam2MemoryBank(
			constants.memory_temporal_positional_encoding,
		);
	}

	static async create(options: Sam2TrackerOptions = {}): Promise<Sam2Tracker> {
		assertSamLicenseAccepted("SAM 2.1", options);
		ensureSamModelsRegistered();
		const store =
			options.store ??
			new VisionModelStore({
				...options,
				acceptLicense: options.acceptLicense ?? true,
			});
		const bytes = await store.ensure("sam2.1-tiny-constants");
		const constants = constantsSchema.parse(
			JSON.parse(new TextDecoder().decode(bytes)),
		);
		if (
			options.frameCount !== undefined &&
			(!Number.isSafeInteger(options.frameCount) || options.frameCount < 1)
		)
			throw new Error("SAM 2 frameCount must be a positive integer.");
		const tracker = new Sam2Tracker(constants, options.frameCount);
		const provider = options.provider ?? new AutoSessionProvider();
		try {
			for (const graph of GRAPHS) {
				const session = await provider.createSession(
					await store.ensure(`sam2.1-tiny-${graph}`),
				);
				tracker.sessions.set(graph, session);
			}
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
		if (!session) throw new Error("SAM 2 tracker has been released.");
		if (session.runMany) return session.runMany(inputs);
		if (inputs.length === 1 && inputs[0]) return session.run(inputs[0]);
		throw new Error("SAM 2 requires a session provider with runMany support.");
	}

	async process(
		image: VisionImageInput,
		frame: number,
		points?: readonly Sam2Point[],
	): Promise<Sam2FrameResult> {
		if (this.released) throw new Error("SAM 2 tracker has been released.");
		if (
			!Number.isSafeInteger(frame) ||
			frame < 0 ||
			(this.lastFrame >= 0 && frame !== this.lastFrame + 1)
		)
			throw new Error("SAM 2 propagation requires consecutive source frames.");
		if (points) validateSam2Prompts([{ frame, points }]);
		if (this.lastFrame < 0 && !points)
			throw new Error("SAM 2 needs a prompt on its first frame.");
		const { tensor: pixels } = imageToTensor(image, {
			width: 512,
			height: 512,
			fit: "stretch",
			channels: "rgb",
			padValue: 0,
			mean: this.constants.image_mean.map((v) => v * 255) as [
				number,
				number,
				number,
			],
			std: this.constants.image_std.map((v) => v * 255) as [
				number,
				number,
				number,
			],
		});
		const vision = await this.run("vision_encoder", [
			tensor("pixel_values", pixels, [1, 3, 512, 512]),
		]);
		const conditioned = points
			? vision.feats2_no_mem
			: await this.condition(vision, frame);
		if (!conditioned || !vision.feats0 || !vision.feats1)
			throw new Error("Invalid SAM 2 vision outputs.");
		const prompt = points ?? [{ x: 0, y: 0, label: -1 }];
		const decoded = await this.run("mask_decoder", [
			input("feats0", vision.feats0),
			input("feats1", vision.feats1),
			input("feats2_cond", conditioned),
			tensor(
				"input_points",
				Float32Array.from(prompt.flatMap((p) => [p.x * 512, p.y * 512])),
				[1, 1, prompt.length, 2],
			),
			tensor("input_labels", Int32Array.from(prompt.map((p) => p.label)), [
				1,
				1,
				prompt.length,
			]),
		]);
		await this.remember(vision, decoded, frame, points !== undefined);
		this.lastFrame = frame;
		return decodeSam2Mask(
			floats(decoded, "high_res_mask"),
			image.width,
			image.height,
			floats(decoded, "object_score_logits")[0] ?? -Infinity,
			floats(decoded, "iou")[0] ?? 0,
		);
	}

	private async condition(
		vision: VisionTensorOutputs,
		frame: number,
	): Promise<VisionTensor> {
		const bank = this.bank.assemble(frame, this.frameCount);
		const pointer = await this.run("pointer_tpos", [
			tensor("normalized_diffs", bank.distances, [16]),
		]);
		const positions = floats(pointer, "pointer_pos");
		for (let i = 0; i < 16; i++)
			for (let token = 0; token < 4; token++)
				bank.positions.set(
					positions.subarray(i * 64, (i + 1) * 64),
					7 * 1024 * 64 + (i * 4 + token) * 64,
				);
		const result = await this.run("memory_attention", [
			tensor(
				"current_vision_features",
				sam2Tokens(floats(vision, "feats2")),
				[1024, 1, 256],
			),
			tensor(
				"current_vision_position_embeddings",
				sam2Tokens(floats(vision, "vision_pos_embed")),
				[1024, 1, 256],
			),
			tensor("memory", bank.memory, [7232, 1, 64]),
			tensor("memory_pos", bank.positions, [7232, 1, 64]),
		]);
		const conditioned = result.conditioned_feats;
		if (!conditioned) throw new Error("Missing SAM 2 conditioned features.");
		return conditioned;
	}

	private async remember(
		vision: VisionTensorOutputs,
		decoded: VisionTensorOutputs,
		frame: number,
		prompted: boolean,
	): Promise<void> {
		if (!vision.feats2 || !decoded.high_res_mask)
			throw new Error("Invalid SAM 2 memory inputs.");
		const memory = await this.run("memory_encoder", [
			input("feats2", vision.feats2),
			input("high_res_mask", decoded.high_res_mask),
			tensor(
				"object_score_logits",
				floats(decoded, "object_score_logits"),
				[1, 1],
			),
			tensor("binarize", new Float32Array([prompted ? 1 : 0]), []),
		]);
		this.bank.remember(
			{
				frame,
				tokens: floats(memory, "memory_tokens").slice(),
				positions: floats(memory, "memory_pos").slice(),
				pointer: floats(decoded, "object_pointer").slice(),
			},
			prompted,
		);
	}

	release(): void {
		for (const session of this.sessions.values()) session.release();
		this.sessions.clear();
		this.released = true;
	}
}

/** Bilinear resize of logits before thresholding, matching SAM's source-image mask contract. */
export function decodeSam2Mask(
	logits: Float32Array,
	width: number,
	height: number,
	score: number,
	iou: number,
): Sam2FrameResult {
	if (logits.length !== 512 * 512) throw new Error("Invalid SAM 2 mask shape.");
	const mask = new Uint8Array(width * height);
	if (score > 0) {
		for (let y = 0; y < height; y++) {
			const sy = Math.max(0, Math.min(511, ((y + 0.5) * 512) / height - 0.5));
			const y0 = Math.floor(sy),
				y1 = Math.min(511, y0 + 1),
				fy = sy - y0;
			for (let x = 0; x < width; x++) {
				const sx = Math.max(0, Math.min(511, ((x + 0.5) * 512) / width - 0.5));
				const x0 = Math.floor(sx),
					x1 = Math.min(511, x0 + 1),
					fx = sx - x0;
				const a =
					(logits[y0 * 512 + x0] ?? 0) * (1 - fx) +
					(logits[y0 * 512 + x1] ?? 0) * fx;
				const b =
					(logits[y1 * 512 + x0] ?? 0) * (1 - fx) +
					(logits[y1 * 512 + x1] ?? 0) * fx;
				mask[y * width + x] = a * (1 - fy) + b * fy > 0 ? 255 : 0;
			}
		}
	}
	return { mask, width, height, score, iou };
}
