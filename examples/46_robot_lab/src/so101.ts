/**
 * The SO-101 arm (TheRobotStudio's SO-ARM100, `Simulation/SO101`), loaded
 * from its MJCF into Steel: five axes and a jaw, servo-driven by joint
 * targets, standing at the origin facing +x (meters, z up). Its inverse
 * kinematics point the jaws straight down at a point, from the MJCF's own
 * kinematic chain. Objects are held the way the real gripper holds them:
 * the moving jaw squeezes them against the fixed one.
 *
 * The model files are not shipped: put the `Simulation/SO101` folder at
 * `scratch/so101` in the repository (the envs' tests read it there too).
 */
import { readFile } from "node:fs/promises";
import type { SteelLoaders, SteelSceneBuilder } from "framefields";

/** The model's folder; the preview serves it to the page by its path. */
export const MODEL = new URL("../../../scratch/so101/", import.meta.url);

/** Jaw angle, rad: open, and closed past touching (the squeeze). */
export const OPEN = 1.1;
export const CLOSED = -0.17;

/** Joints the page drives, in order (their MJCF names and actuator ranges). */
export const JOINTS = [
	{ name: "shoulder_pan", label: "Pan", min: -1.92, max: 1.92 },
	{ name: "shoulder_lift", label: "Shoulder", min: -1.74, max: 1.74 },
	{ name: "elbow_flex", label: "Elbow", min: -1.69, max: 1.69 },
	{ name: "wrist_flex", label: "Wrist", min: -1.65, max: 1.65 },
	{ name: "wrist_roll", label: "Roll", min: -2.74, max: 2.84 },
	{ name: "gripper", label: "Gripper", min: CLOSED, max: 1.74 },
] as const;

/**
 * The jaws' colliders. A mesh collides as its convex hull, and the fixed
 * jaw is one mesh with the gripper's housing, so its hull fills the gap
 * between the jaws. As MuJoCo Menagerie's SO-ARM100 does, each finger
 * collides as a box instead (sizes from the meshes, in the bodies' frames).
 */
const JAW_PADS: Record<string, string> = {
	wrist_roll_follower_so101_v1:
		'<geom type="box" class="collision" pos="-0.017 0 -0.082" size="0.007 0.008 0.021"/>',
	moving_jaw_so101_v1:
		'<geom type="box" class="collision" pos="-0.004 -0.061 0.019" size="0.008 0.021 0.009"/>',
};

/** The model with its jaw meshes' colliders swapped for `JAW_PADS`. */
export function withJawPads(xml: string): string {
	let swapped = 0;
	const out = xml.replace(
		/<geom type="mesh" class="collision"[^>]*mesh="(\w+)"[^>]*\/>/g,
		(geom, mesh: string) => {
			const pad = JAW_PADS[mesh];
			if (!pad) return geom;
			swapped++;
			return pad;
		},
	);
	if (swapped !== Object.keys(JAW_PADS).length)
		throw new Error("so101: the MJCF's jaw colliders were not found");
	return out;
}

/** Adds the arm from its MJCF, welded to the floor at the origin. */
export async function addSo101(
	scene: SteelSceneBuilder,
	load: SteelLoaders,
): Promise<void> {
	const xml = await readFile(new URL("so101_new_calib.xml", MODEL), "utf8");
	await load.mjcf(scene, withJawPads(xml), { baseUrl: MODEL.href });
}

/** Sets every joint's target, in `JOINTS` order. */
export function driveArm(
	targets: readonly number[],
	set: (joint: string, position: number) => void,
): void {
	JOINTS.forEach((j, i) => {
		set(j.name, targets[i]);
	});
}

// ---------------------------------------------------------------------------
// Kinematics: the MJCF's chain from the base to the gripper.
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
/** Quaternion w, x, y, z (MuJoCo's order). */
type Q = [number, number, number, number];

/** Each body's offset from its parent and its joint (about its own z). */
const CHAIN: { p: V3; q: Q }[] = [
	{ p: [0.0388353, 0, 0.0624], q: [0, 0, -1, 0] },
	{ p: [-0.0303992, -0.0182778, -0.0542], q: [0.5, -0.5, -0.5, -0.5] },
	{ p: [-0.11257, -0.028, 0], q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] },
	{ p: [-0.1349, 0.0052, 0], q: [Math.SQRT1_2, 0, 0, -Math.SQRT1_2] },
	{ p: [0, -0.0611, 0.0181], q: [0.0172091, -0.0172091, 0.706897, 0.706897] },
];
/**
 * The point the IK places, in the gripper's frame: the center of a 3 cm
 * cube held between the open jaws, 8 mm off the fixed finger's inner face
 * (x = -0.010; the descent eases in joint space, so the tip does not travel
 * straight down) and 11 mm up from the fingertips (z = -0.104), so they stay
 * 4 mm off the floor under a cube resting on it. The jaws close along the
 * gripper's x and reach out along its -z, which is also the roll axis.
 */
const TIP: V3 = [0.013, 0, -0.093];

const qmul = (a: Q, b: Q): Q => [
	a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
	a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
	a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
	a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const rotate = (q: Q, v: V3): V3 => {
	const r = qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]);
	return [r[1], r[2], r[3]];
};
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The gripper's pose for the first five joint angles: the tip and its x and z axes. */
export function forward(q: readonly number[]): { tip: V3; x: V3; z: V3 } {
	let p: V3 = [0, 0, 0];
	let r: Q = [1, 0, 0, 0];
	CHAIN.forEach((link, i) => {
		p = add(p, rotate(r, link.p));
		const h = q[i] / 2;
		r = qmul(qmul(r, link.q), [Math.cos(h), 0, 0, Math.sin(h)]);
	});
	return {
		tip: add(p, rotate(r, TIP)),
		x: rotate(r, [1, 0, 0]),
		z: rotate(r, [0, 0, 1]),
	};
}

/** Wraps `a` into [-period/2, period/2). */
export const wrap = (a: number, period: number) =>
	a - period * Math.floor(a / period + 0.5);

const clampTo = (v: number, i: number) =>
	Math.max(JOINTS[i].min, Math.min(JOINTS[i].max, v));

/**
 * The residual of the four arm joints (pan, shoulder, elbow, wrist) at a
 * given roll, for a tip at `at` pointing straight down: the tip's error and,
 * scaled to a length, how far the reach axis (the gripper's -z) is from down.
 */
function residual(q: number[], roll: number, at: V3): number[] {
	const f = forward([...q, roll]);
	const lever = 0.01;
	return [
		f.tip[0] - at[0],
		f.tip[1] - at[1],
		f.tip[2] - at[2],
		lever * f.z[0],
		lever * f.z[1],
		lever * (f.z[2] - 1),
	];
}

/** Solves `A x = b` for a small square system (Gaussian elimination). */
function solve(a: number[][], b: number[]): number[] {
	const n = b.length;
	const m = a.map((row, i) => [...row, b[i]]);
	for (let c = 0; c < n; c++) {
		let p = c;
		for (let r = c + 1; r < n; r++)
			if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
		[m[c], m[p]] = [m[p], m[c]];
		for (let r = c + 1; r < n; r++) {
			const k = m[r][c] / m[c][c];
			for (let j = c; j <= n; j++) m[r][j] -= k * m[c][j];
		}
	}
	const x = new Array<number>(n).fill(0);
	for (let r = n - 1; r >= 0; r--) {
		let s = m[r][n];
		for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
		x[r] = s / m[r][r];
	}
	return x;
}

/** One damped least-squares step on the joints in `free`: (JᵀJ + λI) Δ = -Jᵀ r. */
function dls(jac: number[][], r: number[], free: number[]): number[] {
	const dot = (a: number[], b: number[]) =>
		a.reduce((s, v, k) => s + v * b[k], 0);
	const jtj = free.map((a) =>
		free.map((b) => dot(jac[a], jac[b]) + (a === b ? 1e-6 : 0)),
	);
	const step = new Array<number>(jac.length).fill(0);
	solve(
		jtj,
		free.map((a) => -dot(jac[a], r)),
	).forEach((v, i) => {
		step[free[i]] = v;
	});
	return step;
}

/**
 * Damped least squares from `q` on the four arm joints, within their
 * ranges: a joint at its limit that a step would push past sits that step
 * out, so the others take up its share.
 */
function descend(q: number[], roll: number, at: V3): number {
	const h = 1e-6;
	for (let it = 0; it < 100; it++) {
		const r = residual(q, roll, at);
		const jac = q.map((_, j) => {
			const dq = [...q];
			dq[j] += h;
			return residual(dq, roll, at).map((v, k) => (v - r[k]) / h);
		});
		let free = q.map((_, j) => j);
		let step = dls(jac, r, free);
		const pinned = (j: number) =>
			(q[j] <= JOINTS[j].min && step[j] < 0) ||
			(q[j] >= JOINTS[j].max && step[j] > 0);
		if (free.some(pinned)) {
			free = free.filter((j) => !pinned(j));
			step = dls(jac, r, free);
		}
		for (let j = 0; j < q.length; j++) q[j] = clampTo(q[j] + step[j], j);
		if (Math.hypot(...step) < 1e-9) break;
	}
	return Math.hypot(...residual(q, roll, at));
}

/** Starts the IK climbs from (shoulder, elbow, wrist); the best result wins. */
const SEEDS = [
	[-0.6, 0.6, 1.4],
	[0.3, 0, 1.3],
	[-1.2, 1.2, 1],
];

/**
 * Joint angles (pan, shoulder, elbow, wrist, roll) that put the tip at `at`
 * with the jaws pointing down and closing along `axis` (rad about the
 * vertical, modulo `period`: a cube grips the same every quarter turn).
 * The tip is off the roll axis, so roll is solved with the arm: a few
 * rounds of the arm's least squares, each at the roll the last one asked.
 */
export function reachDown(at: V3, axis = 0, period = Math.PI): number[] {
	let best = { q: [0, ...SEEDS[0]], roll: 0, error: Number.POSITIVE_INFINITY };
	for (const seed of SEEDS) {
		const q = [-Math.atan2(at[1], at[0]), ...seed];
		let roll = 0;
		let error = 0;
		for (let round = 0; round < 4; round++) {
			error = descend(q, roll, at);
			const x = forward([...q, roll]).x;
			roll = clampTo(wrap(roll + axis - Math.atan2(x[1], x[0]), period), 4);
		}
		error = descend(q, roll, at);
		if (error < best.error) best = { q, roll, error };
	}
	return [...best.q, best.roll];
}

/** Joint targets of the rest pose (`JOINTS` order): the jaws open 20 cm out, 12 cm up. */
export const HOME = [...reachDown([0.2, 0, 0.12]), OPEN];

/** A CSS hex color as Steel's 0–1 RGB. */
export const rgb = (hex: string): V3 => [
	Number.parseInt(hex.slice(1, 3), 16) / 255,
	Number.parseInt(hex.slice(3, 5), 16) / 255,
	Number.parseInt(hex.slice(5, 7), 16) / 255,
];
