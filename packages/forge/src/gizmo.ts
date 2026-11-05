/**
 * A skeleton drawn as octahedral bones, each rigidly skinned to its joint:
 * the classic DCC bone display, for checking a rig's rest pose and its
 * motion before there is a body.
 */
import type { PrimitiveSpec } from "./document.js";
import type { Skeleton, Vec3 } from "./skeleton.js";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const norm = (v: Vec3): Vec3 => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
};

export interface BoneGizmoOptions {
	/** Bone width as a fraction of its length. Default 0.12. */
	width?: number;
}

/**
 * One octahedron per parent → child bone (flat-shaded), weighted fully to
 * the parent joint; skin indices are the skeleton's joint order, as
 * `GltfDocument.addSkeleton` writes them.
 */
export function boneGizmo(
	skeleton: Skeleton,
	options: BoneGizmoOptions = {},
): Required<
	Pick<PrimitiveSpec, "positions" | "normals" | "joints" | "weights">
> {
	const width = options.width ?? 0.12;
	const positions: number[] = [];
	const normals: number[] = [];
	const joints: number[] = [];
	const weights: number[] = [];
	for (const child of skeleton.joints) {
		if (child.parent === undefined) continue;
		const parent = skeleton.joint(child.parent);
		const axis = sub(child.at, parent.at);
		const len = Math.hypot(axis[0], axis[1], axis[2]);
		if (len < 1e-6) continue;
		const d = norm(axis);
		const helper: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		const u = norm(cross(d, helper));
		const v = cross(d, u);
		const r = len * width;
		const ring = [0, 1, 2, 3].map((k): Vec3 => {
			const a = (k * Math.PI) / 2;
			return [
				parent.at[0] +
					d[0] * len * 0.15 +
					(u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
				parent.at[1] +
					d[1] * len * 0.15 +
					(u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
				parent.at[2] +
					d[2] * len * 0.15 +
					(u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
			];
		});
		for (let k = 0; k < 4; k++) {
			const a = ring[k] as Vec3;
			const b = ring[(k + 1) % 4] as Vec3;
			for (const [p, q, s] of [
				[parent.at, b, a],
				[child.at, a, b],
			] as [Vec3, Vec3, Vec3][]) {
				const n = norm(cross(sub(q, p), sub(s, p)));
				for (const pt of [p, q, s]) {
					positions.push(...pt);
					normals.push(...n);
					joints.push(parent.index, 0, 0, 0);
					weights.push(1, 0, 0, 0);
				}
			}
		}
	}
	return { positions, normals, joints, weights };
}
