/**
 * MuJoCo flexes (cloth, soft bodies) as the engine draws them: a skinned
 * mesh with one joint per flex vertex. Each frame the joints move to where
 * the simulation put the vertices and turn so the surface's normal follows
 * the fold, so skinning, shadows, motion vectors and ground truth come from
 * the same path as any skinned model.
 */
import type {
	Material3D,
	Mesh3DData,
	Model3DData,
} from "@framefields/webgpu-renderers";
import { finalizeModel3DData } from "@framefields/webgpu-renderers";

/** The slice of the model a flex is read from. */
export interface FlexModel {
	nflex: number;
	flex_dim: Int32Array;
	flex_vertadr: Int32Array;
	flex_vertnum: Int32Array;
	flex_elemadr: Int32Array;
	flex_elemnum: Int32Array;
	flex_elemdataadr: Int32Array;
	flex_elem: Int32Array;
	flex_shellnum: Int32Array;
	flex_shelldataadr: Int32Array;
	flex_shell: Int32Array;
	flex_rgba: Float32Array;
	flex_group: Int32Array;
	name_flexadr: Int32Array;
}

/** A flex that draws as a surface. */
export interface FlexInfo {
	name: string;
	/** 1 cable, 2 cloth, 3 soft solid. */
	dim: number;
	/** First vertex in `flexvert_xpos`, and how many. */
	vertadr: number;
	vertnum: number;
	/** Its surface: three flex-local vertex indices per triangle (none for cables). */
	triangles: Uint32Array;
	rgba: [number, number, number, number];
	group: number;
}

/** The model's flexes; a cloth's surface is its elements, a solid's its shell. */
export function flexInfos(
	model: FlexModel,
	nameAt: (adr: number) => string,
): FlexInfo[] {
	return Array.from({ length: model.nflex }, (_, f) => {
		const dim = model.flex_dim[f];
		const triangles =
			dim === 2
				? model.flex_elem.slice(
						model.flex_elemdataadr[f],
						model.flex_elemdataadr[f] + 3 * model.flex_elemnum[f],
					)
				: dim === 3
					? model.flex_shell.slice(
							model.flex_shelldataadr[f],
							model.flex_shelldataadr[f] + 3 * model.flex_shellnum[f],
						)
					: new Int32Array(0);
		const [r, g, b, a] = model.flex_rgba.subarray(f * 4, f * 4 + 4);
		return {
			name: nameAt(model.name_flexadr[f]) || `flex${f}`,
			dim,
			vertadr: model.flex_vertadr[f],
			vertnum: model.flex_vertnum[f],
			triangles: Uint32Array.from(triangles),
			rgba: [r, g, b, a],
			group: model.flex_group[f],
		};
	});
}

/** Area-weighted vertex normals of a triangle mesh (positions xyz per vertex). */
export function vertexNormals(
	positions: ArrayLike<number>,
	triangles: Uint32Array,
): Float32Array {
	const n = new Float32Array(positions.length);
	for (let t = 0; t < triangles.length; t += 3) {
		const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
		const e1 = [0, 1, 2].map(
			(k) => positions[b * 3 + k] - positions[a * 3 + k],
		);
		const e2 = [0, 1, 2].map(
			(k) => positions[c * 3 + k] - positions[a * 3 + k],
		);
		const cross = [
			e1[1] * e2[2] - e1[2] * e2[1],
			e1[2] * e2[0] - e1[0] * e2[2],
			e1[0] * e2[1] - e1[1] * e2[0],
		];
		for (const v of [a, b, c])
			for (let k = 0; k < 3; k++) n[v * 3 + k] += cross[k];
	}
	for (let v = 0; v < n.length; v += 3) {
		const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
		n[v] /= l;
		n[v + 1] /= l;
		n[v + 2] /= l;
	}
	return n;
}

/**
 * The turn taking unit vector `from` onto `to`, as Euler degrees applied Z,
 * then Y, then X (R = Rz · Ry · Rx, how joint poses read them).
 */
export function turnEuler(
	from: ArrayLike<number>,
	to: ArrayLike<number>,
): [number, number, number] {
	const [ax, ay, az] = [from[0], from[1], from[2]];
	const [bx, by, bz] = [to[0], to[1], to[2]];
	// Rotation about from × to by the angle between them (Rodrigues).
	let [kx, ky, kz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
	const s = Math.hypot(kx, ky, kz);
	const c = ax * bx + ay * by + az * bz;
	if (s < 1e-9) {
		if (c > 0) return [0, 0, 0];
		// Turned over: half a turn about any axis across `from`.
		[kx, ky, kz] = Math.abs(ax) < 0.9 ? [0, az, -ay] : [-az, 0, ax];
		const l = Math.hypot(kx, ky, kz);
		[kx, ky, kz] = [kx / l, ky / l, kz / l];
	} else [kx, ky, kz] = [kx / s, ky / s, kz / s];
	const angle = Math.atan2(s, c);
	const [sn, cs] = [Math.sin(angle), Math.cos(angle)];
	const t = 1 - cs;
	const r20 = t * kz * kx - sn * ky;
	const r21 = t * kz * ky + sn * kx;
	const r22 = t * kz * kz + cs;
	const r10 = t * ky * kx + sn * kz;
	const r00 = t * kx * kx + cs;
	const deg = 180 / Math.PI;
	return [
		Math.atan2(r21, r22) * deg,
		Math.asin(Math.max(-1, Math.min(1, -r20))) * deg,
		Math.atan2(r10, r00) * deg,
	];
}

/** The joint name of flex vertex `k`. */
export const flexJoint = (k: number) => `v${k}`;

/**
 * A flex as a skinned model: its surface at `rest` (scene px, xyz per
 * vertex), each vertex bound wholly to its own joint at that vertex.
 */
export function flexModel(
	name: string,
	rest: Float32Array,
	triangles: Uint32Array,
	rgba: [number, number, number, number],
): Model3DData {
	const count = rest.length / 3;
	const mesh: Mesh3DData = {
		name,
		positions: rest,
		normals: vertexNormals(rest, triangles),
		uvs: new Float32Array(count * 2),
		indices: triangles,
		jointIndices: Float32Array.from({ length: count * 4 }, (_, i) =>
			i % 4 === 0 ? i / 4 : 0,
		),
		jointWeights: Float32Array.from({ length: count * 4 }, (_, i) =>
			i % 4 === 0 ? 1 : 0,
		),
		skin: 0,
		node: 0,
		materialName: `${name}-material`,
	};
	const material: Material3D = {
		name: `${name}-material`,
		diffuseColor: rgba,
		shading: "lit",
		twoSided: true,
	};
	const model = finalizeModel3DData(name, [mesh], {
		[material.name]: material,
	});
	const inverseBind = new Float32Array(count * 16);
	for (let k = 0; k < count; k++) {
		// Translation by -rest: a vertex sits at its joint's origin.
		const m = inverseBind.subarray(k * 16, k * 16 + 16);
		m[0] = m[5] = m[10] = m[15] = 1;
		m[12] = -rest[k * 3];
		m[13] = -rest[k * 3 + 1];
		m[14] = -rest[k * 3 + 2];
	}
	return {
		...model,
		nodes: [
			{
				name: "root",
				parent: -1,
				translation: [0, 0, 0],
				rotation: [0, 0, 0, 1],
				scale: [1, 1, 1],
			},
			...Array.from({ length: count }, (_, k) => ({
				name: flexJoint(k),
				parent: 0,
				translation: [rest[k * 3], rest[k * 3 + 1], rest[k * 3 + 2]] as [
					number,
					number,
					number,
				],
				rotation: [0, 0, 0, 1] as [number, number, number, number],
				scale: [1, 1, 1] as [number, number, number],
			})),
		],
		skins: [
			{
				joints: Array.from({ length: count }, (_, k) => k + 1),
				inverseBindMatrices: inverseBind,
			},
		],
	};
}
