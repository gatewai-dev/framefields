import { describe, expect, it } from "vitest";
import { SAFE_INSETS, safeArea } from "./layout.js";

describe("safeArea", () => {
	it("picks the orientation from the canvas", () => {
		const r = safeArea({ width: 1000, height: 500 });
		expect([r.x, r.y, r.width, r.height].map(Math.round)).toEqual([
			60, 40, 880, 410,
		]);
		const portrait = safeArea({ width: 1000, height: 2000 });
		expect(portrait.y + portrait.height).toBeCloseTo(2000 * 0.76);
	});

	it("takes a forced orientation, insets, or a rect", () => {
		const rect = { x: 1, y: 2, width: 3, height: 4 };
		expect(safeArea({ width: 10, height: 10 }, rect)).toBe(rect);
		expect(
			safeArea({ width: 1000, height: 500 }, "landscape", SAFE_INSETS.captions)
				.x,
		).toBe(100);
	});
});
