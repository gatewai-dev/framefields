import { describe, expect, it } from "vitest";
import type { InstanceMask } from "../types.js";
import { maskBounds, mergeSubjectMask, selectSubjectMask } from "./subject.js";

const W = 20;
const H = 20;

function rect(
	category: string,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	detectionIndex = 0,
): InstanceMask {
	const mask = new Uint8Array(W * H);
	let area = 0;
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			mask[y * W + x] = 255;
			area++;
		}
	}
	return {
		category,
		mask,
		width: W,
		height: H,
		area,
		coverage: area / (W * H),
		detectionIndex,
	};
}

describe("subject selection", () => {
	it("prefers a person over a larger non-person instance", () => {
		const person = rect("person", 0, 0, 2, 2);
		const car = rect("car", 5, 5, 15, 15);
		expect(selectSubjectMask([car, person])).toBe(person);
		expect(selectSubjectMask([car])).toBe(car);
		expect(selectSubjectMask([])).toBeUndefined();
	});

	it("without a person, prefers the most confident instance over a large backdrop", () => {
		const table = rect("dining table", 0, 0, 19, 19, 1);
		const cup = rect("cup", 6, 6, 12, 12, 0);
		expect(selectSubjectMask([table, cup])).toBe(cup);
	});

	it("does not merge a container much larger than the subject", () => {
		const figure = rect("person", 9, 9, 10, 11);
		const tunnel = rect("clock", 0, 0, 19, 19, 1);
		expect(mergeSubjectMask([tunnel, figure])).toBe(figure);
	});

	it("merges instances overlapping the subject (e.g. a dress detected as another class)", () => {
		const body = rect("person", 8, 2, 12, 17);
		const dress = rect("horse", 4, 6, 16, 16);
		const farCar = rect("car", 0, 18, 3, 19);
		const merged = mergeSubjectMask([farCar, dress, body]);
		expect(merged?.category).toBe("person");
		expect(merged?.mask[10 * W + 5]).toBe(255); // dress pixel joined the subject
		expect(merged?.mask[19 * W + 1]).toBe(0); // unrelated car stays out
		expect(merged?.area).toBe(body.area + dress.area - 5 * 11);
	});

	it("maskBounds returns tight bounds or null", () => {
		expect(maskBounds(rect("x", 3, 4, 7, 9))).toEqual({
			x0: 3,
			y0: 4,
			x1: 7,
			y1: 9,
		});
		expect(
			maskBounds({ ...rect("x", 0, 0, 0, 0), mask: new Uint8Array(W * H) }),
		).toBeNull();
	});
});
