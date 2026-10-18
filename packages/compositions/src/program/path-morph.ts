/**
 * Shape morphing: interpolates between two SVG path strings.
 *
 * Both paths are flattened to polylines, resampled to the same number of
 * points by arc length, and the second is rotated (and reversed if it winds
 * the other way) so its points line up with the first's. Subpaths pair up in
 * order; a subpath with no partner grows from (or shrinks to) the center of
 * the one it pairs with. The result is a polygon path string.
 */

type Pt = [number, number];
interface Sub {
	pts: Pt[];
	closed: boolean;
}

const SAMPLES = 128;
const CURVE_STEPS = 16;

const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;

/** Flattens an SVG path into polylines, one per subpath. */
export function flattenPath(d: string): Sub[] {
	const subs: Sub[] = [];
	let cur: Pt[] = [];
	let x = 0;
	let y = 0;
	let sx = 0;
	let sy = 0;
	// Last control point, for S/T reflection.
	let cx = 0;
	let cy = 0;
	let prev = "";
	const end = (closed: boolean) => {
		if (cur.length > 1) subs.push({ pts: cur, closed });
		cur = [];
	};
	for (const m of d.matchAll(CMD_RE)) {
		const cmd = m[1];
		const nums = (m[2].match(NUM_RE) ?? []).map(Number);
		const rel = cmd === cmd.toLowerCase();
		const C = cmd.toUpperCase();
		let i = 0;
		const take = (n: number) => {
			const v = nums.slice(i, i + n);
			i += n;
			return v;
		};
		const has = (n: number) => i + n <= nums.length;
		if (C === "Z") {
			x = sx;
			y = sy;
			end(true);
			cur = [[x, y]];
			prev = C;
			continue;
		}
		let first = true;
		while (
			has(
				C === "H" || C === "V"
					? 1
					: C === "A"
						? 7
						: C === "C"
							? 6
							: C === "S" || C === "Q"
								? 4
								: 2,
			)
		) {
			if (C === "M") {
				const [a, b] = take(2);
				x = rel ? x + a : a;
				y = rel ? y + b : b;
				if (first) {
					end(false);
					sx = x;
					sy = y;
					cur = [[x, y]];
				} else cur.push([x, y]);
			} else if (C === "L" || C === "T") {
				const [a, b] = take(2);
				const nx = rel ? x + a : a;
				const ny = rel ? y + b : b;
				if (C === "T") {
					const qx = prev === "Q" || prev === "T" ? 2 * x - cx : x;
					const qy = prev === "Q" || prev === "T" ? 2 * y - cy : y;
					quad(cur, x, y, qx, qy, nx, ny);
					cx = qx;
					cy = qy;
				} else cur.push([nx, ny]);
				x = nx;
				y = ny;
			} else if (C === "H") {
				const [a] = take(1);
				x = rel ? x + a : a;
				cur.push([x, y]);
			} else if (C === "V") {
				const [a] = take(1);
				y = rel ? y + a : a;
				cur.push([x, y]);
			} else if (C === "C" || C === "S") {
				let x1: number;
				let y1: number;
				if (C === "C") {
					const [a, b] = take(2);
					x1 = rel ? x + a : a;
					y1 = rel ? y + b : b;
				} else {
					x1 = prev === "C" || prev === "S" ? 2 * x - cx : x;
					y1 = prev === "C" || prev === "S" ? 2 * y - cy : y;
				}
				const [c, e, f, g] = take(4);
				const x2 = rel ? x + c : c;
				const y2 = rel ? y + e : e;
				const nx = rel ? x + f : f;
				const ny = rel ? y + g : g;
				for (let k = 1; k <= CURVE_STEPS; k++) {
					const t = k / CURVE_STEPS;
					const u = 1 - t;
					cur.push([
						u * u * u * x +
							3 * u * u * t * x1 +
							3 * u * t * t * x2 +
							t * t * t * nx,
						u * u * u * y +
							3 * u * u * t * y1 +
							3 * u * t * t * y2 +
							t * t * t * ny,
					]);
				}
				cx = x2;
				cy = y2;
				x = nx;
				y = ny;
			} else if (C === "Q") {
				const [a, b, c, e] = take(4);
				const qx = rel ? x + a : a;
				const qy = rel ? y + b : b;
				const nx = rel ? x + c : c;
				const ny = rel ? y + e : e;
				quad(cur, x, y, qx, qy, nx, ny);
				cx = qx;
				cy = qy;
				x = nx;
				y = ny;
			} else if (C === "A") {
				const [rx, ry, rot, large, sweep, a, b] = take(7);
				const nx = rel ? x + a : a;
				const ny = rel ? y + b : b;
				arc(cur, x, y, rx, ry, rot, large !== 0, sweep !== 0, nx, ny);
				x = nx;
				y = ny;
			}
			first = false;
			prev = C;
			if (C === "M") prev = "L";
		}
		prev = C;
	}
	end(false);
	return subs;
}

function quad(
	out: Pt[],
	x0: number,
	y0: number,
	qx: number,
	qy: number,
	x1: number,
	y1: number,
) {
	for (let k = 1; k <= CURVE_STEPS; k++) {
		const t = k / CURVE_STEPS;
		const u = 1 - t;
		out.push([
			u * u * x0 + 2 * u * t * qx + t * t * x1,
			u * u * y0 + 2 * u * t * qy + t * t * y1,
		]);
	}
}

/** SVG endpoint arc → points (spec F.6.5). */
function arc(
	out: Pt[],
	x1: number,
	y1: number,
	rxIn: number,
	ryIn: number,
	rotDeg: number,
	large: boolean,
	sweep: boolean,
	x2: number,
	y2: number,
) {
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	if (rx === 0 || ry === 0) {
		out.push([x2, y2]);
		return;
	}
	const phi = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const xp = cos * dx + sin * dy;
	const yp = -sin * dx + cos * dy;
	const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
	if (lam > 1) {
		rx *= Math.sqrt(lam);
		ry *= Math.sqrt(lam);
	}
	const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
	const den = rx * rx * yp * yp + ry * ry * xp * xp;
	let co = Math.sqrt(Math.max(0, num / den));
	if (large === sweep) co = -co;
	const cxp = (co * rx * yp) / ry;
	const cyp = (-co * ry * xp) / rx;
	const ccx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const ccy = sin * cxp + cos * cyp + (y1 + y2) / 2;
	const ang = (ux: number, uy: number, vx: number, vy: number) =>
		Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
	let dt = ang(
		(xp - cxp) / rx,
		(yp - cyp) / ry,
		(-xp - cxp) / rx,
		(-yp - cyp) / ry,
	);
	if (!sweep && dt > 0) dt -= 2 * Math.PI;
	if (sweep && dt < 0) dt += 2 * Math.PI;
	const steps = Math.max(
		4,
		Math.ceil((Math.abs(dt) / (Math.PI / 2)) * CURVE_STEPS),
	);
	for (let k = 1; k <= steps; k++) {
		const t = t1 + (dt * k) / steps;
		const ex = rx * Math.cos(t);
		const ey = ry * Math.sin(t);
		out.push([cos * ex - sin * ey + ccx, sin * ex + cos * ey + ccy]);
	}
}

/** `n` points evenly spaced along a polyline (closed: around the loop). */
function resample(sub: Sub, n: number): Pt[] {
	const pts = sub.closed ? [...sub.pts, sub.pts[0]] : sub.pts;
	const cum = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(
			cum[i - 1] +
				Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
		);
	}
	const total = cum[cum.length - 1];
	const out: Pt[] = [];
	if (total <= 0) {
		for (let i = 0; i < n; i++) out.push([pts[0][0], pts[0][1]]);
		return out;
	}
	const count = sub.closed ? n : n - 1;
	let j = 0;
	for (let i = 0; i < n; i++) {
		const s = (total * i) / count;
		while (j < cum.length - 2 && cum[j + 1] < s) j++;
		const seg = cum[j + 1] - cum[j];
		const t = seg > 0 ? (s - cum[j]) / seg : 0;
		out.push([
			pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
			pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t,
		]);
	}
	return out;
}

function area(p: Pt[]): number {
	let a = 0;
	for (let i = 0; i < p.length; i++) {
		const q = p[(i + 1) % p.length];
		a += p[i][0] * q[1] - q[0] * p[i][1];
	}
	return a / 2;
}

function centroid(p: Pt[]): Pt {
	let x = 0;
	let y = 0;
	for (const q of p) {
		x += q[0];
		y += q[1];
	}
	return [x / p.length, y / p.length];
}

/** Rotates (and maybe reverses) `b` so its points line up with `a`'s. */
function align(a: Pt[], b: Pt[], closed: boolean): Pt[] {
	if (!closed) {
		const d0 = Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1]);
		const d1 = Math.hypot(
			a[0][0] - b[b.length - 1][0],
			a[0][1] - b[b.length - 1][1],
		);
		return d1 < d0 ? [...b].reverse() : b;
	}
	const bb = Math.sign(area(a)) !== Math.sign(area(b)) ? [...b].reverse() : b;
	const n = a.length;
	let best = 0;
	let bestD = Number.POSITIVE_INFINITY;
	// Coarse search on every 4th offset, then refine around the best.
	const score = (k: number) => {
		let s = 0;
		for (let i = 0; i < n; i += 2) {
			const q = bb[(i + k) % n];
			s += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2;
		}
		return s;
	};
	for (let k = 0; k < n; k += 4) {
		const s = score(k);
		if (s < bestD) {
			bestD = s;
			best = k;
		}
	}
	for (let k = best - 3; k <= best + 3; k++) {
		const kk = (k + n) % n;
		const s = score(kk);
		if (s < bestD) {
			bestD = s;
			best = kk;
		}
	}
	return a.map((_, i) => bb[(i + best) % n]);
}

interface Prepared {
	a: Pt[][];
	b: Pt[][];
	closed: boolean[];
}

const memo = new Map<string, Prepared>();

function prepare(from: string, to: string): Prepared {
	const key = `${from}\u0000${to}`;
	const hit = memo.get(key);
	if (hit) return hit;
	const sa = flattenPath(from);
	const sb = flattenPath(to);
	const n = Math.max(sa.length, sb.length);
	const out: Prepared = { a: [], b: [], closed: [] };
	for (let i = 0; i < n; i++) {
		const A = sa[i];
		const B = sb[i];
		const closed = (A?.closed ?? true) && (B?.closed ?? true);
		let pa = A ? resample(A, SAMPLES) : undefined;
		let pb = B ? resample(B, SAMPLES) : undefined;
		if (!pa && pb) {
			const c = centroid(pb);
			pa = pb.map(() => [c[0], c[1]] as Pt);
		}
		if (!pb && pa) {
			const c = centroid(pa);
			pb = pa.map(() => [c[0], c[1]] as Pt);
		}
		if (!pa || !pb) continue;
		out.a.push(pa);
		out.b.push(align(pa, pb, closed));
		out.closed.push(closed);
	}
	if (memo.size > 256) memo.clear();
	memo.set(key, out);
	return out;
}

const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

/**
 * The path `t` of the way from `from` to `to` (0 = `from`, 1 = `to`; `t`
 * may overshoot for back / elastic eases).
 */
export function morphPath(from: string, to: string, t: number): string {
	if (t <= 0) return from;
	if (t === 1) return to;
	const p = prepare(from, to);
	const parts: string[] = [];
	for (let s = 0; s < p.a.length; s++) {
		const A = p.a[s];
		const B = p.b[s];
		let d = "";
		for (let i = 0; i < A.length; i++) {
			const x = A[i][0] + (B[i][0] - A[i][0]) * t;
			const y = A[i][1] + (B[i][1] - A[i][1]) * t;
			d += `${i === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`;
		}
		parts.push(p.closed[s] ? `${d}Z` : d);
	}
	return parts.join("");
}
