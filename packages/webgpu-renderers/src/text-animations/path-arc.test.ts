import { describe, expect, it } from "vitest";
import { evaluateCubicBezier, parseSvgPathToCubicBeziers } from "./path.js";

describe("SVG arcs in text paths", () => {
	it("turns an upper half circle into Bezier quarters on the circle", () => {
		// From (100, 300) over the top to (500, 300): radius 200 about (300, 300).
		const segs = parseSvgPathToCubicBeziers("M 100 300 A 200 200 0 0 1 500 300");
		expect(segs.length).toBe(2);
		expect(segs[0]!.p0).toEqual({ x: 100, y: 300 });
		expect(segs[1]!.p3).toEqual({ x: 500, y: 300 });
		for (const s of segs)
			for (const t of [0, 0.25, 0.5, 0.75, 1]) {
				const p = evaluateCubicBezier(s, t);
				expect(Math.hypot(p.x - 300, p.y - 300)).toBeCloseTo(200, 0);
				// Sweep flag 1 in a y-down space runs through the top (y < 300).
				expect(p.y).toBeLessThanOrEqual(300.001);
			}
	});

	it("handles relative arcs and the large-arc flag", () => {
		const small = parseSvgPathToCubicBeziers("M 0 0 a 100 100 0 0 1 100 100");
		const large = parseSvgPathToCubicBeziers("M 0 0 a 100 100 0 1 1 100 100");
		expect(small.length).toBe(1);
		expect(large.length).toBe(3);
		expect(large[large.length - 1]!.p3).toEqual({ x: 100, y: 100 });
	});
});
