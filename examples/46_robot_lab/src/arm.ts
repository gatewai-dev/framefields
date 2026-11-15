/**
 * The arm every scenario shares, built for Steel: six axes and a parallel
 * gripper standing on the floor (meters, z up, facing +x), driven by joint
 * targets, and its inverse kinematics for a hand pointing straight down.
 * Objects are held the way a real gripper holds them: by the fingers'
 * squeeze and friction.
 */
import type { SteelSceneBuilder } from "framefields";

/** Shoulder pivot above the floor, upper arm, forearm, wrist to fingertips (m). */
export const ARM = { shoulder: 0.2, upper: 0.36, fore: 0.32, hand: 0.15 };
/** How far the fingertips reach below the hand's origin, m. */
export const FINGERTIPS = 0.106;
/** Finger travel: open, and closed past touching (the squeeze). */
export const OPEN = 0.03;
export const CLOSED = -0.02;

/** Joints the page drives, in order: five axes and the gripper. */
export const JOINTS = [
	{ name: "yaw", label: "Base", min: -3.1, max: 3.1 },
	{ name: "shoulder", label: "Shoulder", min: -1.7, max: 1.7 },
	{ name: "elbow", label: "Elbow", min: -2.5, max: 2.5 },
	{ name: "wrist", label: "Wrist", min: -2, max: 2 },
	{ name: "roll", label: "Roll", min: -3.1, max: 3.1 },
	{ name: "grip", label: "Gripper", min: CLOSED, max: OPEN },
] as const;

/**
 * Shoulder, elbow and wrist angles that put the fingertips `reach` m out
 * and `height` m above the floor with the hand pointing down, elbow up.
 */
export function reachDown(reach: number, height: number): number[] {
	const wz = height + ARM.hand - ARM.shoulder;
	const d = Math.min(Math.hypot(reach, wz), ARM.upper + ARM.fore - 1e-6);
	const cos =
		(d * d - ARM.upper ** 2 - ARM.fore ** 2) / (2 * ARM.upper * ARM.fore);
	const elbow = Math.acos(Math.max(-1, Math.min(1, cos)));
	const shoulder =
		Math.atan2(reach, wz) -
		Math.atan2(
			ARM.fore * Math.sin(elbow),
			ARM.upper + ARM.fore * Math.cos(elbow),
		);
	return [shoulder, elbow, Math.PI - shoulder - elbow];
}

/** Joint targets of the rest pose (`JOINTS` order): the hand 0.38 m out, 0.35 m up. */
export const HOME = [0, ...reachDown(0.38, 0.35), 0, OPEN];

/** A CSS hex color as Steel's 0–1 RGB. */
export const rgb = (hex: string): [number, number, number] => [
	Number.parseInt(hex.slice(1, 3), 16) / 255,
	Number.parseInt(hex.slice(3, 5), 16) / 255,
	Number.parseInt(hex.slice(5, 7), 16) / 255,
];

export const WHITE = "#f2f2f0";
export const DARK = "#2a2d33";

type Pose = [number, number, number, number, number, number, number];
const at = (x: number, y: number, z: number): Pose => [x, y, z, 0, 0, 0, 1];
/** Local z (capsule and cylinder axes) turned onto y. */
const ALONG_Y: Pose = [0, 0, 0, -Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/** Body labels of the arm, the ones the page names. */
export const FINGERS = ["finger_l", "finger_r"] as const;

/**
 * Adds the arm standing at the origin, its joints at `HOME`. Returns the
 * shapes the scenario may want to tell apart (the fingers).
 */
export function addArm(scene: SteelSceneBuilder): void {
	const white = { color: rgb(WHITE), mu: 0.8 };
	const dark = { color: rgb(DARK), mu: 0.8 };
	const drive = (ke: number, kd: number, limit: number, effort: number) => ({
		targetKe: ke,
		targetKd: kd,
		limitLower: -limit,
		limitUpper: limit,
		armature: 0.05,
		effortLimit: effort,
	});
	// The base is part of the floor.
	const base = scene.addShapeCylinder(-1, {
		radius: 0.1,
		halfHeight: 0.03,
		xform: at(0, 0, 0.03),
		...dark,
	});

	const turret = scene.addBody({ xform: at(0, 0, 0.06), label: "turret" });
	const turretShape = scene.addShapeCylinder(turret, {
		radius: 0.07,
		halfHeight: 0.06,
		xform: at(0, 0, 0.06),
		...white,
	});
	scene.addCollisionFilter(base, turretShape);
	scene.addJointRevolute(-1, turret, {
		axis: [0, 0, 1],
		parentXform: at(0, 0, 0.06),
		...drive(3000, 200, 3.1, 300),
		q: HOME[0],
		label: "yaw",
	});

	const upper = scene.addBody({ xform: at(0, 0, 0.2), label: "upper" });
	scene.addShapeCylinder(upper, {
		radius: 0.058,
		halfHeight: 0.065,
		xform: ALONG_Y,
		...white,
	});
	scene.addShapeCapsule(upper, {
		radius: 0.045,
		halfHeight: ARM.upper / 2,
		xform: at(0, 0, ARM.upper / 2),
		...white,
	});
	scene.addJointRevolute(turret, upper, {
		axis: [0, 1, 0],
		parentXform: at(0, 0, 0.14),
		...drive(4000, 250, 1.7, 400),
		q: HOME[1],
		label: "shoulder",
	});

	const fore = scene.addBody({
		xform: at(0, 0, 0.2 + ARM.upper),
		label: "fore",
	});
	scene.addShapeCylinder(fore, {
		radius: 0.05,
		halfHeight: 0.055,
		xform: ALONG_Y,
		...white,
	});
	scene.addShapeCapsule(fore, {
		radius: 0.037,
		halfHeight: ARM.fore / 2,
		xform: at(0, 0, ARM.fore / 2),
		...white,
	});
	scene.addJointRevolute(upper, fore, {
		axis: [0, 1, 0],
		parentXform: at(0, 0, ARM.upper),
		...drive(3000, 200, 2.5, 300),
		q: HOME[2],
		label: "elbow",
	});

	const wristZ = 0.2 + ARM.upper + ARM.fore;
	const wrist = scene.addBody({ xform: at(0, 0, wristZ), label: "wrist" });
	scene.addShapeCylinder(wrist, {
		radius: 0.042,
		halfHeight: 0.04,
		xform: ALONG_Y,
		...white,
	});
	scene.addJointRevolute(fore, wrist, {
		axis: [0, 1, 0],
		parentXform: at(0, 0, ARM.fore),
		...drive(1500, 100, 2, 150),
		q: HOME[3],
		label: "wrist",
	});

	const hand = scene.addBody({ xform: at(0, 0, wristZ + 0.04), label: "hand" });
	scene.addShapeBox(hand, {
		hx: 0.032,
		hy: 0.058,
		hz: 0.02,
		xform: at(0, 0, 0.02),
		...white,
	});
	scene.addJointRevolute(wrist, hand, {
		axis: [0, 0, 1],
		parentXform: at(0, 0, 0.04),
		...drive(600, 40, 3.1, 60),
		q: HOME[4],
		label: "roll",
	});

	const fingerShapes = FINGERS.map((name, k) => {
		const side = k === 0 ? 1 : -1;
		const finger = scene.addBody({
			xform: at(0, side * 0.03, wristZ + 0.04 + 0.036),
			label: name,
		});
		const shape = scene.addShapeBox(finger, {
			hx: 0.012,
			hy: 0.007,
			hz: 0.035,
			xform: at(0, 0, 0.035),
			color: rgb(DARK),
			mu: 1.5,
		});
		scene.addJointPrismatic(hand, finger, {
			axis: [0, side, 0],
			parentXform: at(0, side * 0.03, 0.036),
			targetKe: 1500,
			targetKd: 60,
			limitLower: CLOSED,
			limitUpper: OPEN,
			effortLimit: 40,
			q: OPEN,
			label: name,
		});
		return shape;
	});
	scene.addCollisionFilter(fingerShapes[0], fingerShapes[1]);
}

/** Sets every joint's target from page order (the gripper drives both fingers). */
export function driveArm(
	targets: readonly number[],
	set: (joint: string, position: number) => void,
): void {
	JOINTS.forEach((j, i) => {
		if (j.name === "grip") for (const f of FINGERS) set(f, targets[i]);
		else set(j.name, targets[i]);
	});
}
