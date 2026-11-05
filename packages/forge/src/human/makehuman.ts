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

/** A proxy (clothes, eyes) bound to the base mesh: each vertex is a barycentric point on three base vertices plus a scaled offset. */
export interface MhProxy {
	/** Per proxy vertex: three base vertex indices. */
	refs: Uint32Array;
	/** Per proxy vertex: three weights. */
	weights: Float32Array;
	/** Per proxy vertex: offset (decimeters at the reference scale). */
	offsets: Float32Array;
	/** Per axis: two base vertices whose distance along it, over `ref`, scales the offsets. */
	scales: { a: number; b: number; ref: number }[];
}

export function parseProxy(text: string): MhProxy {
	const refs: number[] = [];
	const weights: number[] = [];
	const offsets: number[] = [];
	const scales: { a: number; b: number; ref: number }[] = [
		{ a: 0, b: 0, ref: 0 },
		{ a: 0, b: 0, ref: 0 },
		{ a: 0, b: 0, ref: 0 },
	];
	let inVerts = false;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const parts = line.split(/\s+/);
		const head = parts[0] as string;
		const scale = { x_scale: 0, y_scale: 1, z_scale: 2 }[head];
		if (scale !== undefined) {
			scales[scale] = {
				a: Number(parts[1]),
				b: Number(parts[2]),
				ref: Number(parts[3]),
			};
			continue;
		}
		if (head === "verts") {
			inVerts = true;
			continue;
		}
		if (!inVerts) continue;
		if (parts.length < 9 || Number.isNaN(Number(head))) {
			inVerts = false;
			continue;
		}
		refs.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
		weights.push(Number(parts[3]), Number(parts[4]), Number(parts[5]));
		offsets.push(Number(parts[6]), Number(parts[7]), Number(parts[8]));
	}
	return {
		refs: Uint32Array.from(refs),
		weights: Float32Array.from(weights),
		offsets: Float32Array.from(offsets),
		scales,
	};
}

/** The proxy's vertices placed on a (shaped) base mesh, in its units. */
export function fitProxy(proxy: MhProxy, base: Float32Array): Float32Array {
	const s = proxy.scales.map(({ a, b, ref }, axis) =>
		ref
			? Math.abs(
					(base[a * 3 + axis] as number) - (base[b * 3 + axis] as number),
				) / ref
			: 1,
	);
	const n = proxy.refs.length / 3;
	const out = new Float32Array(n * 3);
	for (let v = 0; v < n; v++)
		for (let axis = 0; axis < 3; axis++) {
			let p = 0;
			for (let k = 0; k < 3; k++)
				p +=
					(proxy.weights[v * 3 + k] as number) *
					(base[(proxy.refs[v * 3 + k] as number) * 3 + axis] as number);
			out[v * 3 + axis] =
				p + (proxy.offsets[v * 3 + axis] as number) * (s[axis] as number);
		}
	return out;
}

/** A plain OBJ: positions, UVs and faces (corner vertex and UV indices). */
export function parseObj(text: string): {
	positions: Float32Array;
	uvs: Float32Array;
	faces: { v: number[]; vt: number[] }[];
} {
	const positions: number[] = [];
	const uvs: number[] = [];
	const faces: { v: number[]; vt: number[] }[] = [];
	for (const line of text.split("\n")) {
		if (line.startsWith("v ")) {
			const [, x, y, z] = line.trim().split(/\s+/);
			positions.push(Number(x), Number(y), Number(z));
		} else if (line.startsWith("vt ")) {
			const [, u, v] = line.trim().split(/\s+/);
			uvs.push(Number(u), Number(v));
		} else if (line.startsWith("f ")) {
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
