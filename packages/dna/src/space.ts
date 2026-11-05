/**
 * From a DNA file's space to glTF's. A DNA descriptor names where each of
 * its axes points (`right`, `up`, `front`, …) and its units; glTF is y-up,
 * the character faces +z, and the viewer's right (the character's left) is
 * +x. Joint rotations are Euler angles in the file's order and signs.
 *
 * The Euler convention follows OpenRigLogic's `tdm` (MIT, Epic Games): for
 * the order `xyz`, x turns first, then y, then z (q = qz · qy · qx).
 */
import { type Quat, quatMultiply, type Vec3 } from "@framefields/forge";
import type { AxisDirection, DnaDescriptor, RotationSequence } from "./read.js";

const DIRECTION: Record<AxisDirection, Vec3> = {
	right: [1, 0, 0],
	left: [-1, 0, 0],
	up: [0, 1, 0],
	down: [0, -1, 0],
	front: [0, 0, 1],
	back: [0, 0, -1],
};

/** A change of axes (orthonormal, maybe mirroring) and of units. */
export interface Space {
	/** Columns: where the file's x, y and z go in glTF. */
	axes: [Vec3, Vec3, Vec3];
	/** +1, or -1 when the file is mirrored relative to glTF (left-handed). */
	handedness: 1 | -1;
	/** File translation units to output units. */
	scale: number;
	/** File rotation units to radians. */
	angle: number;
	sequence: RotationSequence;
	sign: [number, number, number];
}

export function spaceOf(d: DnaDescriptor, units: "cm" | "m"): Space {
	const axes = d.coordinateSystem.map((a) => DIRECTION[a]) as [
		Vec3,
		Vec3,
		Vec3,
	];
	const [a, b, c] = axes;
	const det =
		a[0] * (b[1] * c[2] - b[2] * c[1]) -
		a[1] * (b[0] * c[2] - b[2] * c[0]) +
		a[2] * (b[0] * c[1] - b[1] * c[0]);
	if (Math.abs(det) !== 1)
		throw new Error(
			`dna: axes ${d.coordinateSystem.join(", ")} do not span space`,
		);
	const fileCm = d.translationUnit === "m" ? 100 : 1;
	return {
		axes,
		handedness: det > 0 ? 1 : -1,
		scale: units === "m" ? fileCm / 100 : fileCm,
		angle: d.rotationUnit === "degrees" ? Math.PI / 180 : 1,
		sequence: d.rotationSequence,
		sign: d.rotationSign,
	};
}

/** A file direction (normal, axis) in glTF axes. */
export function direction(s: Space, x: number, y: number, z: number): Vec3 {
	const [a, b, c] = s.axes;
	return [
		a[0] * x + b[0] * y + c[0] * z,
		a[1] * x + b[1] * y + c[1] * z,
		a[2] * x + b[2] * y + c[2] * z,
	];
}

/** A file position (or offset) in glTF axes and output units. */
export function point(s: Space, x: number, y: number, z: number): Vec3 {
	const d = direction(s, x, y, z);
	return [d[0] * s.scale, d[1] * s.scale, d[2] * s.scale];
}

const AXIS = { x: 0, y: 1, z: 2 } as const;

/** Euler angles (file units, order and signs) as a quaternion in the file's axes. */
export function eulerQuat(s: Space, x: number, y: number, z: number): Quat {
	const angles = [
		x * s.sign[0] * s.angle,
		y * s.sign[1] * s.angle,
		z * s.sign[2] * s.angle,
	];
	let q: Quat = [0, 0, 0, 1];
	for (const letter of s.sequence) {
		const k = AXIS[letter as keyof typeof AXIS];
		const half = (angles[k] as number) / 2;
		const turn: Quat = [0, 0, 0, Math.cos(half)];
		turn[k] = Math.sin(half);
		// Each later axis turns after the earlier ones.
		q = quatMultiply(turn, q);
	}
	return q;
}

/** A rotation in the file's axes as one in glTF's: the same turn, about the converted axis. */
export function rotation(s: Space, q: Quat): Quat {
	const v = direction(s, q[0], q[1], q[2]);
	// A mirror flips which way a turn about an axis goes.
	return [v[0] * s.handedness, v[1] * s.handedness, v[2] * s.handedness, q[3]];
}
