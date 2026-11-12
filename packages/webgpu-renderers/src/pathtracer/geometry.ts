/**
 * Triangle records and bottom-level BVHs for the path tracer: a mesh's
 * triangles in object space, stored in BVH leaf order, with what shading
 * reads at a hit (vertex normals, UVs and colors) packed alongside.
 */
import { denseMorphDeltas, type Mesh3DData } from "../loaders/types.js";
import {
	buildBinnedSahBvh,
	bvhCost,
	type FlatBvh,
	flattenBvh,
	refitBvh,
} from "./bvh.js";

/**
 * Floats per triangle record, 7 vec4:
 *  0..2: p0, p1, p2 (xyz), w = uv0.x, uv0.y, uv1.x
 *  3..5: n0, n1, n2 (xyz), w = uv1.y, uv2.x, uv2.y
 *  6:    vertex colors c0, c1, c2 (rgba8 unorm, display space), w = unused
 */
export const TRIANGLE_FLOATS = 28;

/** Vertex positions and normals of one pose of a mesh. */
export interface MeshPose {
	positions: Float32Array;
	normals: Float32Array;
}

function packColor(colors: Float32Array | undefined, v: number): number {
	if (!colors) return 0xffffffff;
	let word = 0;
	for (let k = 0; k < 4; k++) {
		const c = Math.round(Math.min(1, Math.max(0, colors[v * 4 + k])) * 255);
		word |= c << (k * 8);
	}
	return word >>> 0;
}

function triangleCount(mesh: Mesh3DData): number {
	if (mesh.topology && mesh.topology !== "triangle-list") return 0;
	return mesh.indices.length
		? Math.floor(mesh.indices.length / 3)
		: Math.floor(mesh.positions.length / 9);
}

function vertexIndex(mesh: Mesh3DData, t: number, corner: number): number {
	return mesh.indices.length ? mesh.indices[t * 3 + corner] : t * 3 + corner;
}

/** Object-space box of every triangle (min, max). */
function triangleBoxes(
	mesh: Mesh3DData,
	pose: MeshPose,
	order: Uint32Array | null,
	count: number,
): Float32Array {
	const boxes = new Float32Array(count * 6);
	for (let slot = 0; slot < count; slot++) {
		const t = order ? order[slot] : slot;
		for (let k = 0; k < 3; k++) {
			boxes[slot * 6 + k] = Number.POSITIVE_INFINITY;
			boxes[slot * 6 + 3 + k] = Number.NEGATIVE_INFINITY;
		}
		for (let c = 0; c < 3; c++) {
			const v = vertexIndex(mesh, t, c);
			for (let k = 0; k < 3; k++) {
				const p = pose.positions[v * 3 + k];
				boxes[slot * 6 + k] = Math.min(boxes[slot * 6 + k], p);
				boxes[slot * 6 + 3 + k] = Math.max(boxes[slot * 6 + 3 + k], p);
			}
		}
	}
	return boxes;
}

function writeRecords(
	mesh: Mesh3DData,
	pose: MeshPose,
	order: Uint32Array,
	out: Float32Array,
): void {
	const words = new Uint32Array(out.buffer, out.byteOffset, out.length);
	const uvs = mesh.uvs;
	for (let slot = 0; slot < order.length; slot++) {
		const t = order[slot];
		const o = slot * TRIANGLE_FLOATS;
		const uv: number[] = [];
		for (let c = 0; c < 3; c++) {
			const v = vertexIndex(mesh, t, c);
			out[o + c * 4] = pose.positions[v * 3];
			out[o + c * 4 + 1] = pose.positions[v * 3 + 1];
			out[o + c * 4 + 2] = pose.positions[v * 3 + 2];
			out[o + 12 + c * 4] = pose.normals[v * 3] ?? 0;
			out[o + 12 + c * 4 + 1] = pose.normals[v * 3 + 1] ?? 0;
			out[o + 12 + c * 4 + 2] = pose.normals[v * 3 + 2] ?? 0;
			uv.push(uvs[v * 2] ?? 0, uvs[v * 2 + 1] ?? 0);
			words[o + 24 + c] = packColor(mesh.colors, v);
		}
		out[o + 3] = uv[0];
		out[o + 7] = uv[1];
		out[o + 11] = uv[2];
		out[o + 15] = uv[3];
		out[o + 19] = uv[4];
		out[o + 23] = uv[5];
		words[o + 27] = 0;
	}
}

/**
 * A mesh's bottom-level BVH and triangle records. Deforming meshes refit in
 * place each frame and rebuild once refits have doubled the tree's cost.
 */
export class Blas {
	readonly triangleCount: number;
	flat: FlatBvh;
	records: Float32Array;
	/** Bumped whenever nodes or records change, so the GPU copy re-uploads. */
	version = 0;
	private builtCost: number;

	constructor(
		readonly mesh: Mesh3DData,
		pose: MeshPose = mesh,
	) {
		this.triangleCount = triangleCount(mesh);
		this.flat = this.build(pose);
		this.records = new Float32Array(
			Math.max(1, this.triangleCount) * TRIANGLE_FLOATS,
		);
		writeRecords(mesh, pose, this.flat.primOrder, this.records);
		this.builtCost = bvhCost(this.flat);
	}

	private build(pose: MeshPose): FlatBvh {
		const boxes = triangleBoxes(this.mesh, pose, null, this.triangleCount);
		return flattenBvh(buildBinnedSahBvh(boxes, this.triangleCount));
	}

	/** Moves the triangles to a new pose of the same mesh. */
	update(pose: MeshPose): void {
		const boxes = triangleBoxes(
			this.mesh,
			pose,
			this.flat.primOrder,
			this.triangleCount,
		);
		refitBvh(this.flat, boxes);
		if (bvhCost(this.flat) > this.builtCost * 2) {
			this.flat = this.build(pose);
			this.builtCost = bvhCost(this.flat);
		}
		writeRecords(this.mesh, pose, this.flat.primOrder, this.records);
		this.version++;
	}
}

function addMorphs(mesh: Mesh3DData, weights: number[], pose: MeshPose): void {
	const vertexCount = mesh.positions.length / 3;
	mesh.morphTargets?.forEach((target, i) => {
		const w = weights[i] ?? 0;
		if (w === 0) return;
		const dp = denseMorphDeltas(target, vertexCount, "positions");
		const dn = target.normals
			? denseMorphDeltas(target, vertexCount, "normals")
			: null;
		for (let j = 0; j < vertexCount * 3; j++) {
			pose.positions[j] += dp[j] * w;
			if (dn) pose.normals[j] += dn[j] * w;
		}
	});
}

function skinVertex(
	mesh: Mesh3DData,
	joints: Float32Array,
	v: number,
	source: MeshPose,
	out: MeshPose,
): void {
	const m = new Float64Array(16);
	let total = 0;
	const sets: [Float32Array | undefined, Float32Array | undefined][] = [
		[mesh.jointIndices, mesh.jointWeights],
		[mesh.jointIndices1, mesh.jointWeights1],
	];
	for (const [indices, weights] of sets) {
		if (!indices || !weights) continue;
		for (let k = 0; k < 4; k++) {
			const w = weights[v * 4 + k];
			if (!w) continue;
			const j = indices[v * 4 + k] * 16;
			for (let e = 0; e < 16; e++) m[e] += joints[j + e] * w;
			total += w;
		}
	}
	if (total <= 0.001) return;
	const [x, y, z] = source.positions.subarray(v * 3, v * 3 + 3);
	const [nx, ny, nz] = source.normals.subarray(v * 3, v * 3 + 3);
	for (let r = 0; r < 3; r++) {
		out.positions[v * 3 + r] =
			m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
		out.normals[v * 3 + r] = m[r] * nx + m[4 + r] * ny + m[8 + r] * nz;
	}
}

/**
 * The mesh as the raster vertex shader deforms it: morph targets in object
 * space, then linear blend skinning by `skinningMatrices` (16 floats per
 * joint, up to eight influences per vertex).
 */
export function deformPose(
	mesh: Mesh3DData,
	morphWeights: number[] | undefined,
	skinningMatrices: Float32Array | undefined,
): MeshPose {
	const morphed: MeshPose = {
		positions: new Float32Array(mesh.positions),
		normals: new Float32Array(mesh.normals),
	};
	if (morphWeights?.length && mesh.morphTargets?.length) {
		addMorphs(mesh, morphWeights, morphed);
	}
	if (!skinningMatrices || !mesh.jointIndices || !mesh.jointWeights) {
		return morphed;
	}
	const skinned: MeshPose = {
		positions: new Float32Array(morphed.positions),
		normals: new Float32Array(morphed.normals),
	};
	const vertexCount = mesh.positions.length / 3;
	for (let v = 0; v < vertexCount; v++) {
		skinVertex(mesh, skinningMatrices, v, morphed, skinned);
	}
	return skinned;
}

/** A unit quad (-0.5..0.5 in x and y, facing -z) as the raster quad draws it. */
export function unitQuadMesh(): Mesh3DData {
	return {
		positions: new Float32Array([
			-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
		]),
		normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
		uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
	};
}
