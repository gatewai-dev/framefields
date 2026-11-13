/**
 * The CPU reference evaluator of a packed clay program. It reads the same
 * records, in the same order, with the same arithmetic as the WGSL one in
 * `field.wgsl.ts`: change them together.
 *
 * Material joins follow Quilez's polynomial smooth min / max; the blend
 * weight they compute also mixes the two sides' colors. Warps are
 * regularized Kelvinlets (de Goes & James 2017) for an incompressible
 * solid, faded to zero at their reach.
 */
import {
	CLAY_EMPTY,
	GROUP_END,
	isWarp,
	MAX_WARPS,
	OP,
	OP_FLOATS,
} from "./layout.js";

const SQRT3 = Math.sqrt(3);

/** Scratch: a vector result, and the point as each run of records sees it. */
const vec = new Float64Array(3);
let levels = new Float64Array((MAX_WARPS + 1) * 3);

/** v rotated by the unit quaternion at `ops[q..q+3]`, into `vec`. */
function rotate(ops: Float32Array, q: number, x: number, y: number, z: number) {
	const qx = ops[q];
	const qy = ops[q + 1];
	const qz = ops[q + 2];
	const qw = ops[q + 3];
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	vec[0] = x + qw * tx + (qy * tz - qz * ty);
	vec[1] = y + qw * ty + (qz * tx - qx * tz);
	vec[2] = z + qw * tz + (qx * ty - qy * tx);
}

function boxDistance(
	ops: Float32Array,
	o: number,
	x: number,
	y: number,
	z: number,
) {
	const r = ops[o + 7];
	const qx = Math.abs(x) - ops[o + 12] + r;
	const qy = Math.abs(y) - ops[o + 13] + r;
	const qz = Math.abs(z) - ops[o + 14] + r;
	const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
	return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Distance to the solid at record `o` (cylinders, capsules and tori stand along y). */
function solidDistance(
	ops: Float32Array,
	o: number,
	px: number,
	py: number,
	pz: number,
): number {
	rotate(ops, o + 8, px - ops[o + 4], py - ops[o + 5], pz - ops[o + 6]);
	const [x, y, z] = vec;
	const size = ops[o + 7];
	switch (ops[o]) {
		case OP.sphere:
			return Math.hypot(x, y, z) - size;
		case OP.box:
			return boxDistance(ops, o, x, y, z);
		case OP.cylinder: {
			const dr = Math.hypot(x, z) - size;
			const dy = Math.abs(y) - ops[o + 12];
			return (
				Math.min(Math.max(dr, dy), 0) +
				Math.hypot(Math.max(dr, 0), Math.max(dy, 0))
			);
		}
		case OP.capsule: {
			const half = ops[o + 12];
			return Math.hypot(x, y - Math.max(-half, Math.min(half, y)), z) - size;
		}
		default:
			return Math.hypot(Math.hypot(x, z) - size, y) - ops[o + 12];
	}
}

/**
 * Distance to a ball swept along the quadratic Bézier A, B, C of record
 * `o`, its radius running from A's to C's: the closest point comes from
 * the cubic the curve's distance derivative is (Quilez's closed form).
 */
function segmentDistance(
	ops: Float32Array,
	o: number,
	px: number,
	py: number,
	pz: number,
): number {
	const ax = ops[o + 8] - ops[o + 4];
	const ay = ops[o + 9] - ops[o + 5];
	const az = ops[o + 10] - ops[o + 6];
	const bx = ops[o + 4] - 2 * ops[o + 8] + ops[o + 12];
	const by = ops[o + 5] - 2 * ops[o + 9] + ops[o + 13];
	const bz = ops[o + 6] - 2 * ops[o + 10] + ops[o + 14];
	const dx = ops[o + 4] - px;
	const dy = ops[o + 5] - py;
	const dz = ops[o + 6] - pz;
	const limit = ops[o + 11];
	const r0 = ops[o + 7];
	const r1 = ops[o + 15];
	const at = (tRaw: number) => {
		const t = Math.min(limit, Math.max(0, tRaw));
		const qx = dx + (2 * ax + bx * t) * t;
		const qy = dy + (2 * ay + by * t) * t;
		const qz = dz + (2 * az + bz * t) * t;
		return Math.hypot(qx, qy, qz) - (r0 + (r1 - r0) * t);
	};
	const aa = ax * ax + ay * ay + az * az;
	const bb = bx * bx + by * by + bz * bz;
	if (bb <= 1e-6 * aa || bb < 1e-12) {
		// Straight (or a single point): project onto the chord A → C.
		const cx = 2 * ax + bx;
		const cy = 2 * ay + by;
		const cz = 2 * az + bz;
		const cc = cx * cx + cy * cy + cz * cz;
		return at(cc > 1e-12 ? -(dx * cx + dy * cy + dz * cz) / cc : 0);
	}
	const kk = 1 / bb;
	const kx = kk * (ax * bx + ay * by + az * bz);
	const ky = (kk * (2 * aa + dx * bx + dy * by + dz * bz)) / 3;
	const kz = kk * (dx * ax + dy * ay + dz * az);
	const p = ky - kx * kx;
	const q = kx * (2 * kx * kx - 3 * ky) + kz;
	const h = q * q + 4 * p * p * p;
	if (h >= 0) {
		const s = Math.sqrt(h);
		return at(Math.cbrt((s - q) / 2) + Math.cbrt((-s - q) / 2) - kx);
	}
	const zr = Math.sqrt(-p);
	const v = Math.acos(Math.max(-1, Math.min(1, q / (p * zr * 2)))) / 3;
	const m = Math.cos(v);
	const n = Math.sin(v) * SQRT3;
	return Math.min(
		at((m + m) * zr - kx),
		at((-n - m) * zr - kx),
		at((n - m) * zr - kx),
	);
}

/** 1 at the center, 0 from `reach` on: (1 - r²/reach²)². */
function fade(r2: number, reach: number): number {
	const x = Math.max(0, 1 - r2 / (reach * reach));
	return x * x;
}

/** Displacement of the warp at record `o` at (x, y, z), into `out`. */
export function warpAt(
	ops: Float32Array,
	o: number,
	x: number,
	y: number,
	z: number,
	out: Float64Array = vec,
): void {
	const rx = x - ops[o + 4];
	const ry = y - ops[o + 5];
	const rz = z - ops[o + 6];
	const e = ops[o + 7];
	const r2 = rx * rx + ry * ry + rz * rz;
	const w = fade(r2, ops[o + 11]);
	const re = Math.sqrt(r2 + e * e);
	const vx = ops[o + 8];
	const vy = ops[o + 9];
	const vz = ops[o + 10];
	if (ops[o] === OP.grab) {
		// u = c [ (1/2r + e²/2r³) d + (r·d) r / 2r³ ], u(0) = d.
		const re3 = re * re * re;
		const a = e * (0.5 / re + (e * e) / (2 * re3)) * w;
		const b = ((e * 0.5) / re3) * (rx * vx + ry * vy + rz * vz) * w;
		out[0] = a * vx + b * rx;
		out[1] = a * vy + b * ry;
		out[2] = a * vz + b * rz;
		return;
	}
	const s = e / re;
	const s3 = s * s * s;
	const k = ((s3 + 1.5 * s3 * s * s) / 2.5) * w;
	if (ops[o] === OP.twist) {
		out[0] = k * (vy * rz - vz * ry);
		out[1] = k * (vz * rx - vx * rz);
		out[2] = k * (vx * ry - vy * rx);
		return;
	}
	out[0] = k * vx * rx;
	out[1] = k * vx * ry;
	out[2] = k * vx * rz;
}

/** Lattice value in -1..1 from integer coordinates: the same bits on CPU and GPU. */
function hash(i: number, j: number, k: number, seed: number): number {
	let h =
		Math.imul(i, 0x8da6b343) ^
		Math.imul(j, 0xd8163841) ^
		Math.imul(k, 0xcb1ab31f) ^
		Math.imul(seed, 0x165667b1);
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	h = Math.imul(h, 0x297a2d39);
	h ^= h >>> 15;
	return ((h >>> 8) / 16777216) * 2 - 1;
}

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value noise in -1..1. */
export function noise3(x: number, y: number, z: number, seed: number): number {
	const i = Math.floor(x);
	const j = Math.floor(y);
	const k = Math.floor(z);
	const u = quintic(x - i);
	const v = quintic(y - j);
	const w = quintic(z - k);
	const row = (dj: number, dk: number) =>
		lerp(hash(i, j + dj, k + dk, seed), hash(i + 1, j + dj, k + dk, seed), u);
	return lerp(lerp(row(0, 0), row(1, 0), v), lerp(row(0, 1), row(1, 1), v), w);
}

/** How far the detail at record `o` raises the surface at (x, y, z). */
function detailAt(
	ops: Float32Array,
	o: number,
	x: number,
	y: number,
	z: number,
	footprint: number,
): number {
	const octaves = ops[o + 10];
	const seed = ops[o + 11];
	const ridged = ops[o + 14] > 0.5;
	let frequency = ops[o + 9];
	let height = 1;
	let sum = 0;
	for (let i = 0; i < octaves; i++) {
		// An octave fades out as its wavelength nears two pixels.
		const visible =
			footprint > 0
				? Math.min(1, Math.max(0, 1 / (2 * footprint * frequency) - 1))
				: 1;
		if (visible > 0) {
			const n = noise3(x * frequency, y * frequency, z * frequency, seed + i);
			sum += height * visible * (ridged ? 1 - 2 * Math.abs(n) : n);
		}
		height *= ops[o + 12];
		frequency *= ops[o + 13];
	}
	const radius = ops[o + 7];
	if (radius > 0) {
		const rx = x - ops[o + 4];
		const ry = y - ops[o + 5];
		const rz = z - ops[o + 6];
		sum *= fade(rx * rx + ry * ry + rz * rz, radius);
	}
	return sum * ops[o + 8];
}

/** Joins `e` (color at `ops[c..]`) into the running value and color in `out`. */
function join(
	out: Float64Array,
	e: number,
	mode: number,
	smoothness: number,
	ops: Float32Array,
	c: number,
): void {
	const k = Math.max(smoothness, 1e-6);
	const d = out[0];
	// The other operand: inverted for a cut.
	const o = mode === 1 ? -e : e;
	let h: number;
	if (mode === 0) {
		h = Math.min(1, Math.max(0, 0.5 + (0.5 * (o - d)) / k));
		out[0] = o + (d - o) * h - k * h * (1 - h);
	} else {
		h = Math.min(1, Math.max(0, 0.5 + (0.5 * (d - o)) / k));
		out[0] = o + (d - o) * h + k * h * (1 - h);
	}
	// A record without a color of its own (alpha 0) keeps the running one.
	if (ops[c + 3] < 0.5) return;
	for (let i = 0; i < 3; i++) out[1 + i] = lerp(ops[c + i], out[1 + i], h);
}

/**
 * Walks the warps of a list backwards from the point, so `levels[n]` is the
 * point as the records after the list's n-th warp see it.
 */
function unwarp(
	ops: Float32Array,
	lists: Uint32Array,
	offset: number,
	count: number,
	warps: number,
): void {
	let level = warps;
	for (let i = count - 1; i >= 0 && level > 0; i--) {
		const o = (lists[offset + i] & ~GROUP_END) * OP_FLOATS;
		const type = ops[o];
		if (!isWarp(type)) continue;
		const at = level * 3;
		const x = levels[at];
		const y = levels[at + 1];
		const z = levels[at + 2];
		// Where the material now at the point came from: two fixed-point steps.
		warpAt(ops, o, x, y, z);
		warpAt(ops, o, x - vec[0], y - vec[1], z - vec[2]);
		level--;
		levels[level * 3] = x - vec[0];
		levels[level * 3 + 1] = y - vec[1];
		levels[level * 3 + 2] = z - vec[2];
	}
}

/**
 * Evaluates one list of records at a point. `out` receives the signed
 * distance bound, then the color (rgba). `footprint` is the size of a
 * pixel there (0 = full detail).
 */
export function evalList(
	ops: Float32Array,
	lists: Uint32Array,
	offset: number,
	count: number,
	warps: number,
	symmetry: number,
	x: number,
	y: number,
	z: number,
	footprint: number,
	out: Float64Array,
): void {
	// A whole program can hold more warps than a brick's list may.
	if (levels.length < (warps + 1) * 3)
		levels = new Float64Array((warps + 1) * 3);
	levels[warps * 3] = symmetry & 1 ? Math.abs(x) : x;
	levels[warps * 3 + 1] = symmetry & 2 ? Math.abs(y) : y;
	levels[warps * 3 + 2] = symmetry & 4 ? Math.abs(z) : z;
	unwarp(ops, lists, offset, count, warps);

	out[0] = CLAY_EMPTY;
	out[1] = out[2] = out[3] = out[4] = 1;
	let level = 0;
	let stroke = CLAY_EMPTY;
	for (let i = 0; i < count; i++) {
		const entry = lists[offset + i];
		const o = (entry & ~GROUP_END) * OP_FLOATS;
		const type = ops[o];
		if (isWarp(type)) {
			level++;
			continue;
		}
		const px = levels[level * 3];
		const py = levels[level * 3 + 1];
		const pz = levels[level * 3 + 2];
		if (type === OP.segment) {
			stroke = Math.min(stroke, segmentDistance(ops, o, px, py, pz));
			if (entry & GROUP_END) {
				join(out, stroke, ops[o + 1], ops[o + 2], ops, o + 16);
				stroke = CLAY_EMPTY;
			}
		} else if (type === OP.inflate) {
			const rx = px - ops[o + 4];
			const ry = py - ops[o + 5];
			const rz = pz - ops[o + 6];
			out[0] -= ops[o + 8] * fade(rx * rx + ry * ry + rz * rz, ops[o + 7]);
		} else if (type === OP.detail) {
			out[0] -= detailAt(ops, o, px, py, pz, footprint);
		} else {
			join(
				out,
				solidDistance(ops, o, px, py, pz),
				ops[o + 1],
				ops[o + 2],
				ops,
				o + 16,
			);
		}
	}
}
