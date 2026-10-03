/**
 * @file packages/compositions/src/program/text-animations/path.ts
 * Mathematical curve parameterization, Arc-Length LUTs, and path generators.
 */

import type { CubicBezierSegment, TextPathSource, Vec2 } from "./types.js";

export interface ArcLengthLUTEntry {
	distance: number;
	t: number;
}

export interface PathChainLUTEntry {
	distance: number;
	segmentIndex: number;
	t: number;
}

export interface PathSegmentLUT {
	segmentIndex: number;
	startDistance: number;
	length: number;
	lut: ArcLengthLUTEntry[];
}

export interface PathChainLUT {
	totalLength: number;
	entries: PathChainLUTEntry[];
	segments?: PathSegmentLUT[];
}

/**
 * Evaluates a point on a cubic Bezier curve at parameter t in [0, 1].
 */
export function evaluateCubicBezier(
	segment: CubicBezierSegment,
	t: number,
): Vec2 {
	const u = 1 - t;
	const tt = t * t;
	const uu = u * u;
	const uuu = uu * u;
	const ttt = tt * t;

	return {
		x:
			uuu * segment.p0.x +
			3 * uu * t * segment.p1.x +
			3 * u * tt * segment.p2.x +
			ttt * segment.p3.x,
		y:
			uuu * segment.p0.y +
			3 * uu * t * segment.p1.y +
			3 * u * tt * segment.p2.y +
			ttt * segment.p3.y,
	};
}

/**
 * Evaluates the first derivative (tangent velocity vector) of a cubic Bezier curve at parameter t.
 */
export function evaluateCubicBezierDerivative(
	segment: CubicBezierSegment,
	t: number,
): Vec2 {
	const u = 1 - t;
	return {
		x:
			3 * u * u * (segment.p1.x - segment.p0.x) +
			6 * u * t * (segment.p2.x - segment.p1.x) +
			3 * t * t * (segment.p3.x - segment.p2.x),
		y:
			3 * u * u * (segment.p1.y - segment.p0.y) +
			6 * u * t * (segment.p2.y - segment.p1.y) +
			3 * t * t * (segment.p3.y - segment.p2.y),
	};
}

/**
 * Generates an arc-length parameterization lookup table (LUT) for a cubic Bezier segment.
 * Ensures glyphs travel with uniform speed and do not bunch up on tight curve bends.
 */
export function generateArcLengthLUT(
	segment: CubicBezierSegment,
	samples = 100,
): { lut: ArcLengthLUTEntry[]; totalLength: number } {
	const lut: ArcLengthLUTEntry[] = [{ distance: 0, t: 0 }];
	let accumulatedDist = 0;
	let prevPoint = segment.p0;

	for (let i = 1; i <= samples; i++) {
		const t = i / samples;
		const currentPoint = evaluateCubicBezier(segment, t);
		const dx = currentPoint.x - prevPoint.x;
		const dy = currentPoint.y - prevPoint.y;
		const dist = Math.hypot(dx, dy);
		accumulatedDist += dist;
		lut.push({ distance: accumulatedDist, t });
		prevPoint = currentPoint;
	}

	return { lut, totalLength: accumulatedDist };
}

/**
 * Maps a distance along the curve (in pixels) to normalized curve parameter t via binary search on the LUT.
 */
export function distanceToCurveParameter(
	lut: ArcLengthLUTEntry[],
	distance: number,
	totalLength: number,
): number {
	if (distance <= 0) return 0;
	if (distance >= totalLength) return 1;

	let low = 0;
	let high = lut.length - 1;

	while (low <= high) {
		const mid = (low + high) >> 1;
		if (lut[mid].distance < distance) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	const index = Math.max(1, Math.min(low, lut.length - 1));
	const prev = lut[index - 1];
	const curr = lut[index];
	const segmentDist = curr.distance - prev.distance;

	if (segmentDist <= 1e-6) return prev.t;
	const ratio = (distance - prev.distance) / segmentDist;
	return prev.t + ratio * (curr.t - prev.t);
}

/**
 * Samples position and baseline tangent orientation angle along a curve at distance `dist`.
 */
export function sampleCurveGeometry(
	segment: CubicBezierSegment,
	lut: ArcLengthLUTEntry[],
	totalLength: number,
	distance: number,
): { position: Vec2; tangentAngleDeg: number; normal: Vec2 } {
	const t = distanceToCurveParameter(lut, distance, totalLength);
	const pos = evaluateCubicBezier(segment, t);
	const deriv = evaluateCubicBezierDerivative(segment, t);
	const length = Math.hypot(deriv.x, deriv.y);
	const nx = length > 1e-6 ? -deriv.y / length : 0;
	const ny = length > 1e-6 ? deriv.x / length : 1;
	const tangentAngleDeg = (Math.atan2(deriv.y, deriv.x) * 180) / Math.PI;

	return {
		position: pos,
		tangentAngleDeg,
		normal: { x: nx, y: ny },
	};
}

/**
 * Builds a cumulative Arc-Length LUT across a chain of Cubic Bezier segments.
 */
export function buildPathLUT(
	segments: CubicBezierSegment[],
	samplesPerSegment = 50,
): PathChainLUT {
	if (segments.length === 0) {
		return {
			totalLength: 0,
			entries: [{ distance: 0, segmentIndex: 0, t: 0 }],
			segments: [],
		};
	}

	const segLuts: PathSegmentLUT[] = [];
	const entries: PathChainLUTEntry[] = [];
	let accumulatedDist = 0;

	for (let segIdx = 0; segIdx < segments.length; segIdx++) {
		const seg = segments[segIdx];
		const { lut: segLut, totalLength: segLength } = generateArcLengthLUT(
			seg,
			samplesPerSegment,
		);

		segLuts.push({
			segmentIndex: segIdx,
			startDistance: accumulatedDist,
			length: segLength,
			lut: segLut,
		});

		for (let i = 0; i < segLut.length; i++) {
			entries.push({
				distance: accumulatedDist + segLut[i].distance,
				segmentIndex: segIdx,
				t: segLut[i].t,
			});
		}

		accumulatedDist += segLength;
	}

	return {
		totalLength: accumulatedDist,
		entries,
		segments: segLuts,
	};
}

/**
 * Samples position, tangent angle, and normal across a chain of Cubic Bezier segments.
 */
export function samplePathChainGeometry(
	segments: CubicBezierSegment[],
	chainLUT: PathChainLUT,
	distance: number,
): { position: Vec2; tangentAngleDeg: number; normal: Vec2 } {
	if (segments.length === 0) {
		return {
			position: { x: 0, y: 0 },
			tangentAngleDeg: 0,
			normal: { x: 0, y: 1 },
		};
	}

	const totalLength = chainLUT.totalLength;

	if (distance <= 0) {
		const seg = segments[0];
		const deriv = evaluateCubicBezierDerivative(seg, 0);
		const length = Math.hypot(deriv.x, deriv.y);
		const ux = length > 1e-6 ? deriv.x / length : 1;
		const uy = length > 1e-6 ? deriv.y / length : 0;
		const pos = {
			x: seg.p0.x + ux * distance,
			y: seg.p0.y + uy * distance,
		};
		const nx = length > 1e-6 ? -deriv.y / length : 0;
		const ny = length > 1e-6 ? deriv.x / length : 1;
		return {
			position: pos,
			tangentAngleDeg: (Math.atan2(deriv.y, deriv.x) * 180) / Math.PI,
			normal: { x: nx, y: ny },
		};
	}

	if (distance >= totalLength) {
		const lastSeg = segments[segments.length - 1];
		const deriv = evaluateCubicBezierDerivative(lastSeg, 1);
		const length = Math.hypot(deriv.x, deriv.y);
		const ux = length > 1e-6 ? deriv.x / length : 1;
		const uy = length > 1e-6 ? deriv.y / length : 0;
		const overflow = distance - totalLength;
		const pos = {
			x: lastSeg.p3.x + ux * overflow,
			y: lastSeg.p3.y + uy * overflow,
		};
		const nx = length > 1e-6 ? -deriv.y / length : 0;
		const ny = length > 1e-6 ? deriv.x / length : 1;
		return {
			position: pos,
			tangentAngleDeg: (Math.atan2(deriv.y, deriv.x) * 180) / Math.PI,
			normal: { x: nx, y: ny },
		};
	}

	let segIdx = 0;
	let t = 0;

	if (chainLUT.segments && chainLUT.segments.length > 0) {
		let low = 0;
		let high = chainLUT.segments.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			const segLUT = chainLUT.segments[mid];
			if (distance < segLUT.startDistance) {
				high = mid - 1;
			} else if (distance > segLUT.startDistance + segLUT.length) {
				low = mid + 1;
			} else {
				low = mid;
				break;
			}
		}
		const sIdx = Math.max(0, Math.min(low, chainLUT.segments.length - 1));
		const segLUT = chainLUT.segments[sIdx];
		segIdx = segLUT.segmentIndex;
		const localDist = distance - segLUT.startDistance;
		t = distanceToCurveParameter(segLUT.lut, localDist, segLUT.length);
	} else {
		let low = 0;
		let high = chainLUT.entries.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (chainLUT.entries[mid].distance < distance) {
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		const index = Math.max(1, Math.min(low, chainLUT.entries.length - 1));
		const prev = chainLUT.entries[index - 1];
		const curr = chainLUT.entries[index];
		const segmentDist = curr.distance - prev.distance;
		const ratio =
			segmentDist > 1e-6 ? (distance - prev.distance) / segmentDist : 0;
		segIdx = curr.segmentIndex;
		t =
			prev.segmentIndex === curr.segmentIndex
				? prev.t + ratio * (curr.t - prev.t)
				: curr.t;
	}

	const segment = segments[segIdx] ?? segments[0];
	const pos = evaluateCubicBezier(segment, t);
	const deriv = evaluateCubicBezierDerivative(segment, t);
	const length = Math.hypot(deriv.x, deriv.y);
	const nx = length > 1e-6 ? -deriv.y / length : 0;
	const ny = length > 1e-6 ? deriv.x / length : 1;
	const tangentAngleDeg = (Math.atan2(deriv.y, deriv.x) * 180) / Math.PI;

	return {
		position: pos,
		tangentAngleDeg,
		normal: { x: nx, y: ny },
	};
}

/**
 * Converts an ellipse arc into cubic Bezier segments (up to 90 degrees per segment).
 */
export function ellipseToCubicBeziers(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	startAngleDeg = 0,
	endAngleDeg = 360,
): CubicBezierSegment[] {
	const startRad = (startAngleDeg * Math.PI) / 180;
	const endRad = (endAngleDeg * Math.PI) / 180;
	const totalSweep = endRad - startRad;

	// Keep sign, split into chunks of at most pi/2 (90 deg)
	const numSegments = Math.max(
		1,
		Math.ceil(Math.abs(totalSweep) / (Math.PI / 2)),
	);
	const sweepStep = totalSweep / numSegments;
	const segments: CubicBezierSegment[] = [];

	for (let i = 0; i < numSegments; i++) {
		const a0 = startRad + i * sweepStep;
		const a1 = a0 + sweepStep;
		const halfSweep = sweepStep / 2;
		// Standard constant for cubic approximation of circular/elliptical arc
		const k = (4 / 3) * Math.tan(halfSweep / 2);

		const cos0 = Math.cos(a0);
		const sin0 = Math.sin(a0);
		const cos1 = Math.cos(a1);
		const sin1 = Math.sin(a1);

		const p0: Vec2 = { x: cx + rx * cos0, y: cy + ry * sin0 };
		const p1: Vec2 = { x: p0.x - k * rx * sin0, y: p0.y + k * ry * cos0 };
		const p3: Vec2 = { x: cx + rx * cos1, y: cy + ry * sin1 };
		const p2: Vec2 = { x: p3.x + k * rx * sin1, y: p3.y - k * ry * cos1 };

		segments.push({ p0, p1, p2, p3 });
	}

	return segments;
}

/**
 * Converts a sinusoidal wave into cubic Bezier segments per half-cycle.
 */
export function waveToCubicBeziers(
	startX: number,
	startY: number,
	length: number,
	amplitude: number,
	frequency: number,
	phaseDeg = 0,
): CubicBezierSegment[] {
	const phaseRad = (phaseDeg * Math.PI) / 180;
	const totalCycles =
		frequency < 0.1 && frequency * length >= 0.25
			? frequency * length
			: Math.max(0.5, frequency);
	const halfCycles = Math.max(1, Math.round(totalCycles * 2));
	const dx = length / halfCycles;
	const segments: CubicBezierSegment[] = [];

	for (let i = 0; i < halfCycles; i++) {
		const t0 = (i / halfCycles) * (2 * Math.PI * totalCycles) + phaseRad;
		const t1 = ((i + 1) / halfCycles) * (2 * Math.PI * totalCycles) + phaseRad;

		const x0 = startX + i * dx;
		const x3 = startX + (i + 1) * dx;
		const y0 = startY + amplitude * Math.sin(t0);
		const y3 = startY + amplitude * Math.sin(t1);

		const slope0 = amplitude * Math.cos(t0) * (Math.PI / 3);
		const slope1 = amplitude * Math.cos(t1) * (Math.PI / 3);

		const p0: Vec2 = { x: x0, y: y0 };
		const p1: Vec2 = { x: x0 + dx / 3, y: y0 + slope0 };
		const p2: Vec2 = { x: x3 - dx / 3, y: y3 - slope1 };
		const p3: Vec2 = { x: x3, y: y3 };

		segments.push({ p0, p1, p2, p3 });
	}

	return segments;
}

/**
 * An SVG elliptical arc (endpoint form, SVG 1.1 F.6.5) as cubic Bezier
 * segments of at most 90° each.
 */
export function svgArcToCubicBeziers(
	x1: number,
	y1: number,
	rxIn: number,
	ryIn: number,
	rotationDeg: number,
	largeArc: boolean,
	sweep: boolean,
	x2: number,
	y2: number,
): CubicBezierSegment[] {
	if (x1 === x2 && y1 === y2) return [];
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	if (rx === 0 || ry === 0) {
		return [
			{
				p0: { x: x1, y: y1 },
				p1: { x: x1 + (x2 - x1) / 3, y: y1 + (y2 - y1) / 3 },
				p2: { x: x1 + (2 * (x2 - x1)) / 3, y: y1 + (2 * (y2 - y1)) / 3 },
				p3: { x: x2, y: y2 },
			},
		];
	}
	const phi = (rotationDeg * Math.PI) / 180;
	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);
	// Step 1: the midpoint in the ellipse's own axes.
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const x1p = cosPhi * dx + sinPhi * dy;
	const y1p = -sinPhi * dx + cosPhi * dy;
	// Radii too small to reach the endpoint scale up (F.6.6).
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	// Step 2: the centre in the ellipse's axes, then in user space.
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
	const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
	const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
	const cxp = (coef * rx * y1p) / ry;
	const cyp = (-coef * ry * x1p) / rx;
	const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
	const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
	// Step 3: start angle and sweep.
	const angle = (ux: number, uy: number, vx: number, vy: number) =>
		Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
	let delta = angle(
		(x1p - cxp) / rx,
		(y1p - cyp) / ry,
		(-x1p - cxp) / rx,
		(-y1p - cyp) / ry,
	);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;

	const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
	const step = delta / n;
	const k = (4 / 3) * Math.tan(step / 4);
	const point = (a: number): Vec2 => ({
		x: cx + rx * Math.cos(a) * cosPhi - ry * Math.sin(a) * sinPhi,
		y: cy + rx * Math.cos(a) * sinPhi + ry * Math.sin(a) * cosPhi,
	});
	const tangent = (a: number): Vec2 => ({
		x: -rx * Math.sin(a) * cosPhi - ry * Math.cos(a) * sinPhi,
		y: -rx * Math.sin(a) * sinPhi + ry * Math.cos(a) * cosPhi,
	});
	const segments: CubicBezierSegment[] = [];
	for (let s = 0; s < n; s++) {
		const a0 = theta1 + s * step;
		const a1 = a0 + step;
		const p0 = point(a0);
		const p3 = point(a1);
		const t0 = tangent(a0);
		const t1 = tangent(a1);
		segments.push({
			p0,
			p1: { x: p0.x + k * t0.x, y: p0.y + k * t0.y },
			p2: { x: p3.x - k * t1.x, y: p3.y - k * t1.y },
			p3,
		});
	}
	// Land exactly on the endpoint the path asked for.
	segments[segments.length - 1]!.p3 = { x: x2, y: y2 };
	return segments;
}

/**
 * Converts SVG path data string into a chain of Cubic Bezier segments.
 */
export function parseSvgPathToCubicBeziers(d: string): CubicBezierSegment[] {
	const segments: CubicBezierSegment[] = [];
	const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gi);
	if (!tokens || tokens.length === 0) return segments;

	let currentX = 0;
	let currentY = 0;
	let startX = 0;
	let startY = 0;
	let lastControlX = 0;
	let lastControlY = 0;
	let lastCommand = "";

	let i = 0;
	const nextNum = (): number => {
		if (i >= tokens.length) return 0;
		return Number.parseFloat(tokens[i++]);
	};

	while (i < tokens.length) {
		const token = tokens[i++];
		const isCommand = /^[a-df-z]$/i.test(token);
		const cmd = isCommand ? token : lastCommand;
		if (!isCommand) i--; // put number back if repeated coords

		switch (cmd) {
			case "M": {
				currentX = nextNum();
				currentY = nextNum();
				startX = currentX;
				startY = currentY;
				lastCommand = "L";
				break;
			}
			case "m": {
				currentX += nextNum();
				currentY += nextNum();
				startX = currentX;
				startY = currentY;
				lastCommand = "l";
				break;
			}
			case "L": {
				const x = nextNum();
				const y = nextNum();
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: {
						x: currentX + (x - currentX) / 3,
						y: currentY + (y - currentY) / 3,
					},
					p2: {
						x: currentX + (2 * (x - currentX)) / 3,
						y: currentY + (2 * (y - currentY)) / 3,
					},
					p3: { x, y },
				});
				currentX = x;
				currentY = y;
				lastCommand = "L";
				break;
			}
			case "l": {
				const dx = nextNum();
				const dy = nextNum();
				const x = currentX + dx;
				const y = currentY + dy;
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: currentX + dx / 3, y: currentY + dy / 3 },
					p2: { x: currentX + (2 * dx) / 3, y: currentY + (2 * dy) / 3 },
					p3: { x, y },
				});
				currentX = x;
				currentY = y;
				lastCommand = "l";
				break;
			}
			case "H": {
				const x = nextNum();
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: currentX + (x - currentX) / 3, y: currentY },
					p2: { x: currentX + (2 * (x - currentX)) / 3, y: currentY },
					p3: { x, y: currentY },
				});
				currentX = x;
				lastCommand = "H";
				break;
			}
			case "h": {
				const dx = nextNum();
				const x = currentX + dx;
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: currentX + dx / 3, y: currentY },
					p2: { x: currentX + (2 * dx) / 3, y: currentY },
					p3: { x, y: currentY },
				});
				currentX = x;
				lastCommand = "h";
				break;
			}
			case "V": {
				const y = nextNum();
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: currentX, y: currentY + (y - currentY) / 3 },
					p2: { x: currentX, y: currentY + (2 * (y - currentY)) / 3 },
					p3: { x: currentX, y },
				});
				currentY = y;
				lastCommand = "V";
				break;
			}
			case "v": {
				const dy = nextNum();
				const y = currentY + dy;
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: currentX, y: currentY + dy / 3 },
					p2: { x: currentX, y: currentY + (2 * dy) / 3 },
					p3: { x: currentX, y },
				});
				currentY = y;
				lastCommand = "v";
				break;
			}
			case "C": {
				const x1 = nextNum();
				const y1 = nextNum();
				const x2 = nextNum();
				const y2 = nextNum();
				const x = nextNum();
				const y = nextNum();
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: x1, y: y1 },
					p2: { x: x2, y: y2 },
					p3: { x, y },
				});
				lastControlX = x2;
				lastControlY = y2;
				currentX = x;
				currentY = y;
				lastCommand = "C";
				break;
			}
			case "c": {
				const dx1 = nextNum();
				const dy1 = nextNum();
				const dx2 = nextNum();
				const dy2 = nextNum();
				const dx = nextNum();
				const dy = nextNum();
				const x1 = currentX + dx1;
				const y1 = currentY + dy1;
				const x2 = currentX + dx2;
				const y2 = currentY + dy2;
				const x = currentX + dx;
				const y = currentY + dy;
				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: x1, y: y1 },
					p2: { x: x2, y: y2 },
					p3: { x, y },
				});
				lastControlX = x2;
				lastControlY = y2;
				currentX = x;
				currentY = y;
				lastCommand = "c";
				break;
			}
			case "S":
			case "s": {
				const isRel = cmd === "s";
				const dx2 = nextNum();
				const dy2 = nextNum();
				const dx = nextNum();
				const dy = nextNum();
				const x2 = isRel ? currentX + dx2 : dx2;
				const y2 = isRel ? currentY + dy2 : dy2;
				const x = isRel ? currentX + dx : dx;
				const y = isRel ? currentY + dy : dy;

				// Reflect last control point if previous was C/c/S/s
				let x1 = currentX;
				let y1 = currentY;
				if (/^[cs]$/i.test(lastCommand)) {
					x1 = 2 * currentX - lastControlX;
					y1 = 2 * currentY - lastControlY;
				}

				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: x1, y: y1 },
					p2: { x: x2, y: y2 },
					p3: { x, y },
				});
				lastControlX = x2;
				lastControlY = y2;
				currentX = x;
				currentY = y;
				lastCommand = cmd;
				break;
			}
			case "Q":
			case "q": {
				const isRel = cmd === "q";
				const qx = nextNum();
				const qy = nextNum();
				const x = nextNum();
				const y = nextNum();
				const cx1 = isRel ? currentX + qx : qx;
				const cy1 = isRel ? currentY + qy : qy;
				const ex = isRel ? currentX + x : x;
				const ey = isRel ? currentY + y : y;

				// Quadratic to cubic conversion
				const p1x = currentX + (2 / 3) * (cx1 - currentX);
				const p1y = currentY + (2 / 3) * (cy1 - currentY);
				const p2x = ex + (2 / 3) * (cx1 - ex);
				const p2y = ey + (2 / 3) * (cy1 - ey);

				segments.push({
					p0: { x: currentX, y: currentY },
					p1: { x: p1x, y: p1y },
					p2: { x: p2x, y: p2y },
					p3: { x: ex, y: ey },
				});
				lastControlX = cx1;
				lastControlY = cy1;
				currentX = ex;
				currentY = ey;
				lastCommand = cmd;
				break;
			}
			case "A":
			case "a": {
				const rx = nextNum();
				const ry = nextNum();
				const rotation = nextNum();
				const largeArc = nextNum() !== 0;
				const sweep = nextNum() !== 0;
				let x = nextNum();
				let y = nextNum();
				if (cmd === "a") {
					x += currentX;
					y += currentY;
				}
				segments.push(
					...svgArcToCubicBeziers(currentX, currentY, rx, ry, rotation, largeArc, sweep, x, y),
				);
				currentX = x;
				currentY = y;
				lastControlX = x;
				lastControlY = y;
				lastCommand = cmd;
				break;
			}
			case "Z":
			case "z": {
				if (currentX !== startX || currentY !== startY) {
					segments.push({
						p0: { x: currentX, y: currentY },
						p1: {
							x: currentX + (startX - currentX) / 3,
							y: currentY + (startY - currentY) / 3,
						},
						p2: {
							x: currentX + (2 * (startX - currentX)) / 3,
							y: currentY + (2 * (startY - currentY)) / 3,
						},
						p3: { x: startX, y: startY },
					});
					currentX = startX;
					currentY = startY;
				}
				lastCommand = cmd;
				break;
			}
			default:
				break;
		}
	}

	return segments;
}

/**
 * Universal path source converter to Cubic Bezier segments.
 */
export function generatePathSegments(
	source: TextPathSource,
): CubicBezierSegment[] {
	switch (source.type) {
		case "bezier":
			return source.segments;
		case "svg":
			return parseSvgPathToCubicBeziers(source.d);
		case "ellipse":
			return ellipseToCubicBeziers(
				source.cx,
				source.cy,
				source.rx,
				source.ry,
				source.startAngleDeg ?? 0,
				source.endAngleDeg ?? 360,
			);
		case "wave":
			return waveToCubicBeziers(
				source.startX,
				source.startY,
				source.length,
				source.amplitude,
				source.frequency,
				source.phaseDeg ?? 0,
			);
	}
}
