/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from "vitest";
import { Sam3MemoryBank, sam3Position } from "./memory.js";
import { Sam3Tracker, sam3Mask } from "./tracker.js";
import { validateSam3Prompts } from "./types.js";

describe("SAM 3 / 3.1 video tracker", () => {
	it("enforces license agreement before creation", async () => {
		const prev = process.env.FRAMEFIELDS_ACCEPT_SAM_LICENSE;
		delete process.env.FRAMEFIELDS_ACCEPT_SAM_LICENSE;
		try {
			await expect(
				Sam3Tracker.create({ acceptLicense: false }),
			).rejects.toThrow("Meta SAM License agreement required");
		} finally {
			if (prev !== undefined) process.env.FRAMEFIELDS_ACCEPT_SAM_LICENSE = prev;
		}
	});

	it("validates prompted coordinates, text presence, and non-empty strings", () => {
		expect(() => validateSam3Prompts({ prompts: [] })).toThrow(
			"at least one prompt",
		);
		expect(() =>
			validateSam3Prompts({
				prompts: [
					{ frame: 0, text: "person" },
					{ frame: 0, text: "cat" },
				],
			}),
		).toThrow("unique and increasing");
		expect(() =>
			validateSam3Prompts({
				prompts: [
					{
						frame: 0,
						points: [{ x: 0.5, y: 0.5, label: 1 }],
						text: "person",
					},
				],
			}),
		).toThrow("either points/a box or text");
		expect(() =>
			validateSam3Prompts({
				prompts: [{ frame: 0, text: "   " }],
			}),
		).toThrow("not be empty");
		expect(() =>
			validateSam3Prompts({
				prompts: [{ frame: 0, text: "valid" }],
				textThreshold: 1.5,
			}),
		).toThrow("textThreshold must be between zero and one");
	});

	it("computes 2D sinusoidal position embeddings with expected dimension", () => {
		const pos = sam3Position();
		expect(pos.length).toBe(72 * 72 * 256);
		// Sinusoidal values should all be in [-1, 1]
		let min = Infinity,
			max = -Infinity;
		for (let i = 0; i < 1000; i++) {
			const v = pos[i] as number;
			if (v < min) min = v;
			if (v > max) max = v;
		}
		expect(min).toBeGreaterThanOrEqual(-1);
		expect(max).toBeLessThanOrEqual(1);
	});

	it("resizes 1008x1008 logits to target image dimensions", () => {
		const logits = new Float32Array(1008 * 1008).fill(-5);
		// Fill top-left quadrant with positive logits
		for (let y = 0; y < 504; y++) {
			for (let x = 0; x < 504; x++) {
				logits[y * 1008 + x] = 5;
			}
		}
		const mask = sam3Mask(logits, 4, 4, 1.0);
		expect(mask.length).toBe(16);
		// (0,0) quadrant should be 255, bottom-right should be 0
		expect(mask[0]).toBe(255);
		expect(mask[15]).toBe(0);

		// Negative score suppresses mask
		const suppressed = sam3Mask(logits, 4, 4, -0.5);
		expect(suppressed.every((v) => v === 0)).toBe(true);
	});

	it("manages temporal memory bank entries across propagation frames", () => {
		const temporal = new Float32Array(7 * 64).fill(0.1);
		const bank = new Sam3MemoryBank(temporal);

		const dummyMemory = {
			frame: 0,
			tokens: new Float32Array(5184 * 64).fill(1),
			positions: new Float32Array(5184 * 64).fill(0.5),
			pointer: new Float32Array(256).fill(0.2),
		};

		bank.remember(dummyMemory, true);
		const assembled0 = bank.assemble(1, 16);
		expect(assembled0.pointerCount).toBe(1);
		expect(assembled0.spatial.length).toBe(1 * 5184 * 64);

		// Add propagation frame
		bank.remember({ ...dummyMemory, frame: 1 }, false);
		const assembled1 = bank.assemble(2, 16);
		expect(assembled1.pointerCount).toBe(2);
		expect(assembled1.spatial.length).toBe(2 * 5184 * 64);
	});
});
