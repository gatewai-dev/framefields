export interface Point {
	x: number;
	y: number;
}

export interface PathSegment {
	p0: Point;
	p1: Point;
}

/**
 * Sample a cubic bezier curve into linear segments.
 */
export function sampleCubicBezier(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	steps = 24,
): PathSegment[] {
	const segments: PathSegment[] = [];
	let prev = p0;

	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const mt = 1 - t;
		const mt2 = mt * mt;
		const mt3 = mt2 * mt;
		const t2 = t * t;
		const t3 = t2 * t;

		const curr: Point = {
			x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
			y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
		};

		segments.push({ p0: prev, p1: curr });
		prev = curr;
	}

	return segments;
}

/**
 * Sample a quadratic bezier curve into linear segments.
 */
export function sampleQuadraticBezier(
	p0: Point,
	p1: Point,
	p2: Point,
	steps = 16,
): PathSegment[] {
	const segments: PathSegment[] = [];
	let prev = p0;

	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const mt = 1 - t;
		const mt2 = mt * mt;
		const t2 = t * t;

		const curr: Point = {
			x: mt2 * p0.x + 2 * mt * t * p1.x + t2 * p2.x,
			y: mt2 * p0.y + 2 * mt * t * p1.y + t2 * p2.y,
		};

		segments.push({ p0: prev, p1: curr });
		prev = curr;
	}

	return segments;
}

/**
 * Sample an SVG elliptical arc (endpoint parameterization) into line segments.
 * Converts to centre parameterization per SVG 1.1 F.6.5, scaling the radii up
 * when they are too small to span the endpoints (F.6.6).
 */
export function sampleSvgArc(
	p0: Point,
	rxIn: number,
	ryIn: number,
	rotationDeg: number,
	largeArc: boolean,
	sweep: boolean,
	p1: Point,
): PathSegment[] {
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	if (rx < 1e-9 || ry < 1e-9) return [{ p0, p1 }];
	if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-9) return [];

	const phi = (rotationDeg * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (p0.x - p1.x) / 2;
	const dy = (p0.y - p1.y) / 2;
	const x1 = cos * dx + sin * dy;
	const y1 = -sin * dx + cos * dy;

	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}

	const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const coef =
		(largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
	const cxp = (coef * rx * y1) / ry;
	const cyp = (-coef * ry * x1) / rx;
	const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
	const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;

	const angle = (ux: number, uy: number, vx: number, vy: number) =>
		Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
	let delta = angle(
		(x1 - cxp) / rx,
		(y1 - cyp) / ry,
		(-x1 - cxp) / rx,
		(-y1 - cyp) / ry,
	);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;

	// ~64 segments per full turn keeps large circles smooth.
	const steps = Math.max(4, Math.ceil((Math.abs(delta) / (2 * Math.PI)) * 64));
	const segments: PathSegment[] = [];
	let prev = p0;
	for (let i = 1; i <= steps; i++) {
		const t = theta1 + (delta * i) / steps;
		const ex = rx * Math.cos(t);
		const ey = ry * Math.sin(t);
		const curr: Point =
			i === steps
				? p1
				: { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy };
		segments.push({ p0: prev, p1: curr });
		prev = curr;
	}
	return segments;
}

/**
 * Parse an SVG path string (M, L, H, V, C, S, Q, T, A, Z) into line segments.
 */
export function parseSvgPathToSegments(d: string): PathSegment[] {
	const segments: PathSegment[] = [];
	if (!d || typeof d !== "string") return segments;

	// Tokenize SVG path commands and numeric values
	const tokens: Array<string | number> = [];
	const regex = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(d)) !== null) {
		if (match[1]) {
			tokens.push(match[1]);
		} else if (match[2]) {
			tokens.push(parseFloat(match[2]));
		}
	}

	let cursor = 0;
	let current: Point = { x: 0, y: 0 };
	let subpathStart: Point = { x: 0, y: 0 };
	let lastCubicControl: Point | null = null;
	let lastQuadControl: Point | null = null;

	while (cursor < tokens.length) {
		const cmdToken = tokens[cursor++];
		if (typeof cmdToken !== "string") continue;

		const cmd = cmdToken;
		const isRelative = cmd === cmd.toLowerCase();
		const upper = cmd.toUpperCase();

		const getNum = (): number => {
			if (cursor < tokens.length && typeof tokens[cursor] === "number") {
				return tokens[cursor++] as number;
			}
			return 0;
		};

		switch (upper) {
			case "M": {
				let first = true;
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x += current.x;
						y += current.y;
					}
					if (first) {
						current = { x, y };
						subpathStart = { x, y };
						first = false;
					} else {
						// Subsequent pairs in M/m are treated as L/l
						segments.push({ p0: current, p1: { x, y } });
						current = { x, y };
					}
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "L": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x += current.x;
						y += current.y;
					}
					segments.push({ p0: current, p1: { x, y } });
					current = { x, y };
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "H": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					if (isRelative) x += current.x;
					const next: Point = { x, y: current.y };
					segments.push({ p0: current, p1: next });
					current = next;
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "V": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let y = getNum();
					if (isRelative) y += current.y;
					const next: Point = { x: current.x, y };
					segments.push({ p0: current, p1: next });
					current = next;
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "C": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x1 = getNum();
					let y1 = getNum();
					let x2 = getNum();
					let y2 = getNum();
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x1 += current.x;
						y1 += current.y;
						x2 += current.x;
						y2 += current.y;
						x += current.x;
						y += current.y;
					}
					const p1: Point = { x: x1, y: y1 };
					const p2: Point = { x: x2, y: y2 };
					const end: Point = { x, y };
					segments.push(...sampleCubicBezier(current, p1, p2, end));
					current = end;
					lastCubicControl = p2;
				}
				lastQuadControl = null;
				break;
			}
			case "S": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x2 = getNum();
					let y2 = getNum();
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x2 += current.x;
						y2 += current.y;
						x += current.x;
						y += current.y;
					}
					let p1: Point;
					if (lastCubicControl) {
						p1 = {
							x: 2 * current.x - lastCubicControl.x,
							y: 2 * current.y - lastCubicControl.y,
						};
					} else {
						p1 = { x: current.x, y: current.y };
					}
					const p2: Point = { x: x2, y: y2 };
					const end: Point = { x, y };
					segments.push(...sampleCubicBezier(current, p1, p2, end));
					current = end;
					lastCubicControl = p2;
				}
				lastQuadControl = null;
				break;
			}
			case "Q": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x1 = getNum();
					let y1 = getNum();
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x1 += current.x;
						y1 += current.y;
						x += current.x;
						y += current.y;
					}
					const p1: Point = { x: x1, y: y1 };
					const end: Point = { x, y };
					segments.push(...sampleQuadraticBezier(current, p1, end));
					current = end;
					lastQuadControl = p1;
				}
				lastCubicControl = null;
				break;
			}
			case "T": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x += current.x;
						y += current.y;
					}
					let p1: Point;
					if (lastQuadControl) {
						p1 = {
							x: 2 * current.x - lastQuadControl.x,
							y: 2 * current.y - lastQuadControl.y,
						};
					} else {
						p1 = { x: current.x, y: current.y };
					}
					const end: Point = { x, y };
					segments.push(...sampleQuadraticBezier(current, p1, end));
					current = end;
					lastQuadControl = p1;
				}
				lastCubicControl = null;
				break;
			}
			case "A": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					const rx = getNum();
					const ry = getNum();
					const rotation = getNum();
					const largeArc = getNum() !== 0;
					const sweep = getNum() !== 0;
					let x = getNum();
					let y = getNum();
					if (isRelative) {
						x += current.x;
						y += current.y;
					}
					const end: Point = { x, y };
					segments.push(
						...sampleSvgArc(current, rx, ry, rotation, largeArc, sweep, end),
					);
					current = end;
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "Z": {
				if (
					Math.hypot(current.x - subpathStart.x, current.y - subpathStart.y) >
					1e-5
				) {
					segments.push({ p0: current, p1: subpathStart });
				}
				current = subpathStart;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			default:
				break;
		}
	}

	return segments;
}

/**
 * Trim linear path segments using arc-length parameterization.
 * Supports [trimStart, trimEnd] normalized in [0, 1] with trimOffset (in degrees 0..360 or normalized 0..1).
 */
export function trimPathSegments(
	segments: PathSegment[],
	trimStart: number,
	trimEnd: number,
	trimOffset = 0,
): PathSegment[] {
	if (segments.length === 0) return [];

	// Compute cumulative lengths
	const lengths: number[] = [];
	let totalLength = 0;

	for (const seg of segments) {
		const len = Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y);
		lengths.push(len);
		totalLength += len;
	}

	if (totalLength < 1e-6) return [];

	// Normalize offset: if >= 1 or <= -1, assume degrees (e.g. 360), else fraction
	const normalizedOffset =
		Math.abs(trimOffset) > 1 ? (trimOffset % 360) / 360 : trimOffset;

	let s = (trimStart + normalizedOffset) % 1;
	let e = (trimEnd + normalizedOffset) % 1;
	if (s < 0) s += 1;
	if (e < 0) e += 1;

	// Helper to extract range [startDist, endDist]
	const extractRange = (startDist: number, endDist: number): PathSegment[] => {
		if (startDist >= endDist) return [];
		const result: PathSegment[] = [];
		let accumulated = 0;

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const segLen = lengths[i];
			const segStart = accumulated;
			const segEnd = accumulated + segLen;
			accumulated = segEnd;

			if (segEnd <= startDist || segStart >= endDist || segLen < 1e-6) {
				continue;
			}

			const t0 = Math.max(0, (startDist - segStart) / segLen);
			const t1 = Math.min(1, (endDist - segStart) / segLen);

			if (t1 > t0) {
				const p0: Point = {
					x: seg.p0.x + (seg.p1.x - seg.p0.x) * t0,
					y: seg.p0.y + (seg.p1.y - seg.p0.y) * t0,
				};
				const p1: Point = {
					x: seg.p0.x + (seg.p1.x - seg.p0.x) * t1,
					y: seg.p0.y + (seg.p1.y - seg.p0.y) * t1,
				};
				result.push({ p0, p1 });
			}
		}

		return result;
	};

	if (trimStart === 0 && trimEnd === 1 && trimOffset === 0) {
		return [...segments];
	}

	if (Math.abs(s - e) < 1e-5) {
		// Nothing visible if start == end
		return [];
	}

	if (s <= e) {
		return extractRange(s * totalLength, e * totalLength);
	} else {
		// Wrapped range across endpoint: [s, 1] + [0, e]
		const part1 = extractRange(s * totalLength, totalLength);
		const part2 = extractRange(0, e * totalLength);
		return [...part1, ...part2];
	}
}

/**
 * Apply dash patterns along linear path segments.
 */
export function dashPathSegments(
	segments: PathSegment[],
	dashArray: number[],
	dashOffset = 0,
): PathSegment[] {
	if (segments.length === 0 || dashArray.length === 0) return segments;

	let patternLength = 0;
	for (const d of dashArray) patternLength += d;
	if (patternLength < 1e-5) return segments;

	let totalLength = 0;
	const lengths: number[] = [];
	for (const seg of segments) {
		const len = Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y);
		lengths.push(len);
		totalLength += len;
	}

	const result: PathSegment[] = [];
	const currentDist =
		((dashOffset % patternLength) + patternLength) % patternLength;
	let dashIdx = 0;
	let isDraw = true;

	// Find starting dash phase
	let distInPattern = currentDist;
	while (distInPattern > dashArray[dashIdx]) {
		distInPattern -= dashArray[dashIdx];
		dashIdx = (dashIdx + 1) % dashArray.length;
		isDraw = !isDraw;
	}

	let remainingInDash = dashArray[dashIdx] - distInPattern;
	let distOnPath = 0;

	while (distOnPath < totalLength) {
		const runLen = Math.min(remainingInDash, totalLength - distOnPath);

		if (isDraw && runLen > 1e-4) {
			// Extract sub-segment from distOnPath to distOnPath + runLen
			const sub = trimPathSegments(
				segments,
				distOnPath / totalLength,
				(distOnPath + runLen) / totalLength,
			);
			result.push(...sub);
		}

		distOnPath += runLen;
		dashIdx = (dashIdx + 1) % dashArray.length;
		isDraw = !isDraw;
		remainingInDash = dashArray[dashIdx];
	}

	return result;
}

// ── Parametric Shape SVG Path Builders ────────────────────────────────

export function buildRectPath(
	w: number,
	h: number,
	rTL = 0,
	rTR = 0,
	rBR = 0,
	rBL = 0,
): string {
	const maxR = Math.min(w / 2, h / 2);
	const tl = Math.min(rTL, maxR);
	const tr = Math.min(rTR, maxR);
	const br = Math.min(rBR, maxR);
	const bl = Math.min(rBL, maxR);

	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
	}

	return [
		`M ${tl} 0`,
		`L ${w - tr} 0`,
		tr > 0 ? `Q ${w} 0 ${w} ${tr}` : `L ${w} 0`,
		`L ${w} ${h - br}`,
		br > 0 ? `Q ${w} ${h} ${w - br} ${h}` : `L ${w} ${h}`,
		`L ${bl} ${h}`,
		bl > 0 ? `Q 0 ${h} 0 ${h - bl}` : `L 0 ${h}`,
		`L 0 ${tl}`,
		tl > 0 ? `Q 0 0 ${tl} 0` : `L 0 0`,
		"Z",
	].join(" ");
}

export function buildCirclePath(w: number, h: number): string {
	const r = Math.min(w, h) / 2;
	const cx = w / 2;
	const cy = h / 2;
	// Cubic bezier approximation of a circle (k = 0.5522847498)
	const k = r * 0.5522847498;
	return [
		`M ${cx} ${cy - r}`,
		`C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
		`C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
		`C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}`,
		`C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
		"Z",
	].join(" ");
}

export function buildEllipsePath(w: number, h: number): string {
	const rx = w / 2;
	const ry = h / 2;
	const cx = rx;
	const cy = ry;
	const kx = rx * 0.5522847498;
	const ky = ry * 0.5522847498;
	return [
		`M ${cx} ${cy - ry}`,
		`C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
		`C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
		`C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
		`C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
		"Z",
	].join(" ");
}

export function buildPolygonPath(w: number, h: number, sides = 5): string {
	const n = Math.max(3, sides);
	const r = Math.min(w, h) / 2;
	const cx = w / 2;
	const cy = h / 2;
	const points: Point[] = [];

	for (let i = 0; i < n; i++) {
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
		points.push({
			x: cx + r * Math.cos(angle),
			y: cy + r * Math.sin(angle),
		});
	}

	return (
		points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") +
		" Z"
	);
}

export function buildStarPath(
	w: number,
	h: number,
	points = 5,
	innerRatio = 0.5,
): string {
	const n = Math.max(3, points);
	const rOuter = Math.min(w, h) / 2;
	const rInner = rOuter * Math.max(0.01, Math.min(0.99, innerRatio));
	const cx = w / 2;
	const cy = h / 2;
	const coords: Point[] = [];

	for (let i = 0; i < n * 2; i++) {
		const angle = -Math.PI / 2 + (i * Math.PI) / n;
		const r = i % 2 === 0 ? rOuter : rInner;
		coords.push({
			x: cx + r * Math.cos(angle),
			y: cy + r * Math.sin(angle),
		});
	}

	return (
		coords.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") +
		" Z"
	);
}

export function buildArrowPath(
	w: number,
	h: number,
	headWidth = 40,
	headLength = 40,
	shaftWidth = 20,
): string {
	const hw = Math.min(headWidth, h);
	const hl = Math.min(headLength, w);
	const sw = Math.min(shaftWidth, hw);
	const cy = h / 2;

	return [
		`M 0 ${cy - sw / 2}`,
		`L ${w - hl} ${cy - sw / 2}`,
		`L ${w - hl} ${cy - hw / 2}`,
		`L ${w} ${cy}`,
		`L ${w - hl} ${cy + hw / 2}`,
		`L ${w - hl} ${cy + sw / 2}`,
		`L 0 ${cy + sw / 2}`,
		"Z",
	].join(" ");
}

export type ShapeType =
	| "rect"
	| "circle"
	| "ellipse"
	| "polygon"
	| "star"
	| "arrow"
	| "path";

export interface ShapeGeometryConfig {
	shapeType: ShapeType;
	width: number;
	height: number;
	path?: string;
	cornerRadius?: number;
	starPoints?: number;
	starInnerRadiusRatio?: number;
	polygonSides?: number;
	arrowHeadWidth?: number;
	arrowHeadLength?: number;
	arrowShaftWidth?: number;
}

export function buildShapeSvgPath(config: ShapeGeometryConfig): string {
	const { shapeType, width, height } = config;
	switch (shapeType) {
		case "rect":
			return buildRectPath(
				width,
				height,
				config.cornerRadius ?? 0,
				config.cornerRadius ?? 0,
				config.cornerRadius ?? 0,
				config.cornerRadius ?? 0,
			);
		case "circle":
			return buildCirclePath(width, height);
		case "ellipse":
			return buildEllipsePath(width, height);
		case "polygon":
			return buildPolygonPath(width, height, config.polygonSides ?? 5);
		case "star":
			return buildStarPath(
				width,
				height,
				config.starPoints ?? 5,
				config.starInnerRadiusRatio ?? 0.5,
			);
		case "arrow":
			return buildArrowPath(
				width,
				height,
				config.arrowHeadWidth ?? 40,
				config.arrowHeadLength ?? 40,
				config.arrowShaftWidth ?? 20,
			);
		case "path":
			return config.path ?? "";
		default:
			return "";
	}
}

/**
 * Triangulate a simple 2D polygon contour into an array of triangle vertices using ear clipping.
 */
export function triangulatePolygon(contour: Point[]): Point[] {
	if (contour.length < 3) return [];
	if (contour.length === 3) return [contour[0], contour[1], contour[2]];

	// Remove duplicate closing point if present
	const points = [...contour];
	const last = points[points.length - 1];
	const first = points[0];
	if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-5) {
		points.pop();
	}
	if (points.length < 3) return [];

	// Compute signed area to verify CCW winding
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const j = (i + 1) % points.length;
		area += points[i].x * points[j].y - points[j].x * points[i].y;
	}
	if (area < 0) {
		points.reverse();
	}

	const isPointInTriangle = (
		p: Point,
		a: Point,
		b: Point,
		c: Point,
	): boolean => {
		const crossA = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
		const crossB = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
		const crossC = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
		return crossA >= -1e-6 && crossB >= -1e-6 && crossC >= -1e-6;
	};

	const isEar = (
		prev: Point,
		curr: Point,
		next: Point,
		rem: Point[],
	): boolean => {
		const cross =
			(curr.x - prev.x) * (next.y - prev.y) -
			(curr.y - prev.y) * (next.x - prev.x);
		if (cross <= 1e-7) return false;

		for (const p of rem) {
			if (p === prev || p === curr || p === next) continue;
			if (isPointInTriangle(p, prev, curr, next)) return false;
		}
		return true;
	};

	const triangles: Point[] = [];
	const rem = [...points];
	let attempts = 0;
	const maxAttempts = rem.length * rem.length * 2;

	while (rem.length > 3 && attempts < maxAttempts) {
		attempts++;
		let earFound = false;
		for (let i = 0; i < rem.length; i++) {
			const prev = rem[(i - 1 + rem.length) % rem.length];
			const curr = rem[i];
			const next = rem[(i + 1) % rem.length];

			if (isEar(prev, curr, next, rem)) {
				triangles.push(prev, curr, next);
				rem.splice(i, 1);
				earFound = true;
				break;
			}
		}
		if (!earFound) {
			triangles.push(rem[0], rem[1], rem[2]);
			rem.splice(1, 1);
		}
	}

	if (rem.length === 3) {
		triangles.push(rem[0], rem[1], rem[2]);
	}

	return triangles;
}

/**
 * Triangulate a shape geometry into a flat Float32Array of 2D vertex pairs [x, y, x, y, ...].
 */
export function triangulateShape(config: ShapeGeometryConfig): Float32Array {
	const { shapeType, width: w, height: h } = config;

	if (shapeType === "rect") {
		const cr = config.cornerRadius ?? 0;
		if (cr <= 0) {
			// 2 triangles: (0,0)-(w,0)-(w,h) and (0,0)-(w,h)-(0,h)
			return new Float32Array([0, 0, w, 0, w, h, 0, 0, w, h, 0, h]);
		}
		// Rounded rect: sample path and ear-clip
		const svg = buildRectPath(w, h, cr, cr, cr, cr);
		const segments = parseSvgPathToSegments(svg);
		const contour = segments.map((s) => s.p0);
		const tris = triangulatePolygon(contour);
		const out = new Float32Array(tris.length * 2);
		for (let i = 0; i < tris.length; i++) {
			out[i * 2] = tris[i].x;
			out[i * 2 + 1] = tris[i].y;
		}
		return out;
	}

	if (shapeType === "circle" || shapeType === "ellipse") {
		const cx = w / 2;
		const cy = h / 2;
		const rx = shapeType === "circle" ? Math.min(w, h) / 2 : w / 2;
		const ry = shapeType === "circle" ? rx : h / 2;
		const steps = 48;
		const out = new Float32Array(steps * 3 * 2);
		let ptr = 0;

		for (let i = 0; i < steps; i++) {
			const a0 = (i * 2 * Math.PI) / steps;
			const a1 = ((i + 1) * 2 * Math.PI) / steps;
			// Center
			out[ptr++] = cx;
			out[ptr++] = cy;
			// P0
			out[ptr++] = cx + rx * Math.cos(a0);
			out[ptr++] = cy + ry * Math.sin(a0);
			// P1
			out[ptr++] = cx + rx * Math.cos(a1);
			out[ptr++] = cy + ry * Math.sin(a1);
		}
		return out;
	}

	if (shapeType === "polygon") {
		const n = Math.max(3, config.polygonSides ?? 5);
		const r = Math.min(w, h) / 2;
		const cx = w / 2;
		const cy = h / 2;
		const out = new Float32Array(n * 3 * 2);
		let ptr = 0;

		for (let i = 0; i < n; i++) {
			const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n;
			const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / n;
			out[ptr++] = cx;
			out[ptr++] = cy;
			out[ptr++] = cx + r * Math.cos(a0);
			out[ptr++] = cy + r * Math.sin(a0);
			out[ptr++] = cx + r * Math.cos(a1);
			out[ptr++] = cy + r * Math.sin(a1);
		}
		return out;
	}

	if (shapeType === "star") {
		const n = Math.max(3, config.starPoints ?? 5);
		const rOuter = Math.min(w, h) / 2;
		const rInner =
			rOuter *
			Math.max(0.01, Math.min(0.99, config.starInnerRadiusRatio ?? 0.5));
		const cx = w / 2;
		const cy = h / 2;
		const totalVerts = n * 2;
		const out = new Float32Array(totalVerts * 3 * 2);
		let ptr = 0;

		for (let i = 0; i < totalVerts; i++) {
			const a0 = -Math.PI / 2 + (i * Math.PI) / n;
			const a1 = -Math.PI / 2 + ((i + 1) * Math.PI) / n;
			const r0 = i % 2 === 0 ? rOuter : rInner;
			const r1 = (i + 1) % 2 === 0 ? rOuter : rInner;

			out[ptr++] = cx;
			out[ptr++] = cy;
			out[ptr++] = cx + r0 * Math.cos(a0);
			out[ptr++] = cy + r0 * Math.sin(a0);
			out[ptr++] = cx + r1 * Math.cos(a1);
			out[ptr++] = cy + r1 * Math.sin(a1);
		}
		return out;
	}

	if (shapeType === "arrow") {
		const hw = Math.min(config.arrowHeadWidth ?? 40, h);
		const hl = Math.min(config.arrowHeadLength ?? 40, w);
		const sw = Math.min(config.arrowShaftWidth ?? 20, hw);
		const cy = h / 2;

		const x0 = 0;
		const x1 = w - hl;
		const x2 = w;
		const yTopShaft = cy - sw / 2;
		const yBotShaft = cy + sw / 2;
		const yTopHead = cy - hw / 2;
		const yBotHead = cy + hw / 2;

		return new Float32Array([
			// Shaft quad (2 triangles)
			x0,
			yTopShaft,
			x1,
			yTopShaft,
			x1,
			yBotShaft,
			x0,
			yTopShaft,
			x1,
			yBotShaft,
			x0,
			yBotShaft,
			// Head triangle (1 triangle)
			x1,
			yTopHead,
			x2,
			cy,
			x1,
			yBotHead,
		]);
	}

	if (shapeType === "path" && config.path) {
		const segments = parseSvgPathToSegments(config.path);
		if (segments.length === 0) return new Float32Array(0);
		const contour = segments.map((s) => s.p0);
		const tris = triangulatePolygon(contour);
		const out = new Float32Array(tris.length * 2);
		for (let i = 0; i < tris.length; i++) {
			out[i * 2] = tris[i].x;
			out[i * 2 + 1] = tris[i].y;
		}
		return out;
	}

	return new Float32Array(0);
}
