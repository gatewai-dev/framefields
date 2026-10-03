import { describe, expect, it } from "vitest";
import {
	buildSpatialSplineSegments,
	catmullRomToBezier,
	sampleBezierCurve,
	sampleCubicBezierSegment,
	solveBezierDerivative,
	solveCubicBezier,
} from "./bezier-solver.js";

describe("bezier-solver", () => {
	it("evaluates linear cubic bezier curve correctly", () => {
		expect(solveCubicBezier(0, 0, 1, 1, 0)).toBe(0);
		expect(solveCubicBezier(0, 0, 1, 1, 0.5)).toBeCloseTo(0.5, 3);
		expect(solveCubicBezier(0, 0, 1, 1, 1)).toBe(1);
	});

	it("evaluates standard ease-in and ease-out curves correctly", () => {
		// Ease-in: slow start, steep finish (e.g. 0.42, 0, 1, 1)
		const easeInMid = solveCubicBezier(0.42, 0, 1, 1, 0.5);
		expect(easeInMid).toBeLessThan(0.5);

		// Ease-out: fast start, slow finish (e.g. 0, 0, 0.58, 1)
		const easeOutMid = solveCubicBezier(0, 0, 0.58, 1, 0.5);
		expect(easeOutMid).toBeGreaterThan(0.5);
	});

	it("calculates derivative (speed) accurately", () => {
		// For linear, speed should be constant ~1.0
		const linearSpeed = solveBezierDerivative(0, 0, 1, 1, 0.5);
		expect(linearSpeed).toBeCloseTo(1.0, 2);

		// Ease-out has higher initial speed and lower final speed
		const easeOutStartSpeed = solveBezierDerivative(0.1, 0.8, 0.2, 1.0, 0.1);
		const easeOutEndSpeed = solveBezierDerivative(0.1, 0.8, 0.2, 1.0, 0.9);
		expect(easeOutStartSpeed).toBeGreaterThan(easeOutEndSpeed);
	});

	it("samples bezier curve points across 0..1 range", () => {
		const samples = sampleBezierCurve(0.25, 0.1, 0.25, 1.0, 10);
		expect(samples).toHaveLength(11);
		expect(samples[0].t).toBe(0);
		expect(samples[0].value).toBe(0);
		expect(samples[10].t).toBe(1);
		expect(samples[10].value).toBe(1);
	});

	it("converts Catmull-Rom to Cubic Bezier control points", () => {
		const p0 = { x: 0, y: 0 };
		const p1 = { x: 100, y: 0 };
		const p2 = { x: 200, y: 100 };
		const p3 = { x: 300, y: 100 };

		const { c1, c2 } = catmullRomToBezier(p0, p1, p2, p3);
		expect(c1.x).toBeCloseTo(100 + 200 / 6, 2);
		expect(c1.y).toBeCloseTo(100 / 6, 2);
		expect(c2.x).toBeCloseTo(200 - 200 / 6, 2);
	});

	it("builds spatial spline segments with custom or Catmull-Rom tangents", () => {
		const points = [
			{ frame: 0, x: 0, y: 0, spatialTangentOut: { x: 50, y: -20 } },
			{ frame: 30, x: 200, y: 100, spatialTangentIn: { x: -30, y: 10 } },
			{ frame: 60, x: 400, y: 100 },
		];

		const segments = buildSpatialSplineSegments(points);
		expect(segments).toHaveLength(2);

		// Segment 0 uses authored tangents
		expect(segments[0].c1).toEqual({ x: 50, y: -20 });
		expect(segments[0].c2).toEqual({ x: 170, y: 110 });

		// Segment 1 uses Catmull-Rom tangent computation
		expect(segments[1].p0).toEqual({ x: 200, y: 100 });
		expect(segments[1].p1).toEqual({ x: 400, y: 100 });
	});

	it("samples cubic bezier segment points smoothly", () => {
		const p0 = { x: 0, y: 0 };
		const c1 = { x: 50, y: 100 };
		const c2 = { x: 150, y: 100 };
		const p1 = { x: 200, y: 0 };

		const sampled = sampleCubicBezierSegment(p0, c1, c2, p1, 10);
		expect(sampled).toHaveLength(11);
		expect(sampled[0]).toEqual(p0);
		expect(sampled[10]).toEqual(p1);
		// Midpoint should have positive y due to control points
		expect(sampled[5].y).toBeGreaterThan(50);
	});
});
