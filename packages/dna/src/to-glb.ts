/**
 * A DNA character as glTF: its joints at their neutral pose (with rest
 * orientations), and the meshes of one LOD, skinned, with their blend shape
 * targets as named morph targets. Loaded with `Layer.glb`, it then takes
 * `pose`, `aim`, `lookAt`, IK and `morphs` like any character.
 */
import {
	GltfDocument,
	type MaterialRef,
	type MaterialSpec,
	type MorphTargetSpec,
	type NodeRef,
	type Quat,
	quatMultiply,
	quatRotate,
	Skeleton,
	type SkeletonRefs,
	type Vec3,
} from "@framefields/forge";
import { meshRole, roleMaterial } from "./materials.js";
import type { DnaFile, DnaMesh } from "./read.js";
import {
	direction,
	eulerQuat,
	point,
	rotation,
	type Space,
	spaceOf,
} from "./space.js";

export interface DnaToGltfOptions {
	/** Level of detail (0 is the most detailed). Default 0. */
	lod?: number;
	/** Output units. Default "cm", like forge humans. */
	units?: "cm" | "m";
	/** Blend shape targets as morph targets. Default true. */
	blendShapes?: boolean;
	/**
	 * Skin influences kept per vertex: 8 (glTF's two sets, only written
	 * where a vertex has more than four) or 4. Default 8.
	 */
	influences?: 4 | 8;
	/**
	 * Material per mesh, by mesh name (or a function of it, like
	 * `dnaMaterials(…).materials`). Default: the material of the mesh's role
	 * (skin, teeth, eye, eye shell, lashes, …) without textures.
	 */
	materials?:
		| Record<string, MaterialSpec>
		| ((mesh: string) => MaterialSpec | undefined);
	/** Name of the character's root node. Default: the descriptor's name. */
	name?: string;
}

export interface AddedDna {
	rig: SkeletonRefs;
	/** Mesh nodes by DNA mesh name. */
	meshes: Map<string, NodeRef>;
	materials: Map<string, MaterialRef>;
}

/** The DNA character written as a GLB. */
export function dnaToGlb(
	dna: DnaFile,
	options: DnaToGltfOptions = {},
): Uint8Array {
	const doc = new GltfDocument();
	addDna(doc, dna, options);
	return doc.toGlb();
}

/** Writes the DNA character into `doc`: skeleton, then one skinned node per mesh of the LOD. */
export function addDna(
	doc: GltfDocument,
	dna: DnaFile,
	options: DnaToGltfOptions = {},
): AddedDna {
	const space = spaceOf(dna.descriptor, options.units ?? "cm");
	const skeleton = dnaSkeleton(dna, space);
	const rig = doc.addSkeleton(skeleton.skeleton);
	const meshes = new Map<string, NodeRef>();
	const materials = new Map<string, MaterialRef>();
	const geometry = dna.geometry?.meshes;
	if (!geometry) return { rig, meshes, materials };
	for (const m of lodMeshes(dna, options.lod ?? 0)) {
		const mesh = geometry[m];
		if (!mesh)
			throw new Error(`dna: mesh ${m} is listed for the LOD but missing`);
		const name = dna.definition.meshNames[m] ?? `mesh${m}`;
		// Nothing to draw (an empty placeholder mesh).
		if (!mesh.layouts.positions.length || !mesh.faces.length) continue;
		const material = doc.addMaterial({ name, ...materialFor(options, name) });
		materials.set(name, material);
		const primitive = meshPrimitive(
			dna,
			mesh,
			space,
			skeleton.order,
			options.blendShapes !== false,
			options.influences ?? 8,
		);
		meshes.set(
			name,
			doc.addNode({
				name,
				mesh: doc.addMesh({ name, primitives: [{ ...primitive, material }] }),
				skin: rig.skin,
			}),
		);
	}
	return { rig, meshes, materials };
}

function materialFor(options: DnaToGltfOptions, mesh: string): MaterialSpec {
	const m = options.materials;
	const own = typeof m === "function" ? m(mesh) : m?.[mesh];
	return own ?? roleMaterial(meshRole(mesh));
}

/** The meshes a LOD uses. */
export function lodMeshes(dna: DnaFile, lod: number): number[] {
	const map = dna.definition.lodMeshMapping;
	if (lod < 0 || lod >= map.lods.length)
		throw new Error(
			`dna: LOD ${lod} is not in the file (it has ${map.lods.length})`,
		);
	return Array.from(map.indices[map.lods[lod] as number] ?? []);
}

/**
 * The joints at their neutral pose in glTF space, parents first. `order`
 * maps a DNA joint index to its index in the skeleton (and so in the skin).
 */
export function dnaSkeleton(
	dna: DnaFile,
	space: Space,
): { skeleton: Skeleton; order: Int32Array } {
	const def = dna.definition;
	const n = def.jointNames.length;
	const parent = (j: number) => {
		const p = def.jointHierarchy[j] as number;
		return p === j || p >= n ? -1 : p;
	};
	// World transforms in the file's axes, parents first.
	const worldRot: Quat[] = new Array(n);
	const worldPos: Vec3[] = new Array(n);
	const done = new Uint8Array(n);
	const visit = (j: number, depth: number): void => {
		if (done[j]) return;
		if (depth > n) throw new Error("dna: the joint hierarchy has a cycle");
		const p = parent(j);
		if (p >= 0) visit(p, depth + 1);
		const t = def.neutralJointTranslations;
		const r = def.neutralJointRotations;
		const local = eulerQuat(
			space,
			r.xs[j] as number,
			r.ys[j] as number,
			r.zs[j] as number,
		);
		const offset: Vec3 = [
			t.xs[j] as number,
			t.ys[j] as number,
			t.zs[j] as number,
		];
		if (p < 0) {
			worldRot[j] = local;
			worldPos[j] = offset;
		} else {
			worldRot[j] = quatMultiply(worldRot[p] as Quat, local);
			const d = quatRotate(worldRot[p] as Quat, offset);
			const pp = worldPos[p] as Vec3;
			worldPos[j] = [pp[0] + d[0], pp[1] + d[1], pp[2] + d[2]];
		}
		done[j] = 1;
	};
	for (let j = 0; j < n; j++) visit(j, 0);

	// Parents first: a depth-first walk from the roots.
	const children: number[][] = Array.from({ length: n }, () => []);
	const roots: number[] = [];
	for (let j = 0; j < n; j++) {
		const p = parent(j);
		if (p < 0) roots.push(j);
		else (children[p] as number[]).push(j);
	}
	const skeleton = new Skeleton();
	const order = new Int32Array(n).fill(-1);
	let next = 0;
	const stack = [...roots].reverse();
	while (stack.length) {
		const j = stack.pop() as number;
		const p = parent(j);
		const w = worldPos[j] as Vec3;
		skeleton.add(def.jointNames[j] ?? `joint${j}`, {
			at: point(space, w[0], w[1], w[2]),
			orient: rotation(space, worldRot[j] as Quat),
			...(p < 0 ? {} : { parent: def.jointNames[p] ?? `joint${p}` }),
		});
		order[j] = next++;
		for (const c of [...(children[j] as number[])].reverse()) stack.push(c);
	}
	return { skeleton, order };
}

/**
 * One mesh as a glTF primitive: a vertex per layout (position, UV and
 * normal indices), polygons fanned into triangles, the strongest four skin
 * influences per vertex, and blend shape targets spread to every vertex
 * that shares a moved position.
 */
function meshPrimitive(
	dna: DnaFile,
	mesh: DnaMesh,
	space: Space,
	order: Int32Array,
	blendShapes: boolean,
	limit: 4 | 8,
) {
	const L = mesh.layouts.positions.length;
	const positions = new Float32Array(L * 3);
	const normals = new Float32Array(L * 3);
	const uvs = new Float32Array(L * 2);
	for (let v = 0; v < L; v++) {
		const p = mesh.layouts.positions[v] as number;
		const t = mesh.layouts.uvs[v] as number;
		const nn = mesh.layouts.normals[v] as number;
		positions.set(
			point(
				space,
				mesh.positions.xs[p] ?? 0,
				mesh.positions.ys[p] ?? 0,
				mesh.positions.zs[p] ?? 0,
			),
			v * 3,
		);
		const nv = direction(
			space,
			mesh.normals.xs[nn] ?? 0,
			mesh.normals.ys[nn] ?? 0,
			mesh.normals.zs[nn] ?? 1,
		);
		const l = Math.hypot(nv[0], nv[1], nv[2]) || 1;
		normals.set([nv[0] / l, nv[1] / l, nv[2] / l], v * 3);
		// DNA UVs have v up; glTF's v runs down the image.
		uvs[v * 2] = mesh.uvs.us[t] ?? 0;
		uvs[v * 2 + 1] = 1 - (mesh.uvs.vs[t] ?? 0);
	}

	// Mirrored axes or clockwise faces turn the winding around.
	const flip =
		(dna.descriptor.faceWindingOrder === "cw") !== space.handedness < 0;
	const indices: number[] = [];
	for (const face of mesh.faces)
		for (let k = 1; k + 1 < face.length; k++) {
			const a = face[0] as number;
			const b = face[k] as number;
			const c = face[k + 1] as number;
			if (flip) indices.push(a, c, b);
			else indices.push(a, b, c);
		}

	// Each vertex's influences: a joint listed more than once adds up, the
	// strongest `limit` stay. Eight (two glTF sets) only when some vertex has more than four.
	const influences = Array.from({ length: L }, (_, v) => {
		const sw = mesh.skinWeights[mesh.layouts.positions[v] as number];
		const byJoint = new Map<number, number>();
		sw?.weights.forEach((w, i) => {
			const j = order[sw.jointIndices[i] as number] as number;
			if (w > 0 && j >= 0) byJoint.set(j, (byJoint.get(j) ?? 0) + w);
		});
		return [...byJoint].sort((x, y) => y[1] - x[1]).slice(0, limit);
	});
	const size = influences.some((list) => list.length > 4) ? 8 : 4;
	const joints = new Uint16Array(L * size);
	const weights = new Float32Array(L * size);
	influences.forEach((list, v) => {
		// Unweighted: follows the first joint.
		if (!list.length) weights[v * size] = 1;
		const sum = list.reduce((t, [, w]) => t + w, 0) || 1;
		list.forEach(([j, w], k) => {
			joints[v * size + k] = j;
			weights[v * size + k] = w / sum;
		});
	});

	const targets: MorphTargetSpec[] = [];
	if (blendShapes && mesh.blendShapeTargets.length) {
		// Every layout vertex that uses a position.
		const users = new Map<number, number[]>();
		for (let v = 0; v < L; v++) {
			const p = mesh.layouts.positions[v] as number;
			const list = users.get(p);
			if (list) list.push(v);
			else users.set(p, [v]);
		}
		const names = dna.definition.blendShapeChannelNames;
		const seen = new Set<string>();
		for (const target of mesh.blendShapeTargets) {
			let name = names[target.channel] ?? `channel${target.channel}`;
			// Morph target names must be unique within a mesh.
			if (seen.has(name)) name = `${name}_${target.channel}`;
			seen.add(name);
			const deltas = new Float32Array(L * 3);
			for (let i = 0; i < target.vertexIndices.length; i++) {
				const d = point(
					space,
					target.deltas.xs[i] ?? 0,
					target.deltas.ys[i] ?? 0,
					target.deltas.zs[i] ?? 0,
				);
				for (const v of users.get(target.vertexIndices[i] as number) ?? [])
					deltas.set(d, v * 3);
			}
			targets.push({ name, positions: deltas });
		}
	}
	return {
		positions,
		normals,
		uvs,
		indices,
		joints,
		weights,
		...(targets.length ? { targets } : {}),
	};
}
