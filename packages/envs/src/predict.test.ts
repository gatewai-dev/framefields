/**
 * Metrics behave as their definitions say, and the predict task scores the
 * true future perfect and a frozen guess ("nothing moves") worse.
 */
import { HeadlessMediaRenderer } from "framefields";
import {
	poseError,
	psnr,
	quatFromEuler,
	rotationError,
	ssim,
} from "framefields/datasets";
import { describe, expect, it } from "vitest";
import { falling } from "./envs/falling.js";
import {
	predictSplit,
	scorePredictedFrames,
	scorePredictedPoses,
	truthPoses,
} from "./tasks/predict.js";

/** A W×H RGBA frame from a function of the pixel. */
function frame(w: number, h: number, f: (x: number, y: number) => number) {
	const out = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const v = f(x, y);
			out.set([v, v, v, 255], (y * w + x) * 4);
		}
	return out;
}

describe("metrics", () => {
	it("scores SSIM 1 for equal frames, lower for noise, structure over brightness", () => {
		const w = 64;
		const h = 48;
		const pattern = frame(w, h, (x, y) =>
			((x >> 3) + (y >> 3)) % 2 ? 200 : 40,
		);
		expect(ssim(pattern, pattern, w, h)).toBe(1);
		const brighter = frame(w, h, (x, y) =>
			((x >> 3) + (y >> 3)) % 2 ? 215 : 55,
		);
		const flat = frame(w, h, () => 120);
		// A brightness shift keeps the structure; a flat frame loses it.
		expect(ssim(pattern, brighter, w, h)).toBeGreaterThan(0.9);
		expect(ssim(pattern, flat, w, h)).toBeLessThan(0.1);
		expect(psnr(pattern, pattern)).toBe(99);
		expect(psnr(pattern, brighter)).toBeCloseTo(
			10 * Math.log10(255 ** 2 / 225),
			6,
		);
	});

	it("measures rotation error as the angle between orientations", () => {
		expect(rotationError([10, 20, 30], [10, 20, 30])).toBeCloseTo(0, 4);
		expect(rotationError([0, 0, 0], [0, 90, 0])).toBeCloseTo(90, 6);
		// Two Euler triples for one orientation.
		expect(rotationError([0, 0, 0], [180, 180, 180])).toBeCloseTo(0, 4);
		const [x, y, z, w] = quatFromEuler([30, -40, 70]);
		expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 10);
		expect(
			poseError(
				{ position: [3, 4, 0] },
				{ position: [0, 0, 0], rotation: [0, 0, 0] },
			),
		).toEqual({ position: 5 });
	});
});

describe("predict task", () => {
	it("splits a clip into context and horizon", () => {
		expect(predictSplit(10, 6)).toEqual({
			context: [0, 1, 2, 3, 4, 5],
			horizon: [6, 7, 8, 9],
		});
		expect(() => predictSplit(10, 8, 4)).toThrow("do not fit 10");
	});

	it("scores the true poses perfect and a frozen guess worse", async () => {
		const [view] = await falling.build(falling.params(5));
		const { context, horizon } = predictSplit(falling.frames, 24, 24);
		const asked = horizon.filter((_, k) => k % 6 === 0);
		const answer = (pick: (f: number) => number) => ({
			frames: Object.fromEntries(
				asked.map((f) => [f, truthPoses(view, pick(f))]),
			),
		});
		const exact = scorePredictedPoses(
			view,
			answer((f) => f),
			asked,
		);
		expect(exact.score).toBe(1);
		expect(exact.positionError).toBe(0);
		expect(exact.rotationError).toBeCloseTo(0, 3);
		const frozen = scorePredictedPoses(
			view,
			answer(() => context.at(-1) ?? 0),
			asked,
		);
		expect(frozen.positionError).toBeGreaterThan(0);
		expect(frozen.score).toBeLessThanOrEqual(exact.score);
		// Leaving objects out costs them.
		const empty = scorePredictedPoses(view, { frames: {} }, asked);
		expect(empty.score).toBe(0);
		expect(() =>
			scorePredictedPoses(view, { frames: { 30: { obj0: {} } } }, asked),
		).toThrow("frames.30.obj0.position");
		// A list is not a map of frames, even an empty one.
		expect(() => scorePredictedPoses(view, { frames: [] }, asked)).toThrow(
			'answer: {"frames"',
		);
	});

	it("scores predicted frames by PSNR and SSIM per horizon frame", async () => {
		const renderer = new HeadlessMediaRenderer();
		const [view] = await falling.build(falling.params(5));
		const render = async (f: number) =>
			new Uint8Array(
				(await view.composition.renderTruth({ frame: f, renderer })).rgba,
			);
		const truth = [
			{ frame: 30, rgba: await render(30) },
			{ frame: 40, rgba: await render(40) },
		];
		const { width, height } = falling;
		const exact = scorePredictedFrames(
			truth,
			truth.map((t) => t.rgba),
			width,
			height,
		);
		expect(exact.ssim).toBe(1);
		const last = await render(23);
		const copy = scorePredictedFrames(truth, [last, last], width, height);
		expect(copy.ssim).toBeLessThan(1);
		expect(Object.keys(copy.byFrame)).toEqual(["30", "40"]);
		expect(() => scorePredictedFrames(truth, [last], width, height)).toThrow(
			"1 predicted frames for 2",
		);
	});
});
