import { describe, expect, it } from "vitest";
import {
	MediaTimeRemapSchema,
	mediaSourceIsHold,
	mediaSourceRange,
	mediaSourceRate,
	mediaSourceTime,
	validateMediaTimeRemap,
} from "./media-time.js";

describe("media time mapping", () => {
	it("maps fractional frames at a constant rate", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "rate",
			sourceStartSec: 2,
			rate: 0.25,
		});
		expect(mediaSourceTime(map, 15.5, 30)).toBeCloseTo(2 + 15.5 / 120);
		expect(validateMediaTimeRemap(map, 90)).toBeUndefined();
	});
	it("maps non-integer frame rates without accumulating drift", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "rate",
			sourceStartSec: 0.125,
			rate: 0.5,
		});
		const fps = 30000 / 1001;
		expect(mediaSourceTime(map, fps * 3600, fps)).toBeCloseTo(1800.125, 9);
	});
	it("maps piecewise source times and holds", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "keyframes",
			keyframes: [
				{ frame: 0, sourceSec: 1 },
				{ frame: 30, sourceSec: 2 },
				{ frame: 60, sourceSec: 2 },
				{ frame: 90, sourceSec: 4 },
			],
		});
		expect(validateMediaTimeRemap(map, 90)).toBeUndefined();
		expect(mediaSourceTime(map, 15, 30)).toBe(1.5);
		expect(mediaSourceTime(map, 45, 30)).toBe(2);
		expect(mediaSourceTime(map, 75, 30)).toBe(3);
	});
	it("rejects zero rate and accepts reverse playback", () => {
		expect(
			MediaTimeRemapSchema.safeParse({
				kind: "rate",
				sourceStartSec: 0,
				rate: 0,
			}).success,
		).toBe(false);
		const map = MediaTimeRemapSchema.parse({
			kind: "keyframes",
			keyframes: [
				{ frame: 0, sourceSec: 1 },
				{ frame: 30, sourceSec: 0 },
			],
		});
		expect(validateMediaTimeRemap(map, 30)).toBeUndefined();
		expect(mediaSourceTime(map, 15, 30)).toBe(0.5);
		expect(validateMediaTimeRemap(map, 31)).toMatch(/durationFrames/);
	});
	it("requires strictly ordered keyframes and a full layer window", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "keyframes",
			keyframes: [
				{ frame: 0, sourceSec: 0 },
				{ frame: 10, sourceSec: 1 },
				{ frame: 10, sourceSec: 1 },
				{ frame: 30, sourceSec: 2 },
			],
		});
		expect(validateMediaTimeRemap(map, 30)).toMatch(/strictly increasing/);
		expect(validateMediaTimeRemap(map, 29)).toMatch(/durationFrames/);
	});
	it("is independent of evaluation order", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "keyframes",
			keyframes: [
				{ frame: 0, sourceSec: 1 },
				{ frame: 20, sourceSec: 3 },
				{ frame: 40, sourceSec: 3 },
				{ frame: 60, sourceSec: 4 },
			],
		});
		const frames = [0, 12.5, 20, 39.5, 40, 59, 60];
		const expected = frames.map((frame) => mediaSourceTime(map, frame, 30));
		expect(
			frames
				.toReversed()
				.map((frame) => mediaSourceTime(map, frame, 30))
				.reverse(),
		).toEqual(expected);
	});
	it("evaluates smooth ramps without overshoot in either direction", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "keyframes",
			keyframes: [
				{ frame: 0, sourceSec: 1, interpolation: "ease-in" },
				{ frame: 30, sourceSec: 3, interpolation: "smooth" },
				{ frame: 60, sourceSec: 1, interpolation: "ease-out" },
				{ frame: 90, sourceSec: 2 },
			],
		});
		expect(validateMediaTimeRemap(map, 90)).toBeUndefined();
		expect(mediaSourceTime(map, 15, 30)).toBe(1.5);
		expect(mediaSourceTime(map, 45, 30)).toBe(2);
		expect(mediaSourceTime(map, 75, 30)).toBe(1.75);
		expect(mediaSourceRate(map, 0, 30)).toBe(0);
		expect(mediaSourceIsHold(map, 0)).toBe(false);
		expect(mediaSourceRange(map, 0, 90, 30)).toEqual({
			min: 1,
			max: 3,
			maxIncluded: true,
		});
		for (let frame = 0; frame <= 90; frame += 0.25)
			expect(mediaSourceTime(map, frame, 30)).toBeGreaterThanOrEqual(1);
	});
	it("maps constant reverse speed and bounds its source range", () => {
		const map = MediaTimeRemapSchema.parse({
			kind: "rate",
			sourceStartSec: 4,
			rate: -2,
		});
		expect(mediaSourceTime(map, 30, 30)).toBe(2);
		expect(mediaSourceRange(map, 0, 30, 30)).toEqual({
			min: 2,
			max: 4,
			maxIncluded: true,
		});
	});
});
