import { describe, expect, it } from "vitest";
import { flattenPath, morphPath } from "./path-morph.js";

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("morphPath", () => {
	it("returns the end paths at 0 and 1", () => {
		expect(morphPath("M0 0L10 0L10 10Z", "M0 0L20 0L20 20Z", 0)).toBe(
			"M0 0L10 0L10 10Z",
		);
		expect(morphPath("M0 0L10 0L10 10Z", "M0 0L20 0L20 20Z", 1)).toBe(
			"M0 0L20 0L20 20Z",
		);
	});

	it("halfway between a small and a big square is a medium square", () => {
		const d = morphPath("M40 40 H60 V60 H40 Z", "M0 0 H100 V100 H0 Z", 0.5);
		const v = nums(d);
		const xs = v.filter((_, i) => i % 2 === 0);
		const ys = v.filter((_, i) => i % 2 === 1);
		expect(Math.min(...xs)).toBeCloseTo(20, 0);
		expect(Math.max(...xs)).toBeCloseTo(80, 0);
		expect(Math.min(...ys)).toBeCloseTo(20, 0);
		expect(Math.max(...ys)).toBeCloseTo(80, 0);
		expect(d.endsWith("Z")).toBe(true);
	});

	it("lines up paths that start at different corners or wind the other way", () => {
		// Same square, started at the opposite corner and drawn counter-clockwise.
		const a = "M0 0 H100 V100 H0 Z";
		const b = "M100 100 V0 H0 V100 Z";
		const v = nums(morphPath(a, b, 0.5));
		// Matched point for point, the halfway shape is the square itself.
		const xs = v.filter((_, i) => i % 2 === 0);
		expect(Math.min(...xs)).toBeCloseTo(0, 0);
		expect(Math.max(...xs)).toBeCloseTo(100, 0);
	});

	it("flattens curves and arcs", () => {
		const [circle] = flattenPath(
			"M50 0 A50 50 0 1 1 49.99 0 Z M0 0 C0 10 10 10 10 0",
		);
		for (const [x, y] of circle.pts) {
			expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(50, 0);
		}
	});
});
