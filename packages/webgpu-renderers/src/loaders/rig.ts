/**
 * Character rigs on a model's scene graph: layered clip blending with bone
 * masks, analytic two-bone IK with a pole target, clamped look-at, and
 * deterministic spring bones (follow-through simulated frame by frame from
 * frame 0, so any frame renders the same whether reached in order or not).
 *
 * Everything works in the model's own space; the caller maps scene
 * targets in (and gravity) through the inverse of the model's transform.
 */
import type { Mat4, Vec3 } from "../math3d/index.js";
import {
	composeWorld,
	type LocalPose,
	localPoseMatrices,
	type Quat,
	sampleLocalPose,
	slerp,
} from "./pose.js";
import type { AnimationClip3D, Model3DData, ModelNode3D } from "./types.js";

// --- Quaternion and vector helpers -------------------------------------

const qMul = (a: Quat, b: Quat): Quat => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

function qRotate(q: Quat, v: Vec3): Vec3 {
	const t = scale(cross([q[0], q[1], q[2]], v), 2);
	return add(add(v, scale(t, q[3])), cross([q[0], q[1], q[2]], t));
}

function axisAngle(axis: Vec3, angle: number): Quat {
	const a = norm(axis);
	const s = Math.sin(angle / 2);
	return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

/** Shortest rotation taking direction `a` onto direction `b`. */
function qBetween(a: Vec3, b: Vec3): Quat {
	const u = norm(a);
	const v = norm(b);
	const d = dot(u, v);
	if (d < -0.999999) {
		const ortho =
			Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
		return axisAngle(ortho, Math.PI);
	}
	const c = cross(u, v);
	const q: Quat = [c[0], c[1], c[2], 1 + d];
	const l = Math.hypot(...q);
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

const position = (m: Mat4): Vec3 => [m[12], m[13], m[14]];

// --- Pose assembly -------------------------------------------------------

export interface RigClipLayer {
	clip: AnimationClip3D;
	/** Seconds into the clip. */
	time: number;
	/** 0..1: how far this layer overrides the pose beneath it. */
	weight: number;
	/** Joint names: only these joints and their descendants take this layer. */
	mask?: string[];
}

export interface RigTwoBoneIk {
	/** [root, mid, effector] joint names, e.g. ["UpperLeg.L", "LowerLeg.L", "Foot.L"]. */
	chain: [string, string, string];
	/** Where the effector reaches, model space. */
	target: Vec3;
	/** The mid joint (knee, elbow) bends toward this point, model space. */
	pole?: Vec3;
	weight: number;
}

export interface RigLookAt {
	joint: string;
	target: Vec3;
	weight: number;
	/** Largest turn away from the animated pose, degrees. */
	maxAngleDeg: number;
	/** The joint's local axis that should point at the target. */
	axis: Vec3;
}

export interface RigConstraints {
	ik?: RigTwoBoneIk[];
	lookAt?: RigLookAt[];
}

/** A pose being edited: local TRS plus the matching model-space matrices. */
export class RigPose {
	readonly nodes: ModelNode3D[];
	readonly local: LocalPose;
	private worldCache: Mat4[] | null = null;
	private byName: Map<string, number>;

	constructor(nodes: ModelNode3D[], local: LocalPose) {
		this.nodes = nodes;
		this.local = local;
		this.byName = new Map(nodes.map((n, i) => [n.name, i]));
	}

	index(name: string): number | undefined {
		return this.byName.get(name);
	}

	world(): Mat4[] {
		this.worldCache ??= composeWorld(
			this.nodes,
			localPoseMatrices(this.nodes, this.local),
		);
		return this.worldCache;
	}

	position(i: number): Vec3 {
		return position(this.world()[i]!);
	}

	/** Model-space rotation of node `i` (scale ignored). */
	globalRotation(i: number): Quat {
		let q = this.local.r[i]!;
		for (let p = this.nodes[i]!.parent; p >= 0; p = this.nodes[p]!.parent) {
			q = qMul(this.local.r[p]!, q);
		}
		return q;
	}

	parentRotation(i: number): Quat {
		const p = this.nodes[i]!.parent;
		return p >= 0 ? this.globalRotation(p) : [0, 0, 0, 1];
	}

	/** Call after editing `local` directly. */
	touch(): void {
		this.worldCache = null;
	}

	/** Sets node `i`'s model-space rotation, blended from its current one by `weight`. */
	setGlobalRotation(i: number, q: Quat, weight = 1): void {
		const local = qMul(qConj(this.parentRotation(i)), q);
		this.local.r[i] =
			weight >= 1 ? local : slerp(this.local.r[i]!, local, weight);
		this.worldCache = null;
	}

	/** Every node at or below the named joints. */
	maskSet(names: string[]): Set<number> {
		const roots = new Set(
			names.map((n) => this.byName.get(n)).filter((i) => i !== undefined),
		);
		const out = new Set<number>();
		for (let i = 0; i < this.nodes.length; i++) {
			for (let p = i; p >= 0; p = this.nodes[p]!.parent) {
				if (roots.has(p)) {
					out.add(i);
					break;
				}
			}
		}
		return out;
	}
}

/**
 * The rest pose with each layer blended over the pose beneath it by its
 * weight (translations and scales lerped, rotations slerped), restricted to
 * the layer's mask.
 */
export function blendClipLayers(
	model: Model3DData,
	layers: RigClipLayer[],
): RigPose {
	const nodes = model.nodes ?? [];
	const pose = sampleLocalPose(nodes, undefined, 0);
	const rig = new RigPose(nodes, pose);
	for (const layer of layers) {
		const w = clamp(layer.weight, 0, 1);
		if (w <= 0) continue;
		const lp = sampleLocalPose(nodes, layer.clip, layer.time);
		const mask = layer.mask?.length ? rig.maskSet(layer.mask) : undefined;
		for (let i = 0; i < nodes.length; i++) {
			if (mask && !mask.has(i)) continue;
			const t = pose.t[i]!;
			const s = pose.s[i]!;
			pose.t[i] = add(t, scale(sub(lp.t[i]!, t), w));
			pose.s[i] = add(s, scale(sub(lp.s[i]!, s), w));
			pose.r[i] = slerp(pose.r[i]!, lp.r[i]!, w);
		}
	}
	return rig;
}

/**
 * Analytic two-bone IK (law of cosines; D. Holden's formulation): bends the
 * mid joint to the angle that puts the effector at the target's distance,
 * swings the root onto the target, then twists the chain about the
 * root→target axis so the mid joint faces the pole.
 */
export function solveTwoBoneIk(rig: RigPose, c: RigTwoBoneIk): void {
	const ids = c.chain.map((n) => rig.index(n));
	if (ids.some((i) => i === undefined)) return;
	const [ia, ib, ic] = ids as [number, number, number];
	const w = clamp(c.weight, 0, 1);
	if (w <= 0) return;
	const before: [Quat, Quat] = [rig.local.r[ia]!, rig.local.r[ib]!];
	const a = rig.position(ia);
	const b = rig.position(ib);
	const cc = rig.position(ic);
	const eps = 1e-4;
	const lab = len(sub(b, a));
	const lcb = len(sub(cc, b));
	const lat = clamp(len(sub(c.target, a)), eps, lab + lcb - eps);
	const acos = (v: number) => Math.acos(clamp(v, -1, 1));
	const acAb0 = acos(dot(norm(sub(cc, a)), norm(sub(b, a))));
	const baBc0 = acos(dot(norm(sub(a, b)), norm(sub(cc, b))));
	const acAb1 = acos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat));
	const baBc1 = acos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
	// The bend plane: the current one, or the pole's when the chain is straight.
	let axis0 = cross(sub(cc, a), sub(b, a));
	if (len(axis0) < 1e-6 && c.pole) axis0 = cross(sub(cc, a), sub(c.pole, a));
	if (len(axis0) < 1e-6) axis0 = cross(sub(cc, a), [0, 0, 1]);
	const ga = rig.globalRotation(ia);
	const gb = rig.globalRotation(ib);
	// Both turns about the bend axis; the mid joint also rides the root's.
	const r0 = axisAngle(axis0, acAb1 - acAb0);
	const r1 = axisAngle(axis0, baBc1 - baBc0);
	rig.setGlobalRotation(ia, qMul(r0, ga));
	rig.setGlobalRotation(ib, qMul(r0, qMul(r1, gb)));
	// Swing the whole chain so the effector lands on the target.
	const reach = sub(rig.position(ic), a);
	rig.setGlobalRotation(
		ia,
		qMul(qBetween(reach, sub(c.target, a)), rig.globalRotation(ia)),
	);
	if (c.pole) twistToPole(rig, ia, ib, a, c.target, c.pole);
	if (w < 1) {
		const solved: [Quat, Quat] = [rig.local.r[ia]!, rig.local.r[ib]!];
		rig.local.r[ia] = slerp(before[0], solved[0], w);
		rig.local.r[ib] = slerp(before[1], solved[1], w);
		rig.touch();
	}
}

/** Turns the chain about root→target so the mid joint points toward the pole. */
function twistToPole(
	rig: RigPose,
	ia: number,
	ib: number,
	a: Vec3,
	target: Vec3,
	pole: Vec3,
): void {
	const axis = norm(sub(target, a));
	const flat = (v: Vec3) => sub(v, scale(axis, dot(v, axis)));
	const mid = flat(sub(rig.position(ib), a));
	const want = flat(sub(pole, a));
	if (len(mid) < 1e-6 || len(want) < 1e-6) return;
	const m = norm(mid);
	const p = norm(want);
	const angle = Math.atan2(dot(cross(m, p), axis), dot(m, p));
	rig.setGlobalRotation(
		ia,
		qMul(axisAngle(axis, angle), rig.globalRotation(ia)),
	);
}

/** Turns a joint so its `axis` points at the target, at most `maxAngleDeg`. */
export function solveLookAt(rig: RigPose, c: RigLookAt): void {
	const i = rig.index(c.joint);
	const w = clamp(c.weight, 0, 1);
	if (i === undefined || w <= 0) return;
	const g = rig.globalRotation(i);
	const facing = qRotate(g, c.axis);
	const want = sub(c.target, rig.position(i));
	if (len(want) < 1e-6) return;
	let swing = qBetween(facing, want);
	const angle = 2 * Math.acos(clamp(swing[3], -1, 1));
	const max = (clamp(c.maxAngleDeg, 0, 180) * Math.PI) / 180;
	if (angle > max) {
		const ax: Vec3 = [swing[0], swing[1], swing[2]];
		swing = len(ax) > 1e-9 ? axisAngle(ax, max) : [0, 0, 0, 1];
	}
	rig.setGlobalRotation(i, qMul(swing, g), w);
}

/** Look-at first (a head turns), then IK (limbs reach), in the given order. */
export function applyConstraints(rig: RigPose, c: RigConstraints): void {
	for (const l of c.lookAt ?? []) solveLookAt(rig, l);
	for (const k of c.ik ?? []) solveTwoBoneIk(rig, k);
}

// --- Spring bones ------------------------------------------------------------

export interface RigSpringChain {
	/** Root joints; each chain runs down its first child to the tip. */
	joints: string[];
	/** Pull back toward the animated pose, per second. Default 6. */
	stiffness?: number;
	/** Share of velocity lost per second, 0..1-ish. Default 0.6. */
	damping?: number;
	/** Model-space acceleration, px/s². Default [0, 0, 0]. */
	gravity?: Vec3;
}

interface Chain {
	ids: number[];
	stiffness: number;
	damping: number;
	gravity: Vec3;
	cur: Vec3[];
	prev: Vec3[];
}

/** Each root's chain: the joint, its first child, that one's first child… */
function chainFrom(rig: RigPose, root: number): number[] {
	const ids = [root];
	for (;;) {
		const last = ids[ids.length - 1]!;
		const child = rig.nodes.findIndex((n) => n.parent === last);
		if (child < 0) return ids;
		ids.push(child);
	}
}

/**
 * Verlet springs on joint chains. `step` advances one frame from the
 * animated pose; `apply` turns the chain's joints toward the simulated
 * points. State only moves forward, so callers replay from frame 0.
 */
export class SpringBones {
	private chains: Chain[] = [];
	private started = false;

	constructor(
		rig: RigPose,
		springs: RigSpringChain[],
		private substeps = 4,
	) {
		for (const s of springs) {
			for (const name of s.joints) {
				const root = rig.index(name);
				if (root === undefined) continue;
				const ids = chainFrom(rig, root);
				if (ids.length < 2) continue;
				this.chains.push({
					ids,
					stiffness: s.stiffness ?? 6,
					damping: clamp(s.damping ?? 0.6, 0, 1),
					gravity: s.gravity ?? [0, 0, 0],
					cur: [],
					prev: [],
				});
			}
		}
	}

	/** Advances every chain by `dt` seconds toward the animated `rig`. */
	step(rig: RigPose, dt: number): void {
		for (const c of this.chains) {
			const animated = c.ids.map((i) => rig.position(i));
			if (!this.started) {
				c.cur = animated.map((p) => [...p] as Vec3);
				c.prev = animated.map((p) => [...p] as Vec3);
				continue;
			}
			const h = dt / this.substeps;
			for (let s = 0; s < this.substeps; s++) this.substep(c, animated, h);
		}
		this.started = true;
	}

	private substep(c: Chain, animated: Vec3[], h: number): void {
		c.cur[0] = animated[0]!;
		c.prev[0] = animated[0]!;
		const keep = (1 - c.damping) ** h;
		const pull = Math.min(1, c.stiffness * h);
		for (let k = 1; k < c.ids.length; k++) {
			const parent = c.cur[k - 1]!;
			const rest = len(sub(animated[k]!, animated[k - 1]!));
			// Where the animation puts this point, carried along by the parent.
			const goal = add(parent, sub(animated[k]!, animated[k - 1]!));
			const p = c.cur[k]!;
			let next = add(p, scale(sub(p, c.prev[k]!), keep));
			next = add(next, scale(sub(goal, next), pull));
			next = add(next, scale(c.gravity, h * h));
			const dir = sub(next, parent);
			next = len(dir) > 1e-9 ? add(parent, scale(norm(dir), rest)) : goal;
			c.prev[k] = p;
			c.cur[k] = next;
		}
	}

	/** Rotates each chain joint so its child lies at the simulated point. */
	apply(rig: RigPose): void {
		for (const c of this.chains) {
			for (let k = 0; k + 1 < c.ids.length; k++) {
				const i = c.ids[k]!;
				const from = sub(rig.position(c.ids[k + 1]!), rig.position(i));
				const to = sub(c.cur[k + 1]!, rig.position(i));
				if (len(from) < 1e-9 || len(to) < 1e-9) continue;
				rig.setGlobalRotation(
					i,
					qMul(qBetween(from, to), rig.globalRotation(i)),
				);
			}
		}
	}
}
