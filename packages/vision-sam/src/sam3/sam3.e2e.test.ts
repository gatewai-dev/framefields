/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import { NodeWebGPUProvider } from "@framefields/vision";
import { describe, expect, it } from "vitest";
import { Sam3Tracker } from "./tracker.js";

const enabled = process.env.FRAMEFIELDS_SAM3_E2E === "1";

function picture(frame: number) {
	const width = 128,
		height = 96;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const selected =
				x >= 20 + frame * 3 && x < 52 + frame * 3 && y >= 16 && y < 84;
			const distractor = x >= 100 && x < 120 && y >= 16 && y < 84;
			data.set(
				selected
					? [230, 40, 40, 255]
					: distractor
						? [40, 220, 80, 255]
						: [30, 50, 120, 255],
				(y * width + x) * 4,
			);
		}
	return { width, height, data };
}

describe.skipIf(!enabled)("SAM 3 / 3.1 on native Dawn WebGPU", () => {
	it("propagates a prompted object across video frames with temporal memory", async () => {
		const tracker = await Sam3Tracker.create({
			provider: new NodeWebGPUProvider(),
			frameCount: 8,
			acceptLicense: true,
		});
		try {
			for (let frame = 0; frame < 8; frame++) {
				const result = await tracker.process(
					picture(frame),
					frame,
					frame === 0 ? { points: [{ x: 0.28, y: 0.5, label: 1 }] } : undefined,
				);
				const [selected] = result.objects;
				expect(result.objects).toHaveLength(1);
				expect(selected?.score).toBeGreaterThan(0);
				expect(selected?.mask[48 * 128 + 36 + frame * 3]).toBe(255);
				expect(selected?.mask[48 * 128 + 110]).toBe(0);
			}
		} finally {
			tracker.release();
		}
	}, 120_000);

	it("tracks two prompted objects with separate memories", async () => {
		const tracker = await Sam3Tracker.create({
			provider: new NodeWebGPUProvider(),
			frameCount: 8,
			acceptLicense: true,
		});
		try {
			for (let frame = 0; frame < 8; frame++) {
				// Seed object 1 on frame 0 and add object 2 on frame 1.
				const prompt =
					frame === 0
						? { points: [{ x: 0.28, y: 0.5, label: 1 as const }] }
						: frame === 1
							? { object: 2, points: [{ x: 0.86, y: 0.5, label: 1 as const }] }
							: undefined;
				const { objects } = await tracker.process(
					picture(frame),
					frame,
					prompt,
				);
				const [moving, still] = objects;
				expect(moving?.mask[48 * 128 + 36 + frame * 3]).toBe(255);
				expect(moving?.mask[48 * 128 + 110]).toBe(0);
				if (frame === 0) continue;
				expect(objects).toHaveLength(2);
				expect(still?.mask[48 * 128 + 110]).toBe(255);
				expect(still?.mask[48 * 128 + 36 + frame * 3]).toBe(0);
			}
		} finally {
			tracker.release();
		}
	}, 120_000);
});
