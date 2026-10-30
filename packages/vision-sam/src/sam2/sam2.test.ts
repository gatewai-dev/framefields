import { VisionModelStore } from "@framefields/vision";
import { describe, expect, it } from "vitest";
import { SAM_MODELS, SAM2_EXPORTS } from "../models/registry.js";
import { ScriptedProvider } from "../test-support.js";
import { Sam2MemoryBank, sam2Tokens } from "./memory.js";
import { decodeSam2Mask, Sam2Tracker } from "./tracker.js";
import { validateSam2Prompts } from "./types.js";

const float = (data: Float32Array, dims: readonly number[]) => ({ data, dims });
const frame = { data: new Uint8Array(8 * 4 * 4), width: 8, height: 4 };
const points = [{ x: 0.25, y: 0.5, label: 1 as const }];

async function pipeline() {
	const temporal = Array.from(
		{ length: 7 },
		() => Array(64).fill(0) as number[],
	);
	const constants = JSON.stringify({
		image_size: 512,
		memory_frames: 7,
		image_mean: [0.485, 0.456, 0.406],
		image_std: [0.229, 0.224, 0.225],
		memory_temporal_positional_encoding: temporal,
	});
	const store = new VisionModelStore({
		modelsDir: `/tmp/framefields-sam2-test-${crypto.randomUUID()}`,
		verify: false,
		fetchImpl: async (url) =>
			new Response(
				String(url).endsWith("constants.json")
					? constants
					: new Uint8Array([1]),
			),
	});
	const mask = new Float32Array(512 * 512).fill(-1);
	for (let y = 0; y < 512; y++)
		for (let x = 0; x < 256; x++) mask[y * 512 + x] = 1;
	const feature = float(new Float32Array(256 * 1024), [1, 256, 32, 32]);
	const provider = new ScriptedProvider([
		{
			feats0: float(new Float32Array(32 * 128 * 128), [1, 32, 128, 128]),
			feats1: float(new Float32Array(64 * 64 * 64), [1, 64, 64, 64]),
			feats2: feature,
			feats2_no_mem: feature,
			vision_pos_embed: feature,
		},
		{
			high_res_mask: float(mask, [1, 1, 512, 512]),
			object_score_logits: float(new Float32Array([5]), [1, 1, 1]),
			object_pointer: float(new Float32Array(256).fill(7), [1, 1, 256]),
			iou: float(new Float32Array([0.9]), [1, 1]),
		},
		{
			memory_tokens: float(new Float32Array(1024 * 64).fill(3), [1024, 1, 64]),
			memory_pos: float(new Float32Array(1024 * 64), [1024, 1, 64]),
		},
		{ conditioned_feats: feature },
		{ pointer_pos: float(new Float32Array(16 * 64), [16, 64]) },
	]);
	return {
		tracker: await Sam2Tracker.create({ store, provider }),
		provider,
	};
}

describe("SAM 2 video pipeline", () => {
	it("needs no SAM License acceptance: SAM 2.1 weights are Apache-2.0", async () => {
		const prev = process.env.FRAMEFIELDS_ACCEPT_SAM_LICENSE;
		delete process.env.FRAMEFIELDS_ACCEPT_SAM_LICENSE;
		try {
			const { tracker } = await pipeline();
			tracker.release();
		} finally {
			if (prev !== undefined) process.env.FRAMEFIELDS_ACCEPT_SAM_LICENSE = prev;
		}
	});

	it("uses point labels, remembers the prompt, and conditions subsequent frames on memory", async () => {
		const { tracker, provider } = await pipeline();
		const first = await tracker.process(frame, 4, points);
		expect(first.mask).toEqual(
			Uint8Array.from({ length: 32 }, (_, i) => (i % 8 < 4 ? 255 : 0)),
		);
		await tracker.process(frame, 5);
		const decoderInputs = provider.created[1]?.inputs ?? [];
		expect(
			decoderInputs.find((entry) => entry.name === "input_labels")?.data,
		).toBeInstanceOf(Int32Array);
		expect(
			decoderInputs.find((entry) => entry.name === "input_points")?.data,
		).toEqual(new Float32Array([128, 256]));
		const memory = provider.created[3]?.inputs.find(
			(entry) => entry.name === "memory",
		);
		expect(memory?.dims).toEqual([7232, 1, 64]);
	});

	it("rejects nonconsecutive frames and missing initial prompts", async () => {
		const { tracker } = await pipeline();
		await expect(tracker.process(frame, 0)).rejects.toThrow("needs a prompt");
		await tracker.process(frame, 0, points);
		await expect(tracker.process(frame, 2)).rejects.toThrow(
			"consecutive source frames",
		);
	});

	it("validates prompted coordinates and box corners", () => {
		expect(() => validateSam2Prompts([])).toThrow(
			"requires at least one prompt",
		);
		expect(() =>
			validateSam2Prompts([
				{ frame: 1, points },
				{ frame: 1, points },
			]),
		).toThrow("increasing");
		expect(() =>
			validateSam2Prompts([
				{ frame: 0, points: [{ x: 1.2, y: 0.5, label: 1 }] },
			]),
		).toThrow("normalized coordinates");
		expect(() =>
			validateSam2Prompts([
				{
					frame: 0,
					points: [
						{ x: 0.5, y: 0.5, label: 2 },
						{ x: 0.2, y: 0.8, label: 3 },
					],
				},
			]),
		).toThrow("corners");
	});

	it("pins every graph of every SAM 2.1 model, sized to its export", () => {
		for (const [model, { size }] of Object.entries(SAM2_EXPORTS))
			for (const graph of [
				"constants",
				"vision_encoder",
				"mask_decoder",
				"memory_encoder",
				"memory_attention",
				"pointer_tpos",
			])
				expect(
					SAM_MODELS.find((m) => m.key === `sam2.1-${model}-${graph}`)?.input,
				).toEqual([size, size]);
	});

	it("rejects an unknown model before downloading anything", async () => {
		await expect(
			Sam2Tracker.create({
				// @ts-expect-error not a SAM 2.1 model
				model: "huge",
			}),
		).rejects.toThrow('Unknown SAM 2.1 model "huge"');
	});

	it("decodes logits of any square model size to a source-sized mask", () => {
		const logits = new Float32Array(1024 * 1024).fill(-1);
		for (let y = 0; y < 1024; y++)
			for (let x = 0; x < 512; x++) logits[y * 1024 + x] = 2;
		expect(Array.from(decodeSam2Mask(logits, 4, 1, 1, 0.9).mask)).toEqual([
			255, 255, 0, 0,
		]);
		expect(() => decodeSam2Mask(new Float32Array(500), 4, 1, 1, 0.9)).toThrow(
			"Invalid SAM 2 mask shape.",
		);
	});

	it("decodes logits to a source-sized binary mask", () => {
		const logits = new Float32Array(512 * 512).fill(-1);
		for (let y = 0; y < 512; y++)
			for (let x = 0; x < 256; x++) logits[y * 512 + x] = 2;
		const decoded = decodeSam2Mask(logits, 4, 2, 1, 0.9);
		expect(decoded.mask).toEqual(
			new Uint8Array([255, 255, 0, 0, 255, 255, 0, 0]),
		);
		expect(decodeSam2Mask(logits, 4, 2, -1, 0.9).mask).toEqual(
			new Uint8Array(8),
		);
	});

	it("rearranges NCHW features to token sequence major order", () => {
		const data = new Float32Array(256 * 4);
		data[0] = 11;
		data[4] = 22;
		data[256 * 4 - 1] = 99;
		const tokens = sam2Tokens(data);
		expect(tokens[0]).toBe(11);
		expect(tokens[1]).toBe(22);
		expect(tokens[tokens.length - 1]).toBe(99);
	});

	it("assembles temporal positions with decaying distance weights", () => {
		const bank = new Sam2MemoryBank(
			Array.from({ length: 7 }, () => Array(64).fill(1) as number[]),
		);
		const memory = {
			frame: 0,
			tokens: new Float32Array(64),
			positions: new Float32Array(64),
			pointer: new Float32Array(256),
		};
		bank.remember(memory, true);
		bank.remember({ ...memory, frame: 1 }, false);
		const assembled = bank.assemble(2, 10);
		expect(assembled.distances[0]).toBeCloseTo(2 / 9);
		expect(assembled.distances[1]).toBeCloseTo(1 / 9);
	});
});
