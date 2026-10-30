/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
	SessionProvider,
	VisionModelStore,
	VisionSession,
	VisionTensorInput,
	VisionTensorOutputs,
} from "@framefields/vision";
import { Tokenizer } from "@huggingface/tokenizers";

export function sam3Floats(
	outputs: VisionTensorOutputs,
	name: string,
): Float32Array {
	const value = outputs[name];
	if (!(value?.data instanceof Float32Array))
		throw new Error(`Missing SAM 3 float output ${name}`);
	return value.data;
}

export async function sam3Run(
	session: VisionSession,
	inputs: readonly VisionTensorInput[],
): Promise<VisionTensorOutputs> {
	if (!session.runMany)
		throw new Error("SAM 3 requires a session provider with runMany support.");
	return session.runMany(inputs);
}

/** Semantic model is separate from the visual tracker and loads only for text prompts. */
export class Sam3TextSelector {
	private readonly sessions: VisionSession[] = [];
	private constructor(private readonly tokenizer: Tokenizer) {}

	static async create(
		store: VisionModelStore,
		provider: SessionProvider,
	): Promise<Sam3TextSelector> {
		const json = async (
			key: "sam3-tokenizer" | "sam3-tokenizer-config",
		): Promise<object> =>
			JSON.parse(new TextDecoder().decode(await store.ensure(key)));
		const selector = new Sam3TextSelector(
			new Tokenizer(
				await json("sam3-tokenizer"),
				await json("sam3-tokenizer-config"),
			),
		);
		try {
			selector.sessions.push(
				await provider.createSession(
					await store.ensure("sam3-text-vision_encoder"),
					{
						externalData: [
							{
								path: "vision_encoder_int4_fp16attn.onnx.data",
								data: await store.ensure("sam3-text-vision_encoder-data"),
							},
						],
					},
				),
			);
			for (const key of ["sam3-text-encoder", "sam3-text-decoder"] as const)
				selector.sessions.push(
					await provider.createSession(await store.ensure(key)),
				);
			return selector;
		} catch (error) {
			selector.release();
			throw error;
		}
	}

	/**
	 * Masks (288², binary) of the instances matching `text` with sigmoid score of at least
	 * `threshold`, best first and at most `max`. Queries that repeat an accepted instance
	 * (mask IoU above 0.5) are skipped.
	 */
	async select(
		pixels: Float32Array,
		text: string,
		threshold: number,
		max = 1,
	): Promise<Float32Array[]> {
		const [visionSession, textSession, decoder] = this.sessions;
		if (!visionSession || !textSession || !decoder)
			throw new Error("SAM 3 text selector has been released.");
		const tokens: readonly number[] = this.tokenizer.encode(text).ids;
		if (tokens.length > 32)
			throw new Error("SAM 3 text prompts must fit within 32 CLIP tokens.");
		const ids = new BigInt64Array(32).fill(49407n),
			mask = new BigInt64Array(32);
		tokens.forEach((id, i) => {
			ids[i] = BigInt(id);
			mask[i] = 1n;
		});
		const encoded = await sam3Run(textSession, [
			{ name: "input_ids", data: ids, dims: [1, 32] },
			{ name: "attention_mask", data: mask, dims: [1, 32] },
		]);
		const vision = await sam3Run(visionSession, [
			{ name: "pixel_values", data: pixels, dims: [1, 3, 1008, 1008] },
		]);
		const inputs: VisionTensorInput[] = [
			{
				name: "text_features",
				data: sam3Floats(encoded, "text_features"),
				dims: [1, 32, 256],
			},
			{ name: "attention_mask", data: mask, dims: [1, 32] },
		];
		for (const name of [
			"fpn_hidden_state_0",
			"fpn_hidden_state_1",
			"fpn_hidden_state_2",
			"fpn_position_encoding_2",
		]) {
			const value = vision[name];
			if (!value) throw new Error(`Missing SAM 3 concept feature ${name}`);
			inputs.push({ name, data: sam3Floats(vision, name), dims: value.dims });
		}
		const result = await sam3Run(decoder, inputs),
			scores = sam3Floats(result, "pred_logits"),
			masks = sam3Floats(result, "pred_masks");
		if (masks.length !== scores.length * CELLS)
			throw new Error("Invalid SAM 3 concept mask shape.");
		const ranked = [...scores.keys()].sort(
			(a, b) => (scores[b] ?? -Infinity) - (scores[a] ?? -Infinity),
		);
		const best = 1 / (1 + Math.exp(-(scores[ranked[0] ?? 0] ?? -Infinity)));
		if (best < threshold)
			throw new Error(
				`SAM 3 found no confident instance for text ${JSON.stringify(text)} (score ${best.toFixed(3)}, threshold ${threshold}).`,
			);
		const logit = Math.log(threshold / (1 - threshold));
		const selected: Float32Array[] = [];
		for (const query of ranked) {
			if (selected.length >= max || (scores[query] ?? -Infinity) < logit) break;
			const candidate = Float32Array.from(
				masks.subarray(query * CELLS, (query + 1) * CELLS),
				(v) => (v > 0 ? 1 : 0),
			);
			if (selected.every((kept) => maskIou(kept, candidate) <= 0.5))
				selected.push(candidate);
		}
		return selected;
	}

	release(): void {
		for (const session of this.sessions) session.release();
		this.sessions.length = 0;
	}
}

const CELLS = 288 * 288;

function maskIou(a: Float32Array, b: Float32Array): number {
	let both = 0,
		either = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0,
			y = b[i] ?? 0;
		both += x * y;
		either += Math.max(x, y);
	}
	return either ? both / either : 0;
}
