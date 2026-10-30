import { describe, expect, it } from "vitest";
import { mergeSelections } from "./selection.js";

describe("mergeSelections", () => {
	it("keeps every instance in one mask, at its most confident logit", () => {
		const a = Float32Array.of(3, -2, -5, -1);
		const b = Float32Array.of(-4, 1, -6, -3);
		expect(Array.from(mergeSelections([a, b]))).toEqual([3, 1, -5, -1]);
		// Positive (selected) wherever any instance is.
		expect(Array.from(mergeSelections([a, b]), (v) => v > 0)).toEqual([
			true,
			true,
			false,
			false,
		]);
	});

	it("returns a single instance unchanged", () => {
		const a = Float32Array.of(2, -2);
		expect(Array.from(mergeSelections([a]))).toEqual([2, -2]);
	});
});
