import { describe, expect, it } from "vitest";
import {
	beats,
	chain,
	cover,
	quantize,
	scaleFrames,
	staggerOffsets,
	toFrames,
} from "./timing.js";

describe("timing", () => {
	it("converts and rounds once", () => {
		expect(toFrames(1.51, 30)).toBe(45);
		expect(beats(2.5, 18)).toBe(45);
		expect(quantize(23, 9)).toBe(27);
		expect(quantize(23.4, undefined)).toBe(23);
		expect(scaleFrames(16, 60)).toBe(32);
		expect(scaleFrames(16, 24)).toBe(13);
		expect(() => toFrames(1, 0)).toThrow(/fps/);
	});

	it("staggers in every order", () => {
		expect(staggerOffsets(4, 3)).toEqual([0, 3, 6, 9]);
		expect(staggerOffsets(4, 3, "reverse")).toEqual([9, 6, 3, 0]);
		expect(staggerOffsets(5, 2, "center")).toEqual([4, 2, 0, 2, 4]);
		expect(staggerOffsets(5, 2, "edges")).toEqual([0, 2, 4, 2, 0]);
		const random = staggerOffsets(6, 1, "random", 9);
		expect([...random].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(staggerOffsets(6, 1, "random", 9)).toEqual(random);
		expect(staggerOffsets(0, 3)).toEqual([]);
	});

	it("chains and covers windows", () => {
		const w = chain([10, 5, 20], 4, 2);
		expect(w).toEqual([
			{ start: 4, end: 14 },
			{ start: 16, end: 21 },
			{ start: 23, end: 43 },
		]);
		expect(cover(w)).toEqual({ start: 4, end: 43 });
	});
});
