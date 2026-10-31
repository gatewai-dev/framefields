import { describe, expect, it } from "vitest";
import {
	coveredCells,
	keepTracked,
	MASK_LOGIT,
	mergeSelections,
	uncovered,
} from "./selection.js";

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

/** 1008² logits, positive inside the rectangle (in 1008 px). */
function tracked(x0: number, x1: number, score = 5) {
	const logits = new Float32Array(1008 * 1008).fill(-MASK_LOGIT);
	for (let y = 0; y < 1008; y++)
		for (let x = x0; x < x1; x++) logits[y * 1008 + x] = MASK_LOGIT;
	return { logits, score };
}

/** A 288² instance, positive over columns [x0, x1). */
function instance(x0: number, x1: number): Float32Array {
	const logits = new Float32Array(288 * 288).fill(-3);
	for (let y = 0; y < 288; y++)
		for (let x = x0; x < x1; x++) logits[y * 288 + x] = 3;
	return logits;
}

describe("re-detection", () => {
	it("adds only instances the tracked objects do not already cover", () => {
		// Tracked: the left half. Instances: inside it, straddling (mostly outside), and outside.
		const covered = coveredCells([tracked(0, 504)]);
		const inside = instance(20, 100);
		const straddling = instance(130, 200);
		const outside = instance(200, 280);
		expect(uncovered([inside, straddling, outside], covered)).toEqual([
			straddling,
			outside,
		]);
	});

	it("treats a lost object (negative presence) as covering nothing", () => {
		const covered = coveredCells([tracked(0, 1008, -1)]);
		expect(uncovered([instance(0, 288)], covered)).toHaveLength(1);
	});

	it("keeps the tracked mask at full resolution and adds new instances to it", () => {
		const added = new Float32Array(1008 * 1008).fill(-MASK_LOGIT);
		added[1008 * 1008 - 1] = MASK_LOGIT;
		const seed = keepTracked(tracked(0, 2), added);
		expect(seed[0]).toBe(MASK_LOGIT);
		expect(seed[2]).toBe(-MASK_LOGIT);
		expect(seed[1008 * 1008 - 1]).toBe(MASK_LOGIT);
		expect(keepTracked(tracked(0, 2, -1), added)).toBe(added);
	});
});
