/**
 * Node motion sampled once per exported frame, as glTF animation channels.
 *
 * Every frame gives a node's local matrix (already in glTF axes). Each one
 * is split into translation, rotation and scale; rotations are kept on one
 * side of the quaternion double cover so slerp takes the short way; and keys
 * a linear (or slerp) interpolation of their neighbours reproduces within a
 * tolerance are dropped. Constant paths become the node's rest transform
 * instead of a channel.
 */
import type { AnimationPath, ChannelSpec, NodeRef } from "./document.js";

export type Trs = {
	translation: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
};

/** How far a key may be from its interpolated value before it is kept. */
export interface KeyTolerance {
	/** Meters. */
	translation: number;
	/** Radians. */
	rotation: number;
	/** Scale factor. */
	scale: number;
}

/** Longest stretch checked against one interpolation: bounds key reduction to O(n · 256). */
const MAX_SPAN = 256;

/**
 * T · R · S of a column-major affine matrix. A mirrored matrix gets its
 * mirror on x. `shear` is the largest cosine between the matrix's scaled
 * axes, which TRS cannot represent.
 */
export function decompose(m: ArrayLike<number>): Trs & { shear: number } {
	const ax = [m[0], m[1], m[2]];
	const ay = [m[4], m[5], m[6]];
	const az = [m[8], m[9], m[10]];
	let sx = Math.hypot(ax[0], ax[1], ax[2]);
	const sy = Math.hypot(ay[0], ay[1], ay[2]);
	const sz = Math.hypot(az[0], az[1], az[2]);
	const det =
		ax[0] * (ay[1] * az[2] - ay[2] * az[1]) -
		ay[0] * (ax[1] * az[2] - ax[2] * az[1]) +
		az[0] * (ax[1] * ay[2] - ax[2] * ay[1]);
	if (det < 0) sx = -sx;
	const unit = (v: number[], s: number) =>
		s === 0 ? [0, 0, 0] : [v[0] / s, v[1] / s, v[2] / s];
	const x = unit(ax, sx);
	const y = unit(ay, sy);
	const z = unit(az, sz);
	const dot = (a: number[], b: number[]) =>
		a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	return {
		translation: [m[12], m[13], m[14]],
		rotation: quatFromAxes(x, y, z),
		scale: [sx, sy, sz],
		shear: Math.max(
			Math.abs(dot(x, y)),
			Math.abs(dot(y, z)),
			Math.abs(dot(x, z)),
		),
	};
}

/** The unit quaternion of an orthonormal basis (columns x, y, z); identity for a degenerate one. */
function quatFromAxes(
	x: number[],
	y: number[],
	z: number[],
): [number, number, number, number] {
	const trace = x[0] + y[1] + z[2];
	let q: [number, number, number, number];
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
	} else if (x[0] > y[1] && x[0] > z[2]) {
		const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
		q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
	} else if (y[1] > z[2]) {
		const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
		q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
	} else {
		const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
		q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
	}
	const l = Math.hypot(q[0], q[1], q[2], q[3]);
	if (!(l > 1e-12) || !Number.isFinite(l)) return [0, 0, 0, 1];
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function slerp(
	a: ArrayLike<number>,
	ao: number,
	b: ArrayLike<number>,
	bo: number,
	t: number,
): [number, number, number, number] {
	let d =
		a[ao] * b[bo] +
		a[ao + 1] * b[bo + 1] +
		a[ao + 2] * b[bo + 2] +
		a[ao + 3] * b[bo + 3];
	const sign = d < 0 ? -1 : 1;
	d *= sign;
	let wa = 1 - t;
	let wb = t * sign;
	if (d < 0.9995) {
		const theta = Math.acos(d);
		const sin = Math.sin(theta);
		wa = Math.sin((1 - t) * theta) / sin;
		wb = (Math.sin(t * theta) / sin) * sign;
	}
	const q: [number, number, number, number] = [0, 0, 0, 0];
	for (let i = 0; i < 4; i++) q[i] = wa * a[ao + i] + wb * b[bo + i];
	const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Whether key `i` is within `tol` of the interpolation of keys `a` and `b`. */
function fits(
	path: AnimationPath,
	times: Float32Array,
	values: Float32Array,
	a: number,
	b: number,
	i: number,
	tol: number,
): boolean {
	const t = (times[i] - times[a]) / (times[b] - times[a]);
	if (path === "rotation") {
		const q = slerp(values, a * 4, values, b * 4, t);
		const o = i * 4;
		const sign =
			q[0] * values[o] +
				q[1] * values[o + 1] +
				q[2] * values[o + 2] +
				q[3] * values[o + 3] <
			0
				? -1
				: 1;
		// The turn between two unit quaternions is 4 asin(|q − p| / 2): exact near zero, where acos of their dot is not.
		const d = Math.hypot(
			q[0] - sign * values[o],
			q[1] - sign * values[o + 1],
			q[2] - sign * values[o + 2],
			q[3] - sign * values[o + 3],
		);
		return 4 * Math.asin(Math.min(1, d / 2)) <= tol;
	}
	for (let c = 0; c < 3; c++) {
		const v = values[a * 3 + c] + (values[b * 3 + c] - values[a * 3 + c]) * t;
		if (Math.abs(v - values[i * 3 + c]) > tol) return false;
	}
	return true;
}

/** The keys a linear/slerp interpolation needs to stay within `tol` of every sample. */
export function reduceKeys(
	path: AnimationPath,
	times: Float32Array,
	values: Float32Array,
	tol: number,
): { times: Float32Array; values: Float32Array } {
	const size = path === "rotation" ? 4 : 3;
	const n = times.length;
	const keep = [0];
	let anchor = 0;
	for (let end = 2; end < n; end++) {
		let ok = end - anchor <= MAX_SPAN;
		for (let i = anchor + 1; ok && i < end; i++)
			ok = fits(path, times, values, anchor, end, i, tol);
		if (!ok) {
			anchor = end - 1;
			keep.push(anchor);
		}
	}
	if (n > 1) keep.push(n - 1);
	const outTimes = new Float32Array(keep.length);
	const outValues = new Float32Array(keep.length * size);
	keep.forEach((k, j) => {
		outTimes[j] = times[k];
		outValues.set(values.subarray(k * size, k * size + size), j * size);
	});
	return { times: outTimes, values: outValues };
}

/**
 * Keys where a stepped value changes (and the first). A change is keyed
 * half a frame early: key times are float32, and a key at the frame's own
 * time can round to just after it, so a player sampling that frame would
 * still hold the previous step.
 */
function stepKeys(
	times: Float32Array,
	values: Float32Array,
): { times: Float32Array; values: Float32Array } {
	const keep = [0];
	for (let i = 1; i < times.length; i++)
		if (values[i * 3] !== values[(i - 1) * 3]) keep.push(i);
	return {
		times: Float32Array.from(keep, (k) =>
			k === 0 ? times[0] : (times[k - 1] + times[k]) / 2,
		),
		values: Float32Array.from(
			keep.flatMap((k) => [
				values[k * 3],
				values[k * 3 + 1],
				values[k * 3 + 2],
			]),
		),
	};
}

function constant(values: Float32Array, size: number, tol: number): boolean {
	for (let i = size; i < values.length; i++)
		if (Math.abs(values[i] - values[i % size]) > tol) return false;
	return true;
}

/**
 * The motion of one node: its local matrices per frame, null where the
 * node is not drawn. Absent frames hold the nearest drawn pose; with
 * `hide` they hold it at scale 0, so the node vanishes there without
 * flying in (a linear key from the frame before is exact at every exported
 * frame). Without it, the caller shows and hides the node's children.
 */
export class NodeMotion {
	readonly trs: Trs;
	/** Largest shear among the frames: what TRS channels drop. */
	readonly shear: number;
	private readonly t: Float32Array;
	private readonly r: Float32Array;
	private readonly s: Float32Array;

	constructor(
		matrices: ReadonlyArray<ArrayLike<number> | null>,
		hide: boolean,
	) {
		const n = matrices.length;
		this.t = new Float32Array(n * 3);
		this.r = new Float32Array(n * 4);
		this.s = new Float32Array(n * 3);
		const parts = matrices.map((m) => (m ? decompose(m) : null));
		const first = parts.findIndex(Boolean);
		if (first < 0) throw new Error("NodeMotion: the node is never drawn");
		let held = parts[first] as Trs & { shear: number };
		let shear = 0;
		for (let f = 0; f < n; f++) {
			const p = parts[f];
			if (p) {
				held = p;
				shear = Math.max(shear, p.shear);
			}
			const pose = p ?? held;
			this.t.set(pose.translation, f * 3);
			this.r.set(pose.rotation, f * 4);
			if (p || !hide) this.s.set(pose.scale, f * 3);
			// Same hemisphere as the previous key, so slerp takes the short way.
			if (f > 0) {
				let d = 0;
				for (let c = 0; c < 4; c++)
					d += this.r[f * 4 + c] * this.r[(f - 1) * 4 + c];
				if (d < 0) for (let c = 0; c < 4; c++) this.r[f * 4 + c] *= -1;
			}
		}
		this.shear = shear;
		const at = (a: Float32Array, size: number) =>
			Array.from(a.subarray(0, size));
		this.trs = {
			translation: at(this.t, 3) as Trs["translation"],
			rotation: at(this.r, 4) as Trs["rotation"],
			scale: at(this.s, 3) as Trs["scale"],
		};
	}

	/** The paths that move more than `tol` across the frames. */
	private moving(
		tol: KeyTolerance,
	): Array<[AnimationPath, Float32Array, number]> {
		const paths: Array<[AnimationPath, Float32Array, number]> = [
			["translation", this.t, tol.translation],
			["rotation", this.r, tol.rotation],
			["scale", this.s, tol.scale],
		];
		return paths.filter(([path, values, eps]) =>
			path === "rotation"
				? // Quaternion components move by about half the angle.
					!constant(values, 4, eps / 2)
				: !constant(values, 3, eps),
		);
	}

	/** Whether the node holds one transform throughout. */
	still(tol: KeyTolerance): boolean {
		return this.moving(tol).length === 0;
	}

	/** Channels for the paths that move; the others stay in `trs`. */
	channels(
		node: NodeRef,
		times: Float32Array,
		tol: KeyTolerance,
	): ChannelSpec[] {
		return this.moving(tol).map(([path, values, eps]) => ({
			node,
			path,
			...reduceKeys(path, times, values, eps),
		}));
	}
}

/** A stepped scale channel that shows a node (1) or hides it (0) per frame. */
export function visibilityChannel(
	node: NodeRef,
	times: Float32Array,
	shown: ReadonlyArray<boolean>,
): ChannelSpec {
	const values = new Float32Array(shown.length * 3);
	shown.forEach((on, f) => {
		if (on) values.fill(1, f * 3, f * 3 + 3);
	});
	return {
		node,
		path: "scale",
		interpolation: "step",
		...stepKeys(times, values),
	};
}
