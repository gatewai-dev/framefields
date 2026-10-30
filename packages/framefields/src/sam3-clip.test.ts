import { describe, expect, it } from "vitest";
import { ClipVision, seedClipVision } from "./clip-vision.js";

function selectedSam3Clip(textSelection = false) {
	const clip = new ClipVision("selected.mp4", 24, {
		cacheDir: false,
		acceptSamLicense: true,
		sam3: textSelection
			? {
					text: "performer in black suit",
					category: "person",
				}
			: {
					category: "person",
					prompts: [{ frame: 0, points: [{ x: 0.3, y: 0.4, label: 1 }] }],
				},
	});
	seedClipVision(
		clip,
		{ width: 8, height: 4 },
		Array.from({ length: 3 }, (_, frame) => {
			const mask = Uint8Array.from({ length: 32 }, (_, i) =>
				i % 8 >= frame && i % 8 < frame + 2 ? 255 : 0,
			);
			return { kp: null, mask: null, subject: mask };
		}),
	);
	return clip;
}

describe("SAM 3 clip vision integration", () => {
	it("rejects configuring both sam2 and sam3 simultaneously", () => {
		expect(
			() =>
				new ClipVision("source.mp4", 24, {
					sam2: {
						prompts: [{ frame: 0, points: [{ x: 0.5, y: 0.5, label: 1 }] }],
					},
					sam3: { text: "performer" },
				}),
		).toThrow("Choose one prompted backend: sam2 or sam3.");
	});

	it("accepts text-driven prompt configuration", () => {
		const clip = new ClipVision("source.mp4", 24, {
			acceptSamLicense: true,
			sam3: {
				text: "performer in black suit",
				category: "person",
			},
		});
		expect(clip.options.sam3?.text).toBe("performer in black suit");
		expect(clip.options.sam3?.category).toBe("person");
	});

	it("copies prompt inputs defensively", () => {
		const points = [{ x: 0.3, y: 0.4, label: 1 as const }];
		const clip = new ClipVision("source.mp4", 24, {
			acceptSamLicense: true,
			sam3: {
				prompts: [{ frame: 0, points }],
			},
		});
		const point = points[0];
		if (point) point.x = 0.99;
		expect(clip.options.sam3?.prompts?.[0]?.points[0]?.x).toBe(0.3);
	});

	it("exposes tracked object geometry, masks, and velocities with sam3", async () => {
		const clip = selectedSam3Clip();
		const signals = clip.signals;
		await clip.ready(0, 2);
		expect(signals.getObjectResult(0).objects[0]).toMatchObject({
			trackId: 1,
			boundingBox: { originX: 0, width: 2 },
			active: true,
		});
		expect(signals.getObjectResult(2).objects[0]?.velocity.vx).toBe(24);
		expect(signals.getMaskResult(2)[0]?.mask[2]).toBe(255);
		expect(signals.getMaskResult(0)[0]?.mask[2]).toBe(0);
		expect(signals.segmentation.matte.at(2)?.coverage).toBe(0.25);
		clip.release();
		expect(signals.getMaskResult(1)[0]?.mask[1]).toBe(255);
	});

	it("supports text prompt with temporal tracking seed", async () => {
		const clip = selectedSam3Clip(true);
		const signals = clip.signals;
		await clip.ready(0, 2);
		expect(signals.getObjectResult(0).objects[0]).toMatchObject({
			trackId: 1,
			category: "person",
		});
		expect(signals.getMaskResult(2)[0]?.mask[2]).toBe(255);
		clip.release();
	});
});
