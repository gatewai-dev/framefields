/**
 * How much a warp can steepen the field. The field after a warp is the
 * field before it read at where the material came from, so it steepens by
 * the Lipschitz constant of that inverse map: the largest singular value of
 * (I + ∇u)⁻¹. For a twist that is close to 1 however large the angle (a
 * rotation stretches nothing), which a bound from the size of ∇u misses.
 */
import { warpAt } from "./eval.js";

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

/** Radii the stretch is tabulated at, from the center to the reach. */
export const STRETCH_SAMPLES = 16;
/** Measured on a finite set of points: keep this much headroom. */
const HEADROOM = 1.15;

function inverse(m: M3): M3 | null {
	const [[a, b, c], [d, e, f], [g, h, i]] = m;
	const A = e * i - f * h;
	const B = f * g - d * i;
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	if (Math.abs(det) < 1e-9) return null;
	return [
		[A / det, (c * h - b * i) / det, (b * f - c * e) / det],
		[B / det, (a * i - c * g) / det, (c * d - a * f) / det],
		[C / det, (b * g - a * h) / det, (a * e - b * d) / det],
	];
}

/** Largest singular value, by power iteration on MᵀM. */
function spectralNorm(m: M3): number {
	const apply = (v: V3): V3 => {
		const mv = m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
		return [0, 1, 2].map(
			(j) => m[0][j] * mv[0] + m[1][j] * mv[1] + m[2][j] * mv[2],
		) as V3;
	};
	let v: V3 = [0.62, 0.5, 0.6];
	let norm = 1;
	for (let n = 0; n < 24; n++) {
		const w = apply(v);
		norm = Math.hypot(w[0], w[1], w[2]);
		if (norm < 1e-12) return 0;
		v = [w[0] / norm, w[1] / norm, w[2] / norm];
	}
	return Math.sqrt(norm);
}

/** An orthonormal frame whose first axis is along `v`. */
function frame(v: V3): M3 {
	const len = Math.hypot(v[0], v[1], v[2]);
	const x: V3 = len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : [1, 0, 0];
	const pick: V3 = Math.abs(x[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
	const cross = (a: V3, b: V3): V3 => [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
	const yRaw = cross(x, pick);
	const yLen = Math.hypot(yRaw[0], yRaw[1], yRaw[2]);
	const y: V3 = [yRaw[0] / yLen, yRaw[1] / yLen, yRaw[2] / yLen];
	return [x, y, cross(x, y)];
}

/** Directions over the sphere, relative to the warp's own axis. */
function directions(axes: M3): V3[] {
	const out: V3[] = [];
	for (let i = -1; i <= 1; i++)
		for (let j = -1; j <= 1; j++)
			for (let k = -1; k <= 1; k++) {
				if (i === 0 && j === 0 && k === 0) continue;
				const len = Math.hypot(i, j, k);
				out.push(
					[0, 1, 2].map(
						(c) => (i * axes[0][c] + j * axes[1][c] + k * axes[2][c]) / len,
					) as V3,
				);
			}
	return out;
}

/** The inverse map's Lipschitz constant at a point of the warp record in `op`. */
function stretchAt(op: Float32Array, p: V3, h: number, out: Float64Array) {
	const m: M3 = [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	];
	for (let axis = 0; axis < 3; axis++) {
		const hi: V3 = [...p];
		const lo: V3 = [...p];
		hi[axis] += h;
		lo[axis] -= h;
		warpAt(op, 0, hi[0], hi[1], hi[2], out);
		const up = [out[0], out[1], out[2]];
		warpAt(op, 0, lo[0], lo[1], lo[2], out);
		for (let row = 0; row < 3; row++)
			m[row][axis] += (up[row] - out[row]) / (2 * h);
	}
	const inv = inverse(m);
	return inv ? spectralNorm(inv) : Number.POSITIVE_INFINITY;
}

/**
 * For radii spaced evenly from the warp's center to its reach, how much the
 * warp can steepen the field at that distance or farther (Lipschitz - 1).
 */
export function warpStretch(op: Float32Array): Float32Array {
	const center: V3 = [op[4], op[5], op[6]];
	const reach = op[11];
	const dirs = directions(frame([op[8], op[9], op[10]]));
	const scratch = new Float64Array(3);
	const rings = STRETCH_SAMPLES * 2;
	const table = new Float32Array(STRETCH_SAMPLES);
	let worst = 0;
	for (let ring = rings - 1; ring >= 0; ring--) {
		const r = (reach * (ring + 0.5)) / rings;
		for (const d of dirs) {
			const p = center.map((c, k) => c + d[k] * r) as V3;
			worst = Math.max(worst, stretchAt(op, p, reach * 1e-4, scratch) - 1);
		}
		// Entry i covers every ring from its radius outwards.
		table[Math.floor(ring / 2)] = worst * HEADROOM;
	}
	return table;
}
