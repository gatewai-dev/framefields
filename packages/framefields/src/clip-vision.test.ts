import { describe, expect, it } from "vitest";
import { clipVisionFromResults } from "./clip-vision.js";
import { Composition, Layer } from "./index.js";

/** A 160×80 clip: frame f has the left wrist at (20 + 20f, 10) and a 40×40 square silhouette moving right. */
function clip(frames = 4, options = {}) {
	const cell = 4;
	const w = 40;
	const h = 20;
	return clipVisionFromResults(
		24,
		{ width: 160, height: 80, cell },
		Array.from({ length: frames }, (_, f) => {
			const kp = new Array(51).fill(0);
			kp.splice(9 * 3, 3, 20 + 20 * f, 10, 1);
			const mask = new Uint8Array(w * h);
			for (let y = 5; y < 15; y++)
				for (let x = 5 + f * 10; x < 15 + f * 10 && x < w; x++)
					mask[y * w + x] = 255;
			return { kp, mask };
		}),
		{ smoothing: 0, ...options },
	);
}

describe("ClipVision", () => {
	it("reads keypoints at composition frames and maps them into a layer box", () => {
		const person = clip().person;
		expect(person.point("leftWrist", 1.5)).toMatchObject({
			x: 50,
			y: 10,
			visibility: 1,
		});
		// 160×80 covering 320×320 at (100, 0): scale 4, centered.
		const placed = person.place({
			x: 100,
			y: 0,
			width: 320,
			height: 320,
			fit: "cover",
		});
		expect(placed.point("leftWrist", 0)).toMatchObject({
			x: 100 - 160 + 80,
			y: 40,
		});
		expect(
			placed.signals("leftWrist").x.get({ frame: 1, fps: 24 } as never),
		).toBeCloseTo(100 - 160 + 160);
	});

	it("offsets the clip by its start frame", () => {
		const late = clip(4, { startFrame: 10 }).person;
		expect(late.point("leftWrist", 12).x).toBe(60);
	});

	it("smooths over neighbouring frames, weighted by confidence", () => {
		const person = clip(5, { smoothing: 1 }).person;
		// Frames 1..3 at x 40, 60, 80 with weights 1, 2, 1 → 60.
		expect(person.point("leftWrist", 2).x).toBeCloseTo(60);
	});

	it("samples the silhouette with a gradient pointing inward", () => {
		const person = clip().person;
		expect(person.sample(0, 40, 40).alpha).toBeGreaterThan(0.9);
		expect(person.sample(0, 120, 40).alpha).toBe(0);
		const edge = person.sample(0, 62, 40);
		expect(edge.alpha).toBeGreaterThan(0);
		expect(edge.gx).toBeLessThan(0);
	});

	it("gives render-time mattes the full-resolution subject per source frame", () => {
		const subject = new Uint8Array(160 * 80);
		subject.fill(200, 0, 160 * 10);
		const c = clipVisionFromResults(24, { width: 160, height: 80, cell: 4 }, [
			{ kp: null, mask: null, subject },
			{ kp: null, mask: null, subject: null },
			{ kp: null, mask: null },
		]);
		const s = c.subject(0, 24);
		expect(s).toMatchObject({ width: 160, height: 80, category: "person" });
		expect(s?.mask).toEqual(subject);
		expect(s?.area).toBe(Math.round((200 * 160 * 10) / 255));
		// Source frame 2 at 48 fps is clip frame 1: analysed, nobody there.
		expect(c.subject(2, 48)).toBeNull();
		// Not analysed with subjects, or between clip frames: the caller segments.
		expect(c.subject(2, 24)).toBeUndefined();
		expect(c.subject(1, 48)).toBeUndefined();
	});

	it("explains a read of a frame that was never analysed", () => {
		expect(() => clip(2).person.point("leftWrist", 30)).toThrow(
			/not analysed yet/,
		);
	});
});

describe("remapped clip vision", () => {
	it("samples reverse motion and covers intermediate turns in a readiness window", () => {
		const c = clip(4, {
			timeRemap: {
				kind: "keyframes",
				keyframes: [
					{ frame: 0, sourceSec: 0 },
					{ frame: 3, sourceSec: 3 / 24, interpolation: "smooth" },
					{ frame: 6, sourceSec: 1 / 24 },
				],
			},
		});
		expect(c.person.point("leftWrist", 3).x).toBe(80);
		expect(c.person.point("leftWrist", 6).x).toBe(40);
		const range = (
			c as unknown as { window(from: number, to: number): [number, number] }
		).window(0, 6);
		expect(range[1]).toBeGreaterThanOrEqual(3);
	});
	it("requires a layer to be in the composition before binding vision", () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: 24,
			durationFrames: 24,
		});
		expect(() =>
			comp.vision(Layer.video("clip.mp4", { durationFrames: 24 })),
		).toThrow(/Add the media layer/);
	});
	it("binds to the absolute start of a nested media layer", () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: 24,
			durationFrames: 100,
		});
		const layer = Layer.video("clip.mp4", {
			startFrame: 7,
			durationFrames: 24,
			timeRemap: { kind: "rate", sourceStartSec: 1, rate: 0.5 },
		});
		comp.add(
			Layer.box({ startFrame: 10, durationFrames: 60, children: [layer] }),
		);
		const vision = comp.vision(layer);
		expect(vision.startFrame).toBe(17);
		expect(vision.clipFrame(19)).toBe(25);
	});
	it("samples the same source clock as the media layer", () => {
		const c = clip(4, {
			startFrame: 10,
			timeRemap: {
				kind: "keyframes",
				keyframes: [
					{ frame: 0, sourceSec: 0 },
					{ frame: 2, sourceSec: 1 / 24 },
					{ frame: 4, sourceSec: 1 / 24 },
					{ frame: 6, sourceSec: 3 / 24 },
				],
			},
		});
		expect(c.person.point("leftWrist", 12).x).toBe(40);
		expect(c.person.point("leftWrist", 13).x).toBe(40);
		expect(c.person.point("leftWrist", 16).x).toBe(80);
	});
});
