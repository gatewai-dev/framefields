/**
 * 2D path math: smooth curves through points, arc-length sampling, and SVG
 * path strings. Used for pointer travel, camera moves and drawn marks.
 */

export type Vec2 = [x: number, y: number];

export const dist = (a: Vec2, b: Vec2): number =>
	Math.hypot(b[0] - a[0], b[1] - a[1]);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
];

/**
 * Centripetal Catmull-Rom through `points`, flattened to a polyline with
 * `steps` samples per segment. Centripetal (alpha 0.5) never loops or cusps
 * between close points, which matters for pointer paths.
 */
export function catmullRom(points: readonly Vec2[], steps = 16): Vec2[] {
	if (points.length < 2) return points.map((p) => [p[0], p[1]] as Vec2);
	const out: Vec2[] = [[points[0]![0], points[0]![1]]];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(0, i - 1)]!;
		const p1 = points[i]!;
		const p2 = points[i + 1]!;
		const p3 = points[Math.min(points.length - 1, i + 2)]!;
		for (let s = 1; s <= steps; s++) {
			out.push(catmullRomPoint(p0, p1, p2, p3, s / steps));
		}
	}
	return out;
}

function catmullRomPoint(
	p0: Vec2,
	p1: Vec2,
	p2: Vec2,
	p3: Vec2,
	t: number,
): Vec2 {
	const knot = (a: Vec2, b: Vec2) => Math.max(1e-6, Math.sqrt(dist(a, b)));
	const t0 = 0;
	const t1 = t0 + knot(p0, p1);
	const t2 = t1 + knot(p1, p2);
	const t3 = t2 + knot(p2, p3);
	const u = t1 + (t2 - t1) * t;
	const mix = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 =>
		tb === ta ? a : lerp2(a, b, (u - ta) / (tb - ta));
	const a1 = mix(p0, p1, t0, t1);
	const a2 = mix(p1, p2, t1, t2);
	const a3 = mix(p2, p3, t2, t3);
	const b1 = mix(a1, a2, t0, t2);
	const b2 = mix(a2, a3, t1, t3);
	return mix(b1, b2, t1, t2);
}

/** A polyline with a cumulative arc-length table, sampled by distance. */
export interface ArcPath {
	readonly points: readonly Vec2[];
	readonly length: number;
	/** Point at `u` ∈ [0, 1] of the total length. */
	at(u: number): Vec2;
	/** Unit tangent direction (radians) at `u`. */
	angleAt(u: number): number;
}

export function arcPath(points: readonly Vec2[]): ArcPath {
	if (points.length === 0) throw new Error("arcPath: no points");
	const cumulative = [0];
	for (let i = 1; i < points.length; i++) {
		cumulative.push(cumulative[i - 1]! + dist(points[i - 1]!, points[i]!));
	}
	const length = cumulative[cumulative.length - 1]!;
	const segmentAt = (u: number): [number, number] => {
		if (points.length === 1 || length === 0) return [0, 0];
		const d = Math.min(1, Math.max(0, u)) * length;
		let lo = 0;
		let hi = cumulative.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (cumulative[mid]! <= d) lo = mid;
			else hi = mid;
		}
		const seg = cumulative[hi]! - cumulative[lo]!;
		return [lo, seg > 0 ? (d - cumulative[lo]!) / seg : 0];
	};
	return {
		points,
		length,
		at(u) {
			const [i, t] = segmentAt(u);
			if (points.length === 1) return [points[0]![0], points[0]![1]];
			return lerp2(points[i]!, points[Math.min(i + 1, points.length - 1)]!, t);
		},
		angleAt(u) {
			const [i] = segmentAt(u);
			const a = points[Math.min(i, points.length - 2)] ?? points[0]!;
			const b = points[Math.min(i + 1, points.length - 1)]!;
			return Math.atan2(b[1] - a[1], b[0] - a[0]);
		},
	};
}

/** SVG path data for a polyline (optionally closed). Rounded to 0.01 px. */
export function toPathData(points: readonly Vec2[], closed = false): string {
	if (points.length === 0) return "";
	const r = (n: number) => Math.round(n * 100) / 100;
	const [first, ...rest] = points;
	const parts = [`M${r(first![0])} ${r(first![1])}`];
	for (const p of rest) parts.push(`L${r(p[0])} ${r(p[1])}`);
	if (closed) parts.push("Z");
	return parts.join(" ");
}

/**
 * Scale and offset absolute SVG path data (M, L, H, V, C, S, Q, T, Z):
 * `x' = x × scale + dx`. Used to size glyphs designed on a small grid.
 */
export function transformPathData(
	d: string,
	scale: number,
	dx = 0,
	dy = 0,
): string {
	const r = (n: number) => Math.round(n * 1000) / 1000;
	const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
	const out: string[] = [];
	let command = "";
	let axis = 0;
	for (const token of tokens) {
		if (/[a-zA-Z]/.test(token)) {
			if (token !== token.toUpperCase() && token.toLowerCase() !== "z") {
				throw new Error(
					`transformPathData: relative command "${token}" is not supported`,
				);
			}
			if (token.toUpperCase() === "A") {
				throw new Error("transformPathData: arcs are not supported");
			}
			command = token.toUpperCase();
			axis = 0;
			out.push(command);
			continue;
		}
		const n = Number(token);
		if (command === "H") out.push(String(r(n * scale + dx)));
		else if (command === "V") out.push(String(r(n * scale + dy)));
		else {
			out.push(String(r(n * scale + (axis % 2 === 0 ? dx : dy))));
			axis++;
		}
	}
	return out.join(" ").replace(/ ?([A-Z]) ?/g, "$1");
}
