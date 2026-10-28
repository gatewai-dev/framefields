import { describe, expect, it } from "vitest";
import {
	sampledMediaSourceRange,
	sampledMediaSourceTime,
	sampleMediaSignal,
} from "./media-time-signal.js";

describe("sampled media signals", () => {
	it("integrates linearly varying speed at fractional frames and supports random access", () => {
		const map = sampleMediaSignal({
			mode: "speed",
			fps: 2,
			startFrame: 4,
			durationFrames: 2,
			sourceStartSec: 1,
			sample: (frame) => frame - 4,
		});
		expect(sampledMediaSourceTime(map, 0)).toBe(1);
		expect(sampledMediaSourceTime(map, 0.5)).toBe(1.0625);
		expect(sampledMediaSourceTime(map, 1)).toBe(1.25);
		expect(sampledMediaSourceTime(map, 2)).toBe(2);
		expect(sampledMediaSourceTime(map, 0.5)).toBe(1.0625);
	});
	it("finds source-time extrema between frame boundaries", () => {
		const map = sampleMediaSignal({
			mode: "speed",
			fps: 1,
			startFrame: 0,
			durationFrames: 1,
			sourceStartSec: 1,
			sample: (f) => 1 - 2 * f,
		});
		expect(sampledMediaSourceRange(map, 0, 1)).toEqual({ min: 1, max: 1.25 });
	});
	it("interpolates source times and rejects non-finite samples", () => {
		const map = sampleMediaSignal({
			mode: "source-time",
			fps: 24,
			startFrame: 10,
			durationFrames: 2,
			sample: (frame) => 12 - frame,
		});
		expect(sampledMediaSourceTime(map, 0.5)).toBe(1.5);
		expect(sampledMediaSourceRange(map, 0, 2)).toEqual({ min: 0, max: 2 });
		expect(() =>
			sampleMediaSignal({
				mode: "source-time",
				fps: 24,
				startFrame: 0,
				durationFrames: 2,
				sample: () => NaN,
			}),
		).toThrow(/Non-finite/);
	});
	it("rejects an overflow while integrating finite signal values", () => {
		expect(() =>
			sampleMediaSignal({
				mode: "speed",
				fps: 0.1,
				startFrame: 0,
				durationFrames: 1,
				sample: () => Number.MAX_VALUE,
			}),
		).toThrow(/overflow/);
	});
});
