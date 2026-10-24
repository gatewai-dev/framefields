import { describe, expect, it } from "vitest";
import { arcPath, catmullRom, toPathData } from "./path.js";

describe("path", () => {
	it("passes through every control point", () => {
		const pts: [number, number][] = [
			[0, 0],
			[100, 50],
			[200, 0],
			[300, 80],
		];
		const curve = catmullRom(pts, 8);
		for (const p of pts) {
			expect(
				curve.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6),
			).toBe(true);
		}
	});

	it("samples by arc length", () => {
		const path = arcPath([
			[0, 0],
			[100, 0],
			[100, 100],
		]);
		expect(path.length).toBe(200);
		expect(path.at(0.25)).toEqual([50, 0]);
		expect(path.at(0.75)).toEqual([100, 50]);
		expect(path.at(2)).toEqual([100, 100]);
		expect(path.angleAt(0.1)).toBeCloseTo(0);
		expect(path.angleAt(0.9)).toBeCloseTo(Math.PI / 2);
	});

	it("writes compact path data", () => {
		expect(
			toPathData(
				[
					[0, 0],
					[1.234, 5],
				],
				true,
			),
		).toBe("M0 0 L1.23 5 Z");
	});
});
