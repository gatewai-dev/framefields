/**
 * Cubic Bezier and Speed Curve Solver for Motion Graphics
 * Provides analytical/Newton-Raphson solvers for unit easing curves and 2D spatial trajectory splines.
 */

export interface Point2D {
	x: number;
	y: number;
}

export interface SpatialKeyframePoint {
	frame: number;
	x: number;
	y: number;
	spatialTangentIn?: Point2D;
	spatialTangentOut?: Point2D;
}

export interface SplineSegment {
	p0: Point2D;
	c1: Point2D;
	c2: Point2D;
	p1: Point2D;
	startFrame: number;
	endFrame: number;
}

/**
 * Solves a cubic bezier curve defined by control points (x1, y1) and (x2, y2)
 * for a given progress parameter t in [0, 1].
 */
export function solveCubicBezier(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	t: number,
): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;

	// Check for linear edge case
	if (x1 === y1 && x2 === y2) return t;

	// Find u such that x(u) = t
	// x(u) = 3*(1-u)^2 * u * x1 + 3*(1-u) * u^2 * x2 + u^3
	// dx/du = 3*(1-u)^2 * x1 + 6*(1-u)*u * (x2 - x1) + 3*u^2 * (1 - x2)
	let u = t; // initial guess
	for (let i = 0; i < 8; i++) {
		const oneMinusU = 1 - u;
		const oneMinusU2 = oneMinusU * oneMinusU;
		const u2 = u * u;

		const currentX =
			3 * oneMinusU2 * u * x1 + 3 * oneMinusU * u2 * x2 + u2 * u;
		const diff = currentX - t;
		if (Math.abs(diff) < 1e-6) break;

		const dx =
			3 * oneMinusU2 * x1 +
			6 * oneMinusU * u * (x2 - x1) +
			3 * u2 * (1 - x2);

		if (Math.abs(dx) < 1e-6) break;
		u -= diff / dx;
		u = Math.max(0, Math.min(1, u));
	}

	// Bisection fallback if Newton didn't converge within bounds
	const oneMinusU = 1 - u;
	const checkX =
		3 * oneMinusU * oneMinusU * u * x1 +
		3 * oneMinusU * u * u * x2 +
		u * u * u;

	if (Math.abs(checkX - t) > 1e-3) {
		let low = 0;
		let high = 1;
		u = t;
		for (let i = 0; i < 16; i++) {
			const mid = (low + high) * 0.5;
			const oMid = 1 - mid;
			const xMid =
				3 * oMid * oMid * mid * x1 +
				3 * oMid * mid * mid * x2 +
				mid * mid * mid;
			if (Math.abs(xMid - t) < 1e-5) {
				u = mid;
				break;
			}
			if (xMid < t) low = mid;
			else high = mid;
			u = mid;
		}
	}

	// Evaluate y(u)
	const oU = 1 - u;
	return (
		3 * oU * oU * u * y1 +
		3 * oU * u * u * y2 +
		u * u * u
	);
}

/**
 * Calculates the instantaneous speed (derivative |dy/dt|) at parameter t in [0, 1].
 */
export function solveBezierDerivative(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	t: number,
): number {
	const clampedT = Math.max(0, Math.min(1, t));
	const eps = 1e-4;
	const t0 = Math.max(0, clampedT - eps);
	const t1 = Math.min(1, clampedT + eps);
	const dt = t1 - t0;
	if (dt <= 0) return 0;

	const y0 = solveCubicBezier(x1, y1, x2, y2, t0);
	const y1Val = solveCubicBezier(x1, y1, x2, y2, t1);
	return Math.abs((y1Val - y0) / dt);
}

/**
 * Generates an array of samples along the cubic bezier curve for visualization.
 */
export function sampleBezierCurve(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	steps = 60,
): Array<{ t: number; value: number; speed: number }> {
	const samples: Array<{ t: number; value: number; speed: number }> = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const value = solveCubicBezier(x1, y1, x2, y2, t);
		const speed = solveBezierDerivative(x1, y1, x2, y2, t);
		samples.push({ t, value, speed });
	}
	return samples;
}

/**
 * Converts Catmull-Rom four-point configuration to cubic Bezier control points.
 */
export function catmullRomToBezier(
	p0: Point2D,
	p1: Point2D,
	p2: Point2D,
	p3: Point2D,
): { c1: Point2D; c2: Point2D } {
	return {
		c1: {
			x: p1.x + (p2.x - p0.x) / 6,
			y: p1.y + (p2.y - p0.y) / 6,
		},
		c2: {
			x: p2.x - (p3.x - p1.x) / 6,
			y: p2.y - (p3.y - p1.y) / 6,
		},
	};
}

/**
 * Builds smooth Bezier spline segments between an ordered array of spatial keyframes.
 * Respects custom spatial tangents if authored; otherwise uses smooth Catmull-Rom.
 */
export function buildSpatialSplineSegments(
	points: SpatialKeyframePoint[],
): SplineSegment[] {
	if (points.length < 2) return [];

	const segments: SplineSegment[] = [];

	for (let i = 0; i < points.length - 1; i++) {
		const curr = points[i];
		const next = points[i + 1];

		let c1: Point2D;
		let c2: Point2D;

		if (curr.spatialTangentOut) {
			c1 = {
				x: curr.x + curr.spatialTangentOut.x,
				y: curr.y + curr.spatialTangentOut.y,
			};
		} else {
			// Natural Catmull-Rom tangent
			const prev = i > 0 ? points[i - 1] : curr;
			const pNextNext = i + 2 < points.length ? points[i + 2] : next;
			const cr = catmullRomToBezier(prev, curr, next, pNextNext);
			c1 = cr.c1;
		}

		if (next.spatialTangentIn) {
			c2 = {
				x: next.x + next.spatialTangentIn.x,
				y: next.y + next.spatialTangentIn.y,
			};
		} else {
			const prev = i > 0 ? points[i - 1] : curr;
			const pNextNext = i + 2 < points.length ? points[i + 2] : next;
			const cr = catmullRomToBezier(prev, curr, next, pNextNext);
			c2 = cr.c2;
		}

		segments.push({
			p0: { x: curr.x, y: curr.y },
			c1,
			c2,
			p1: { x: next.x, y: next.y },
			startFrame: curr.frame,
			endFrame: next.frame,
		});
	}

	return segments;
}

/**
 * Samples points along a cubic bezier segment between p0 and p1 with control points c1, c2.
 */
export function sampleCubicBezierSegment(
	p0: Point2D,
	c1: Point2D,
	c2: Point2D,
	p1: Point2D,
	steps = 20,
): Point2D[] {
	const pts: Point2D[] = [];
	for (let i = 0; i <= steps; i++) {
		const u = i / steps;
		const oU = 1 - u;
		const oU2 = oU * oU;
		const oU3 = oU2 * oU;
		const u2 = u * u;
		const u3 = u2 * u;

		const x =
			oU3 * p0.x +
			3 * oU2 * u * c1.x +
			3 * oU * u2 * c2.x +
			u3 * p1.x;
		const y =
			oU3 * p0.y +
			3 * oU2 * u * c1.y +
			3 * oU * u2 * c2.y +
			u3 * p1.y;
		pts.push({ x, y });
	}
	return pts;
}
