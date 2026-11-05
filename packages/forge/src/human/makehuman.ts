/**
 * MakeHuman's file formats: the base mesh (OBJ with named groups; the body
 * plus helper geometry and the little "joint-…" cubes whose centers place
 * the skeleton), shape targets (sparse `index dx dy dz` lines), the
 * skeleton (`.mhskel` JSON: bones whose head and tail are vertex groups)
 * and its painted skin weights (`.mhw` JSON: bone → [[vertex, weight]]).
 */

export interface BaseMesh {
	/** Every vertex of the file, 3 per vertex (decimeters, +y up, facing +z). */
	positions: Float32Array;
	uvs: Float32Array;
	/** Faces of the "body" group: per corner, vertex and UV index. */
	faces: { v: number[]; vt: number[] }[];
}

export function parseBaseObj(text: string): BaseMesh {
	const positions: number[] = [];
	const uvs: number[] = [];
	const faces: { v: number[]; vt: number[] }[] = [];
	let group = "";
	for (const line of text.split("\n")) {
		if (line.startsWith("v ")) {
			const [, x, y, z] = line.trim().split(/\s+/);
			positions.push(Number(x), Number(y), Number(z));
		} else if (line.startsWith("vt ")) {
			const [, u, v] = line.trim().split(/\s+/);
			uvs.push(Number(u), Number(v));
		} else if (line.startsWith("g ")) group = line.slice(2).trim();
		else if (line.startsWith("f ") && group === "body") {
			const corners = line.trim().split(/\s+/).slice(1);
			faces.push({
				v: corners.map((c) => Number(c.split("/")[0]) - 1),
				vt: corners.map((c) => Number(c.split("/")[1]) - 1),
			});
		}
	}
	return {
		positions: Float32Array.from(positions),
		uvs: Float32Array.from(uvs),
		faces,
	};
}

export interface Target {
	indices: Uint32Array;
	/** 3 per index. */
	deltas: Float32Array;
}

export function parseTarget(text: string): Target {
	const indices: number[] = [];
	const deltas: number[] = [];
	for (const line of text.split("\n")) {
		if (!line || line.startsWith("#")) continue;
		const [i, x, y, z] = line.trim().split(/\s+/);
		if (i === undefined) continue;
		indices.push(Number(i));
		deltas.push(Number(x), Number(y), Number(z));
	}
	return {
		indices: Uint32Array.from(indices),
		deltas: Float32Array.from(deltas),
	};
}

export interface MhBone {
	name: string;
	parent: string | null;
	head: string;
	tail: string;
}

export interface MhSkeleton {
	bones: MhBone[];
	/** Joint name → the vertices whose mean places it. */
	joints: Map<string, number[]>;
}

interface MhskelJson {
	bones: Record<string, { head: string; tail: string; parent: string | null }>;
	joints: Record<string, number[]>;
}

export function parseSkeleton(text: string): MhSkeleton {
	const json = JSON.parse(text) as MhskelJson;
	const bones = Object.entries(json.bones).map(([name, b]) => ({
		name,
		parent: b.parent,
		head: b.head,
		tail: b.tail,
	}));
	// Parents first.
	const placed = new Set<string>();
	const ordered: MhBone[] = [];
	while (ordered.length < bones.length) {
		const before = ordered.length;
		for (const b of bones)
			if (!placed.has(b.name) && (b.parent === null || placed.has(b.parent))) {
				ordered.push(b);
				placed.add(b.name);
			}
		if (ordered.length === before)
			throw new Error("mhskel: a bone's parent is missing");
	}
	return { bones: ordered, joints: new Map(Object.entries(json.joints)) };
}

/** Bone → [[vertex, weight], …]. */
export function parseWeights(text: string): Map<string, [number, number][]> {
	const json = JSON.parse(text) as {
		weights: Record<string, [number, number][]>;
	};
	return new Map(Object.entries(json.weights));
}
