import { describe, expect, it } from "vitest";
import { VisionModelStore } from "../model/model-store.js";
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
	return { tracker: await Sam2Tracker.create({ store, provider }), provider };
}

describe("SAM 2 video pipeline", () => {
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
		expect(memory?.data[0]).toBe(3);
		expect(memory?.data[7 * 1024 * 64]).toBe(7);
		expect(provider.created[4]?.inputs[0]?.data[0]).toBeCloseTo(1 / 15);
		await expect(tracker.process(frame, 7)).rejects.toThrow("consecutive");
		tracker.release();
		await expect(tracker.process(frame, 6)).rejects.toThrow("released");
	});

	it("requires explicit selection and accepts a correction on a later frame", async () => {
		const { tracker, provider } = await pipeline();
		await expect(tracker.process(frame, 0)).rejects.toThrow("prompt");
		await tracker.process(frame, 0, points);
		await tracker.process(frame, 1, points);
		expect(provider.created[3]?.inputs).toHaveLength(0);
		expect(
			provider.created[2]?.inputs
				.filter((entry) => entry.name === "binarize")
				.map((entry) => entry.data[0]),
		).toEqual([1, 1]);
		tracker.release();
	});

	it("reports an absent object as an empty source-sized mask", () => {
		expect(
			decodeSam2Mask(new Float32Array(512 * 512).fill(2), 13, 7, -2, 0.4).mask,
		).toEqual(new Uint8Array(91));
	});

	it("validates prompt ordering, coordinates, and box corners", () => {
		expect(() => validateSam2Prompts([])).toThrow();
		expect(() =>
			validateSam2Prompts([
				{ frame: 0, points },
				{ frame: 0, points },
			]),
		).toThrow();
		expect(() =>
			validateSam2Prompts([{ frame: 0, points: [{ x: NaN, y: 0, label: 1 }] }]),
		).toThrow();
		expect(() =>
			validateSam2Prompts([{ frame: 0, points: [{ x: 0, y: 0, label: 2 }] }]),
		).toThrow();
		expect(() =>
			validateSam2Prompts([
				{
					frame: 0,
					points: [
						{ x: 0, y: 0, label: 2 },
						{ x: 1, y: 1, label: 3 },
					],
				},
			]),
		).not.toThrow();
	});
});

describe("SAM 2 temporal geometry", () => {
	it("transposes channels to sequence tokens without mixing feature channels", () => {
		const data = Float32Array.from({ length: 512 }, (_, i) => i);
		const tokens = sam2Tokens(data);
		expect(tokens[0]).toBe(0);
		expect(tokens[1]).toBe(2);
		expect(tokens[256]).toBe(1);
	});
	it("keeps the conditioning frame and resets its history after correction", () => {
		const bank = new Sam2MemoryBank(
			Array.from({ length: 7 }, (_, i) => Array(64).fill(i) as number[]),
		);
		const memory = (frame: number) => ({
			frame,
			tokens: new Float32Array(64).fill(frame),
			positions: new Float32Array(64),
			pointer: new Float32Array(256).fill(frame),
		});
		bank.remember(memory(0), true);
		for (let i = 1; i < 20; i++) bank.remember(memory(i), false);
		const assembled = bank.assemble(20);
		expect(assembled.memory[0]).toBe(0);
		expect(assembled.memory[64]).toBe(19);
		expect(assembled.positions[0]).toBe(6);
		expect(assembled.distances[0]).toBeCloseTo(20 / 15);
		bank.remember(memory(20), true);
		expect(bank.assemble(21).memory[64]).toBe(20);
	});
});
