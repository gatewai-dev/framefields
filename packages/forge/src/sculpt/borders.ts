/**
 * Smooth material borders. Each vertex takes the material of the part that
 * owns the surface there; a triangle whose corners disagree is cut where
 * ownership changes along its edges (found by bisection with the field's
 * own rule, then projected onto the surface), so a sleeve or collar ends
 * on a clean curve instead of the triangles' staircase.
 */
import type { Vec3 } from "../skeleton.js";
import type { SculptField } from "./field.js";
import { type IndexedMesh, project } from "./mesh.js";

export interface TaggedMesh extends IndexedMesh {
	/** Per-triangle material id. */
	tags: Int32Array;
}

/** Per-vertex material ids by the field's owner at each vertex. */
export function vertexMaterials(
	field: SculptField,
	positions: Float64Array,
	materialOf: (part: number) => number,
): Int32Array {
	const n = positions.length / 3;
	const out = new Int32Array(n);
	for (let v = 0; v < n; v++) {
		field.distance(
			positions[v * 3] as number,
			positions[v * 3 + 1] as number,
			positions[v * 3 + 2] as number,
		);
		out[v] = materialOf(field.owner);
	}
	return out;
}

/** Each triangle's material: the one most of its corners have (the first corner's on a three-way tie). */
export function majorityTags(
	indices: Uint32Array,
	materials: Int32Array,
): Int32Array {
	const tags = new Int32Array(indices.length / 3);
	for (let f = 0; f < tags.length; f++) {
		const a = materials[indices[f * 3] as number] as number;
		const b = materials[indices[f * 3 + 1] as number] as number;
		const c = materials[indices[f * 3 + 2] as number] as number;
		tags[f] = b === c ? b : a;
	}
	return tags;
}

/** The mesh with every two-material triangle cut along its border. */
export function splitBorders(
	field: SculptField,
	mesh: IndexedMesh,
	materialOf: (part: number) => number,
	cell: number,
): TaggedMesh {
	const positions = Array.from(mesh.positions);
	const mats = Array.from(vertexMaterials(field, mesh.positions, materialOf));
	const indices: number[] = [];
	const tags: number[] = [];
	const cut = new Map<number, number>();
	const nv0 = mesh.positions.length / 3;

	const pos = (v: number): Vec3 => [
		positions[v * 3] as number,
		positions[v * 3 + 1] as number,
		positions[v * 3 + 2] as number,
	];
	/** The border point on edge (a, b), shared by both triangles of the edge. */
	const border = (a: number, b: number): number => {
		const key = a < b ? a * nv0 + b : b * nv0 + a;
		const found = cut.get(key);
		if (found !== undefined) return found;
		const pa = pos(a);
		const pb = pos(b);
		const ma = mats[a] as number;
		let lo = 0;
		let hi = 1;
		for (let it = 0; it < 12; it++) {
			const t = (lo + hi) / 2;
			field.distance(
				pa[0] + (pb[0] - pa[0]) * t,
				pa[1] + (pb[1] - pa[1]) * t,
				pa[2] + (pb[2] - pa[2]) * t,
			);
			if (materialOf(field.owner) === ma) lo = t;
			else hi = t;
		}
		const t = (lo + hi) / 2;
		const p: Vec3 = [
			pa[0] + (pb[0] - pa[0]) * t,
			pa[1] + (pb[1] - pa[1]) * t,
			pa[2] + (pb[2] - pa[2]) * t,
		];
		project(field, p, cell, field.relevant(p, cell));
		const v = positions.length / 3;
		positions.push(p[0], p[1], p[2]);
		mats.push(-1);
		cut.set(key, v);
		return v;
	};

	for (let f = 0; f < mesh.indices.length; f += 3) {
		const tri = [mesh.indices[f], mesh.indices[f + 1], mesh.indices[f + 2]] as [
			number,
			number,
			number,
		];
		const m = tri.map((v) => mats[v] as number) as [number, number, number];
		if (m[0] === m[1] && m[1] === m[2]) {
			indices.push(...tri);
			tags.push(m[0]);
			continue;
		}
		if (m[0] !== m[1] && m[1] !== m[2] && m[0] !== m[2]) {
			// Three materials meet: rare at lattice scale; keep the triangle whole.
			indices.push(...tri);
			tags.push(m[0]);
			continue;
		}
		// Rotate so the odd corner is first: (a | b, c).
		const odd = m[1] === m[2] ? 0 : m[0] === m[2] ? 1 : 2;
		const a = tri[odd];
		const b = tri[(odd + 1) % 3];
		const c = tri[(odd + 2) % 3];
		const pab = border(a, b);
		const pac = border(a, c);
		indices.push(a, pab, pac);
		tags.push(m[odd]);
		indices.push(pab, b, c, pab, c, pac);
		tags.push(m[(odd + 1) % 3], m[(odd + 1) % 3]);
	}
	return {
		positions: Float64Array.from(positions),
		indices: Uint32Array.from(indices),
		tags: Int32Array.from(tags),
	};
}
