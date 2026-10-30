import { describe, expect, it } from "vitest";
import { ClipVision, seedClipVision } from "./clip-vision.js";

function selectedClip(reverse = false) {
	const clip = new ClipVision("selected.mp4", 24, {
		cacheDir: false,
		sam2: {
			category: "person",
			prompts: [{ frame: 0, points: [{ x: 0.2, y: 0.5, label: 1 }] }],
		},
		...(reverse
			? {
					timeRemap: {
						kind: "rate" as const,
						sourceStartSec: 2 / 24,
						rate: -1,
					},
				}
			: {}),
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

describe("prompted clip vision signals", () => {
	it("reuses the selected mask at fractional analysis timestamps", () => {
		const clip = new ClipVision("selected.mp4", 24, {
			fps: 12,
			sam2: { prompts: [{ frame: 0, points: [{ x: 0.2, y: 0.5, label: 1 }] }] },
		});
		seedClipVision(clip, { width: 2, height: 1 }, [
			{ kp: null, mask: null, subject: new Uint8Array([255, 0]) },
			{ kp: null, mask: null, subject: new Uint8Array([0, 255]) },
		]);
		expect(clip.subject(1, 24)?.mask).toEqual(new Uint8Array([255, 0]));
		expect(clip.subject(3, 24)?.mask).toEqual(new Uint8Array([0, 255]));
	});

	it("exposes selected-object geometry and frame-exact lazy masks", async () => {
		const clip = selectedClip();
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
		expect(
			signals.objects.get(1).active.get({ frame: 2, fps: 24 } as never),
		).toBe(1);
		clip.release();
		expect(signals.getMaskResult(1)[0]?.mask[1]).toBe(255);
	});

	it("maps reverse playback into masks and object velocity without rewinding model state", async () => {
		const clip = selectedClip(true);
		const signals = clip.signals;
		await clip.ready(0, 2);
		expect(signals.getObjectResult(0).objects[0]?.boundingBox.originX).toBe(2);
		expect(signals.getObjectResult(1).objects[0]?.velocity.vx).toBe(-24);
		expect(signals.segmentation.matte.at(2)?.mask[0]).toBe(255);
	});

	it("copies prompt inputs so later edits cannot silently change the cache recipe", () => {
		const points = [{ x: 0.2, y: 0.5, label: 1 as const }];
		const clip = new ClipVision("selected.mp4", 24, {
			sam2: { prompts: [{ frame: 0, points }] },
		});
		const point = points[0];
		if (point) point.x = 0.9;
		expect(clip.options.sam2?.prompts[0]?.points[0]?.x).toBe(0.2);
	});
});
