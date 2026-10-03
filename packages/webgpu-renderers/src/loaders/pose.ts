/**
 * Poses a model's scene graph (glTF semantics): samples an animation clip's
 * translation / rotation / scale tracks at a time, composes the node
 * hierarchy into model-space matrices, and turns a skin's joints into the
 * joint matrices the mesh shader blends (joint world × inverse bind).
 */
import { type Mat4, Matrix4Math, type Vec3 } from "../math3d/index.js";
import type {
	AnimationClip3D,
	Model3DData,
	ModelNode3D,
	NodeAnimationTrack3D,
} from "./types.js";

/** Joints per skin the mesh shader holds (mesh3d.wgsl jointMatrices). */
export const MAX_JOINTS = 128;

export type Quat = [number, number, number, number];

/** Column-major translate · rotate(quaternion) · scale. */
export function trsMatrix(t: Vec3, q: Quat, s: Vec3): Mat4 {
	const [x, y, z, w] = q;
	const xx = x * x;
	const yy = y * y;
	const zz = z * z;
	const xy = x * y;
	const xz = x * z;
	const yz = y * z;
	const wx = w * x;
	const wy = w * y;
	const wz = w * z;
	return [
		(1 - 2 * (yy + zz)) * s[0],
		2 * (xy + wz) * s[0],
		2 * (xz - wy) * s[0],
		0,
		2 * (xy - wz) * s[1],
		(1 - 2 * (xx + zz)) * s[1],
		2 * (yz + wx) * s[1],
		0,
		2 * (xz + wy) * s[2],
		2 * (yz - wx) * s[2],
		(1 - 2 * (xx + yy)) * s[2],
		0,
		t[0],
		t[1],
		t[2],
		1,
	];
}

function normalizeQuat(q: Quat): Quat {
	const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
	let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	const sign = cos < 0 ? -1 : 1;
	cos *= sign;
	if (cos > 0.9995) {
		return normalizeQuat([
			a[0] + (sign * b[0] - a[0]) * t,
			a[1] + (sign * b[1] - a[1]) * t,
			a[2] + (sign * b[2] - a[2]) * t,
			a[3] + (sign * b[3] - a[3]) * t,
		]);
	}
	const theta = Math.acos(cos);
	const sin = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sin;
	const wb = (sign * Math.sin(t * theta)) / sin;
	return [
		a[0] * wa + b[0] * wb,
		a[1] * wa + b[1] * wb,
		a[2] * wa + b[2] * wb,
		a[3] * wa + b[3] * wb,
	];
}

/** Index of the last keyframe at or before `time` (binary search). */
function keyBefore(times: Float32Array, time: number): number {
	let lo = 0;
	let hi = times.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((times[mid] ?? 0) <= time) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** Element `k` (of `size` components) of a track's values; cubic tracks store [in, value, out] triples. */
function valueAt(
	values: Float32Array,
	k: number,
	size: number,
	cubic: boolean,
	part = 1,
): number[] {
	const at = cubic ? (k * 3 + part) * size : k * size;
	return Array.from(values.subarray(at, at + size));
}

function sampleChannel(
	track: NodeAnimationTrack3D,
	values: Float32Array,
	size: number,
	time: number,
): number[] {
	const { times } = track;
	const cubic = track.interpolation === "cubic";
	const last = times.length - 1;
	if (time <= (times[0] ?? 0)) return valueAt(values, 0, size, cubic);
	if (time >= (times[last] ?? 0)) return valueAt(values, last, size, cubic);
	const k = keyBefore(times, time);
	if (track.interpolation === "step") return valueAt(values, k, size, cubic);
	const t0 = times[k] ?? 0;
	const dt = (times[k + 1] ?? t0) - t0;
	const u = dt > 0 ? (time - t0) / dt : 0;
	const a = valueAt(values, k, size, cubic);
	const b = valueAt(values, k + 1, size, cubic);
	if (cubic) {
		// Hermite with the glTF tangents (scaled by the keyframe gap).
		const outA = valueAt(values, k, size, true, 2);
		const inB = valueAt(values, k + 1, size, true, 0);
		const u2 = u * u;
		const u3 = u2 * u;
		const out = a.map(
			(p0, i) =>
				(2 * u3 - 3 * u2 + 1) * p0 +
				(u3 - 2 * u2 + u) * dt * (outA[i] ?? 0) +
				(-2 * u3 + 3 * u2) * (b[i] ?? 0) +
				(u3 - u2) * dt * (inB[i] ?? 0),
		);
		return size === 4 ? normalizeQuat(out as Quat) : out;
	}
	if (size === 4) return slerp(a as Quat, b as Quat, u);
	return a.map((v, i) => v + ((b[i] ?? v) - v) * u);
}

/** Each node's local matrix with the clip's tracks applied at `time` (seconds). */
function localMatrices(
	nodes: ModelNode3D[],
	clip: AnimationClip3D | undefined,
	time: number,
): Mat4[] {
	const t = nodes.map((n) => [...n.translation] as Vec3);
	const r = nodes.map((n) => [...n.rotation] as Quat);
	const s = nodes.map((n) => [...n.scale] as Vec3);
	const byName = new Map(nodes.map((n, i) => [n.name, i]));
	for (const track of clip?.tracks ?? []) {
		const i = track.node ?? byName.get(track.nodeName);
		if (i === undefined || !track.times.length) continue;
		if (track.translations)
			t[i] = sampleChannel(track, track.translations, 3, time) as Vec3;
		if (track.rotations)
			r[i] = sampleChannel(track, track.rotations, 4, time) as Quat;
		if (track.scales) s[i] = sampleChannel(track, track.scales, 3, time) as Vec3;
	}
	return nodes.map((n, i) => n.matrix ?? trsMatrix(t[i]!, r[i]!, s[i]!));
}

/**
 * Model-space matrix of every node, posed by `clip` at `time` seconds (the
 * rest pose without a clip). Parents may follow their children in the list.
 */
export function poseNodes(
	model: Model3DData,
	clip: AnimationClip3D | undefined,
	time: number,
): Mat4[] {
	const nodes = model.nodes ?? [];
	const local = localMatrices(nodes, clip, time);
	const world: (Mat4 | undefined)[] = new Array(nodes.length);
	const resolve = (i: number): Mat4 => {
		const done = world[i];
		if (done) return done;
		const parent = nodes[i]!.parent;
		const m =
			parent < 0 ? local[i]! : Matrix4Math.multiply(resolve(parent), local[i]!);
		world[i] = m;
		return m;
	};
	return nodes.map((_, i) => resolve(i));
}

/** The joint matrices of one skin for a posed scene graph, padded with identity to MAX_JOINTS. */
export function jointMatrices(
	model: Model3DData,
	skinIndex: number,
	world: Mat4[],
): Float32Array {
	const skin = model.skins?.[skinIndex];
	if (!skin) throw new Error(`model has no skin ${skinIndex}`);
	const out = new Float32Array(MAX_JOINTS * 16);
	for (let j = 0; j < MAX_JOINTS; j++) {
		const node = skin.joints[j];
		if (node === undefined) {
			out.set(Matrix4Math.identity(), j * 16);
			continue;
		}
		const ibm = Array.from(
			skin.inverseBindMatrices.subarray(j * 16, j * 16 + 16),
		) as Mat4;
		out.set(Matrix4Math.multiply(world[node]!, ibm), j * 16);
	}
	return out;
}
