/**
 * The body parts of rig evaluation, driven by the animated skeleton (joint
 * rotations arrive as quaternions in raw controls):
 *
 * - RBF solvers measure how close the current rotations are to each of a
 *   set of poses (by Euclidean, quaternion arc, swing or twist distance,
 *   through a Gaussian, exponential, linear, cubic or quintic kernel), and
 *   the pose weights drive corrective controls: the shoulder and elbow
 *   shapes linear skinning alone cannot make.
 * - Twist/swing splits a joint's rotation about an axis and spreads it over
 *   helper joints (forearm twist bones, the shoulder following the arm).
 *
 * Based on OpenRigLogic's RigLogic (MIT, Epic Games): the solver, distance,
 * kernel, slerp and quaternion-to-Euler code follow `RBFSolver.cpp`,
 * `InterpolativeRBFSolver.cpp`, `TwistSwingJointsEvaluator.h` and tdm.
 */
import type {
	DnaFile,
	RbfSolver,
	RotationSequence,
	TwistAxis,
	TwistSwingSetup,
} from "./read.js";

type Q = [number, number, number, number];

const AXIS_INDEX: Record<TwistAxis, number> = { x: 0, y: 1, z: 2 };
const FLOAT_EPSILON = 1.1920929e-7;

// ── Quaternion parts ────────────────────────────────────────────────

/** The swing part about `axis` (twist removed), in place; w comes out non-positive, as RigLogic's. */
function toSwing(q: Float64Array, o: number, axis: TwistAxis): void {
	const [x, y, z, w] = [
		q[o] as number,
		q[o + 1] as number,
		q[o + 2] as number,
		q[o + 3] as number,
	];
	if (axis === "x") {
		const nw = -Math.sqrt(x * x + w * w);
		q.set([0, (w * y - x * z) / nw, (w * z + x * y) / nw, nw], o);
	} else if (axis === "y") {
		const nw = -Math.sqrt(y * y + w * w);
		q.set([(w * x + y * z) / nw, 0, (w * z - y * x) / nw, nw], o);
	} else {
		const nw = -Math.sqrt(z * z + w * w);
		q.set([(w * x - z * y) / nw, (w * y + z * x) / nw, 0, nw], o);
	}
}

/** The twist part about `axis`, normalized, in place. */
function toTwist(q: Float64Array, o: number, axis: TwistAxis): void {
	const t = AXIS_INDEX[axis];
	q[o + ((t + 1) % 3)] = 0;
	q[o + ((t + 2) % 3)] = 0;
	const m = Math.hypot(q[o + t] as number, q[o + 3] as number);
	if (m === 0) {
		q[o + t] = 0;
		q[o + 3] = 1;
		return;
	}
	q[o + t] = (q[o + t] as number) / m;
	q[o + 3] = (q[o + 3] as number) / m;
}

function twistAngle(q: ArrayLike<number>, o: number): number {
	let a =
		2 *
		Math.atan2(
			(q[o] as number) + (q[o + 1] as number) + (q[o + 2] as number),
			q[o + 3] as number,
		);
	if (a > Math.PI) a -= 2 * Math.PI;
	else if (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

// ── RBF ─────────────────────────────────────────────────────────────

type Distance = (target: Float64Array, input: Float64Array) => number;

const DISTANCE: Record<"euclidean" | "quaternion" | "twistAngle", Distance> = {
	euclidean: (t, x) => {
		let s = 0;
		for (let i = 0; i < x.length; i++)
			s += ((t[i] as number) - (x[i] as number)) ** 2;
		return Math.sqrt(s);
	},
	quaternion: (t, x) => {
		let s = 0;
		for (let o = 0; o + 3 < x.length; o += 4) {
			const dot =
				(t[o] as number) * (x[o] as number) +
				(t[o + 1] as number) * (x[o + 1] as number) +
				(t[o + 2] as number) * (x[o + 2] as number) +
				(t[o + 3] as number) * (x[o + 3] as number);
			const d2 = dot * dot;
			const arc = d2 > 1 ? 0 : Math.acos(2 * d2 - 1);
			s += arc * arc;
		}
		return Math.sqrt(s);
	},
	twistAngle: (t, x) => {
		let s = 0;
		for (let o = 0; o + 3 < x.length; o += 4)
			s += (twistAngle(t, o) - twistAngle(x, o)) ** 2;
		return Math.sqrt(s);
	},
};

const KERNEL: Record<
	RbfSolver["functionType"],
	(d: number, width: number) => number
> = {
	linear: (d, w) => Math.max(0, 1 - d / w),
	cubic: (d, w) => Math.max(0, 1 - (d / w) ** 3),
	quintic: (d, w) => Math.max(0, 1 - (d / w) ** 5),
	gaussian: (d, w) => Math.exp(-d / (w * w)),
	exponential: (d, w) => Math.exp((-2 * d) / w),
};

/** Inverts `m` in place by LU decomposition with scaled partial pivoting; leaves it as is when a row is all zero. */
function invert(m: Float64Array[]): Float64Array[] {
	const n = m.length;
	const a = m.map((row) => Float64Array.from(row));
	const permute = new Array<number>(n).fill(0);
	const scale = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		let max = 0;
		for (let j = 0; j < n; j++)
			max = Math.max(max, Math.abs((a[i] as Float64Array)[j] as number));
		if (max === 0) return m;
		scale[i] = 1 / max;
	}
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < j; i++) {
			const ai = a[i] as Float64Array;
			let sum = ai[j] as number;
			for (let k = 0; k < i; k++)
				sum -= (ai[k] as number) * ((a[k] as Float64Array)[j] as number);
			ai[j] = sum;
		}
		let iMax = 0;
		let colMax = 0;
		for (let i = j; i < n; i++) {
			const ai = a[i] as Float64Array;
			let sum = ai[j] as number;
			for (let k = 0; k < j; k++)
				sum -= (ai[k] as number) * ((a[k] as Float64Array)[j] as number);
			ai[j] = sum;
			const t = (scale[i] as number) * Math.abs(sum);
			if (t >= colMax) {
				colMax = t;
				iMax = i;
			}
		}
		if (j !== iMax) {
			const rowMax = a[iMax];
			const rowJ = a[j];
			if (rowMax && rowJ) {
				a[iMax] = rowJ;
				a[j] = rowMax;
			}
			scale[iMax] = scale[j] as number;
		}
		permute[j] = iMax;
		const aj = a[j] as Float64Array;
		if (aj[j] === 0) aj[j] = 1e-20;
		if (j !== n - 1) {
			const t = 1 / (aj[j] as number);
			for (let i = j + 1; i < n; i++)
				(a[i] as Float64Array)[j] = ((a[i] as Float64Array)[j] as number) * t;
		}
	}
	const inv = Array.from({ length: n }, () => new Float64Array(n));
	for (let j = 0; j < n; j++) {
		const b = new Float64Array(n);
		b[j] = 1;
		let ii = 0;
		for (let i = 0; i < n; i++) {
			const ip = permute[i] as number;
			let sum = b[ip] as number;
			b[ip] = b[i] as number;
			if (ii)
				for (let k = ii - 1; k < i; k++)
					sum -= ((a[i] as Float64Array)[k] as number) * (b[k] as number);
			else if (sum !== 0) ii = i + 1;
			b[i] = sum;
		}
		for (let i = n - 1; i >= 0; i--) {
			let sum = b[i] as number;
			for (let k = i + 1; k < n; k++)
				sum -= ((a[i] as Float64Array)[k] as number) * (b[k] as number);
			b[i] = sum / ((a[i] as Float64Array)[i] as number);
		}
		for (let i = 0; i < n; i++) (inv[i] as Float64Array)[j] = b[i] as number;
	}
	return inv;
}

/** A solver ready to run: converted targets, radius, interpolation coefficients. */
export class RbfSolverRuntime {
	private readonly targets: Float64Array[];
	private readonly distance: Distance;
	private readonly convert: (q: Float64Array) => void;
	private readonly radius: number;
	private readonly coefficients?: Float64Array[];
	private readonly input: Float64Array;
	/** Pose weights from the last `solve`. */
	readonly weights: Float64Array;
	/** The controls its poses write, cleared before they add up. */
	readonly outputs: number[];

	constructor(
		readonly solver: RbfSolver,
		private readonly scales: number[],
		angleToRadians: number,
		poseOutputs: number[],
	) {
		const n = solver.rawControlIndices.length;
		const convertEach =
			solver.distanceMethod === "twistAngle"
				? toTwist
				: solver.distanceMethod === "swingAngle"
					? toSwing
					: undefined;
		this.convert = (q) => {
			if (convertEach)
				for (let o = 0; o + 3 < q.length; o += 4)
					convertEach(q, o, solver.twistAxis);
		};
		this.distance =
			DISTANCE[
				solver.distanceMethod === "swingAngle"
					? "quaternion"
					: solver.distanceMethod
			];
		this.targets = Array.from(solver.poseIndices, (_, i) => {
			const t = Float64Array.from(
				solver.rawControlValues.subarray(i * n, i * n + n),
			);
			this.convert(t);
			return t;
		});
		const count = this.targets.length;
		if (solver.automaticRadius) {
			let sum = 0;
			for (let i = 0; i < count; i++)
				for (let j = i + 1; j < count; j++)
					sum += this.distance(
						this.targets[j] as Float64Array,
						this.targets[i] as Float64Array,
					);
			this.radius = sum / ((count * (count - 1)) / 2);
		} else this.radius = solver.radius * angleToRadians;
		if (solver.solverType === "interpolative") {
			const kernel = KERNEL[solver.functionType];
			const m = this.targets.map((ti) =>
				Float64Array.from(this.targets, (tj) =>
					kernel(this.distance(tj, ti), this.radius),
				),
			);
			this.coefficients = invert(m);
		}
		this.input = new Float64Array(n);
		this.weights = new Float64Array(count);
		this.outputs = [...new Set(poseOutputs)].sort((x, y) => x - y);
	}

	/** Pose weights for the current controls. */
	solve(controls: Float32Array): void {
		const s = this.solver;
		s.rawControlIndices.forEach((c, i) => {
			this.input[i] = controls[c] as number;
		});
		this.convert(this.input);
		const kernel = KERNEL[s.functionType];
		const count = this.targets.length;
		const near: Float64Array = Float64Array.from(this.targets, (t) =>
			kernel(this.distance(t, this.input), this.radius),
		);
		const w = this.weights;
		if (this.coefficients) {
			for (let i = 0; i < count; i++) {
				let sum = 0;
				const row = this.coefficients[i] as Float64Array;
				for (let j = 0; j < count; j++)
					sum += (row[j] as number) * (near[j] as number);
				w[i] = Math.min(1, Math.max(0, sum));
			}
		} else w.set(near);
		let total = 0;
		for (const x of w) total += x;
		const ratio = total > 1 || s.normalizeMethod === "always" ? 1 / total : 1;
		for (let i = 0; i < count; i++) {
			const x = (w[i] as number) * ratio * (this.scales[i] as number);
			w[i] = x > s.weightThreshold ? x : 0;
		}
	}
}

// ── Twist and swing ─────────────────────────────────────────────────

/** A swing (and the twist on the same source joint, if any), or a twist alone. */
export interface TwistSwingRuntime {
	swing?: TwistSwingSetup;
	twist?: TwistSwingSetup;
}

/** Swings first, then each twist joins the swing on the same source joint or stands alone. */
export function twistSwingSetups(dna: DnaFile): TwistSwingRuntime[] {
	const ts = dna.twistSwing;
	if (!ts) return [];
	const setups: TwistSwingRuntime[] = ts.swings.map((swing) => ({ swing }));
	const same = (a: Uint16Array, b: Uint16Array) =>
		a.length === b.length && a.every((v, i) => v === b[i]);
	for (const twist of ts.twists) {
		const host = setups.find(
			(s) =>
				s.swing && same(s.swing.inputControlIndices, twist.inputControlIndices),
		);
		if (host) host.twist = twist;
		else setups.push({ twist });
	}
	return setups;
}

const mul = (a: Q, b: Q): Q => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
	a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

function inverse(q: Q): Q {
	const l2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
	return [-q[0] / l2, -q[1] / l2, -q[2] / l2, q[3] / l2];
}

/** tdm's slerp: toward the nearer of q2 and −q2; linear when nearly equal. */
function slerp(q1: Q, q2: Q, t: number): Q {
	let cos = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
	let b: Q = q2;
	if (cos < 0) {
		b = [-q2[0], -q2[1], -q2[2], -q2[3]];
		cos = -cos;
	}
	let t1: number;
	let t2: number;
	if (cos > 1 - FLOAT_EPSILON) {
		t1 = 1 - t;
		t2 = t;
	} else {
		const theta = Math.acos(cos);
		const r = 1 / Math.sin(theta);
		t1 = Math.sin((1 - t) * theta) * r;
		t2 = Math.sin(t * theta) * r;
	}
	return [
		q1[0] * t1 + b[0] * t2,
		q1[1] * t1 + b[1] * t2,
		q1[2] * t1 + b[2] * t2,
		q1[3] * t1 + b[3] * t2,
	];
}

function twistOf(q: Q, axis: TwistAxis): Q {
	const t: Q = [0, 0, 0, q[3]];
	const k = AXIS_INDEX[axis];
	t[k] = q[k];
	const l2 = t[k] * t[k] + t[3] * t[3];
	if (l2 === 0) return [0, 0, 0, 1];
	const l = Math.sqrt(l2);
	return [t[0] / l, t[1] / l, t[2] / l, t[3] / l];
}

/** tdm's 7th-degree minimax asin. */
function fastAsin(value: number): number {
	const halfPi = 1.570796305;
	const nonNegative = value >= 0;
	const v = Math.abs(value);
	const root = Math.sqrt(Math.max(0, 1 - v));
	const r =
		((((((-0.0012624911 * v + 0.0066700901) * v - 0.0170881256) * v +
			0.030891881) *
			v -
			0.0501743046) *
			v +
			0.0889789874) *
			v -
			0.2145988016) *
			v +
		halfPi;
	const acos = r * root;
	return nonNegative ? halfPi - acos : acos - halfPi;
}

const NEAR_POLE = 0.99999999999;

/** tdm's quaternion to Euler angles (radians) in the given order, signs applied. */
export function quatToEuler(
	q: Q,
	order: RotationSequence,
	signs: [number, number, number],
): [number, number, number] {
	const [x, y, z, w] = q;
	const xx2 = 2 * x * x;
	const xy2 = 2 * x * y;
	const xz2 = 2 * x * z;
	const yy2 = 2 * y * y;
	const yz2 = 2 * y * z;
	const zz2 = 2 * z * z;
	const wx2 = 2 * w * x;
	const wy2 = 2 * w * y;
	const wz2 = 2 * w * z;
	let a: [number, number, number];
	switch (order) {
		case "xyz": {
			const s = xz2 - wy2;
			a =
				Math.abs(s) < NEAR_POLE
					? [
							Math.atan2(yz2 + wx2, 1 - (xx2 + yy2)),
							fastAsin(-s),
							Math.atan2(xy2 + wz2, 1 - (yy2 + zz2)),
						]
					: [0, fastAsin(-s), Math.atan2(wz2 - xy2, 1 - (xx2 + zz2))];
			break;
		}
		case "xzy": {
			const s = xy2 + wz2;
			a =
				Math.abs(s) < NEAR_POLE
					? [
							Math.atan2(wx2 - yz2, 1 - (xx2 + zz2)),
							Math.atan2(wy2 - xz2, 1 - (yy2 + zz2)),
							fastAsin(s),
						]
					: [0, Math.atan2(xz2 + wy2, 1 - (xx2 + yy2)), fastAsin(s)];
			break;
		}
		case "yxz": {
			const s = yz2 + wx2;
			a =
				Math.abs(s) < NEAR_POLE
					? [
							fastAsin(s),
							Math.atan2(wy2 - xz2, 1 - (xx2 + yy2)),
							Math.atan2(wz2 - xy2, 1 - (xx2 + zz2)),
						]
					: [fastAsin(s), 0, Math.atan2(xy2 + wz2, 1 - (yy2 + zz2))];
			break;
		}
		case "yzx": {
			const s = xy2 - wz2;
			a =
				Math.abs(s) < NEAR_POLE
					? [
							Math.atan2(yz2 + wx2, 1 - (xx2 + zz2)),
							Math.atan2(xz2 + wy2, 1 - (yy2 + zz2)),
							fastAsin(-s),
						]
					: [Math.atan2(wx2 - yz2, 1 - (xx2 + yy2)), 0, fastAsin(-s)];
			break;
		}
		case "zxy": {
			const s = yz2 - wx2;
			a =
				Math.abs(s) < NEAR_POLE
					? [
							fastAsin(-s),
							Math.atan2(xz2 + wy2, 1 - (xx2 + yy2)),
							Math.atan2(xy2 + wz2, 1 - (xx2 + zz2)),
						]
					: [fastAsin(-s), Math.atan2(wy2 - xz2, 1 - (yy2 + zz2)), 0];
			break;
		}
		case "zyx": {
			const s = xz2 + wy2;
			a =
				Math.abs(s) < NEAR_POLE
					? [
							Math.atan2(wx2 - yz2, 1 - (xx2 + yy2)),
							fastAsin(s),
							Math.atan2(wz2 - xy2, 1 - (yy2 + zz2)),
						]
					: [Math.atan2(yz2 + wx2, 1 - (xx2 + zz2)), fastAsin(s), 0];
			break;
		}
	}
	return [a[0] * signs[0], a[1] * signs[1], a[2] * signs[2]];
}

/**
 * Writes the twist/swing rotations over the joint outputs (Euler angles in
 * the file's units and order, `attributes` values per joint, rotation at 3).
 */
export function applyTwistSwing(
	setups: TwistSwingRuntime[],
	controls: Float32Array,
	out: Float32Array,
	attributes: number,
	order: RotationSequence,
	signs: [number, number, number],
	fromRadians: number,
): void {
	const identity: Q = [0, 0, 0, 1];
	const quat = (idx: Uint16Array): Q => [
		controls[idx[0] as number] as number,
		controls[idx[1] as number] as number,
		controls[idx[2] as number] as number,
		controls[idx[3] as number] as number,
	];
	const write = (joint: number, q: Q) => {
		const e = quatToEuler(q, order, signs);
		const o = joint * attributes + 3;
		out[o] = e[0] * fromRadians;
		out[o + 1] = e[1] * fromRadians;
		out[o + 2] = e[2] * fromRadians;
	};
	for (const { swing, twist } of setups) {
		let invTwist: Q = identity;
		if (swing) {
			const input = quat(swing.inputControlIndices);
			invTwist = inverse(twistOf(input, swing.twistAxis));
			const invSwing = inverse(mul(input, invTwist));
			swing.outputJointIndices.forEach((joint, i) => {
				write(
					joint,
					mul(
						invTwist,
						slerp(invSwing, identity, swing.blendWeights[i] as number),
					),
				);
			});
		}
		if (twist && !swing)
			invTwist = twistOf(quat(twist.inputControlIndices), twist.twistAxis);
		if (twist)
			twist.outputJointIndices.forEach((joint, i) => {
				write(
					joint,
					slerp(invTwist, identity, twist.blendWeights[i] as number),
				);
			});
	}
}
