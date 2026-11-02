import { describe, expect, it } from "vitest";
import { cachedPathFill, pathContours } from "./path-geometry.js";

/** The area the triangles cover (they never overlap). */
function covered(tris: Float32Array): number {
	let area = 0;
	for (let i = 0; i < tris.length; i += 6) {
		const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = tris.subarray(
			i,
			i + 6,
		);
		area += Math.abs(((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2);
	}
	return area;
}

const square = (x: number, y: number, s: number, reverse = false) =>
	reverse
		? `M${x} ${y} L${x} ${y + s} L${x + s} ${y + s} L${x + s} ${y} Z`
		: `M${x} ${y} L${x + s} ${y} L${x + s} ${y + s} L${x} ${y + s} Z`;

describe("compound path fills", () => {
	it("splits a path into its subpaths, even one starting where the last closed", () => {
		const d = `${square(0, 0, 10)} M0 0 L-10 0 L-10 -10 Z`;
		expect(pathContours(d).map((c) => c.length)).toEqual([4, 3]);
	});

	it("fills separate subpaths separately, with nothing bridging them", () => {
		const d = `${square(0, 0, 10)} ${square(100, 0, 10)}`;
		expect(covered(cachedPathFill(d))).toBeCloseTo(200);
	});

	it("cuts a hole wound the other way, and fills one wound the same way (nonzero)", () => {
		expect(
			covered(
				cachedPathFill(`${square(0, 0, 100)} ${square(25, 25, 50, true)}`),
			),
		).toBeCloseTo(10000 - 2500);
		expect(
			covered(cachedPathFill(`${square(0, 0, 100)} ${square(25, 25, 50)}`)),
		).toBeCloseTo(10000);
	});

	it("fills an island in a lake", () => {
		const d = `${square(0, 0, 100)} ${square(20, 20, 60, true)} ${square(40, 40, 20)}`;
		expect(covered(cachedPathFill(d))).toBeCloseTo(10000 - 3600 + 400);
	});

	it("fills neighbours that share an edge, as states on a map do", () => {
		const d = `${square(0, 0, 50)} ${square(50, 0, 50)} ${square(0, 50, 100)}`;
		expect(covered(cachedPathFill(d))).toBeCloseTo(2500 + 2500 + 10000);
	});

	it("fills curves and arcs as their flattened outline", () => {
		// A circle of radius 50 from two arcs (sweep 0 runs counter-clockwise on
		// screen), with a square hole wound the other way.
		const d = `M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z ${square(40, 40, 20)}`;
		const area = covered(cachedPathFill(d));
		expect(area).toBeGreaterThan(Math.PI * 2500 * 0.97 - 400);
		expect(area).toBeLessThan(Math.PI * 2500 - 400 + 1);
	});
});
