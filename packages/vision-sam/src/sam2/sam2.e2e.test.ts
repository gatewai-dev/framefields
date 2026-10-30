import { NodeWebGPUProvider } from "@framefields/vision";
import { describe, expect, it } from "vitest";
import { Sam2Tracker } from "./tracker.js";

const enabled = process.env.FRAMEFIELDS_SAM2_E2E === "1";

/** No external video fixture: a moving selected shape and a stationary distractor. */
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

describe.skipIf(!enabled)("SAM 2.1 on native Dawn", () => {
	it.each([
		"tiny",
		"small",
	] as const)("%s runs every graph and propagates a selected object without selecting a distractor", async (model) => {
		const tracker = await Sam2Tracker.create({
			provider: new NodeWebGPUProvider(),
			frameCount: 8,
			model,
		});
		try {
			for (let frame = 0; frame < 8; frame++) {
				const result = await tracker.process(
					picture(frame),
					frame,
					frame === 0 ? [{ x: 0.28, y: 0.5, label: 1 }] : undefined,
				);
				expect(result.score).toBeGreaterThan(0);
				expect(result.mask[48 * 128 + 36 + frame * 3]).toBe(255);
				expect(result.mask[48 * 128 + 110]).toBe(0);
			}
		} finally {
			tracker.release();
		}
	}, 300_000);
});
