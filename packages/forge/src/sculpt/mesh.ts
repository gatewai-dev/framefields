/**
 * Meshes a sculpt field at hero resolution: the lattice is only sampled
 * in blocks the surface can pass through (a narrow band, found from the
 * field's distance bound), each block evaluating only the parts that can
 * reach it. Surface Nets place one vertex per crossed cell, which is then
 * projected onto the true surface, and a quad joins the four cells around
 * every crossed lattice edge: a closed, manifold, consistently wound mesh.
 */
import type { Vec3 } from "../skeleton.js";
import type { SculptField } from "./field.js";

export interface IndexedMesh {
	positions: Float64Array;
	/** Triangles, counter-clockwise seen from outside. */
	indices: Uint32Array;
}

const B = 8; // cells per block side

const CORNERS: ReadonlyArray<Vec3> = [
	[0, 0, 0],
	[1, 0, 0],
	[0, 1, 0],
	[1, 1, 0],
	[0, 0, 1],
	[1, 0, 1],
	[0, 1, 1],
	[1, 1, 1],
];
const EDGES: ReadonlyArray<[number, number]> = [
	[0, 1],
	[2, 3],
	[4, 5],
	[6, 7],
	[0, 2],
	[1, 3],
	[4, 6],
	[5, 7],
	[0, 4],
	[1, 5],
	[2, 6],
	[3, 7],
];
/** Per lattice axis: the step, and the four cells around the edge, wound toward +axis. */
const AXES: ReadonlyArray<{ step: Vec3; around: ReadonlyArray<Vec3> }> = [
	{
		step: [1, 0, 0],
		around: [
			[0, 0, 0],
			[0, -1, 0],
			[0, -1, -1],
			[0, 0, -1],
		],
	},
	{
		step: [0, 1, 0],
		around: [
			[0, 0, 0],
			[0, 0, -1],
			[-1, 0, -1],
			[-1, 0, 0],
		],
	},
	{
		step: [0, 0, 1],
		around: [
			[0, 0, 0],
			[-1, 0, 0],
			[-1, -1, 0],
			[0, -1, 0],
		],
	},
];

/** A cell edge's index from its two corners. */
const EDGE_OF = new Map<number, number>(
	EDGES.map(([a, b], i) => [a * 8 + b, i]),
);
const edgeOfCorners = (a: number, b: number) =>
	(EDGE_OF.get(a * 8 + b) ?? EDGE_OF.get(b * 8 + a)) as number;
/** The cell's six faces as corner cycles. */
const FACES: ReadonlyArray<[number, number, number, number]> = [
	[0, 2, 6, 4],
	[1, 3, 7, 5],
	[0, 1, 5, 4],
	[2, 3, 7, 6],
	[0, 1, 3, 2],
	[4, 5, 7, 6],
];

/**
 * The surface sheets through a cell, each as the cell edges it crosses.
 * Crossings on a face join in pairs; a face crossed four times (a saddle)
 * pairs them by the sign at its center, the same way from both cells that
 * share it, so neighboring cells agree and the mesh stays manifold.
 */
function cellSheets(vals: readonly number[]): number[][] {
	const parent = Array.from({ length: 12 }, (_, i) => i);
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x] as number] as number;
			x = parent[x] as number;
		}
		return x;
	};
	const join = (a: number, b: number) => {
		parent[find(a)] = find(b);
	};
	const crosses = (e: number) => {
		const [a, b] = EDGES[e] as [number, number];
		return (vals[a] as number) < 0 !== (vals[b] as number) < 0;
	};
	let any = false;
	for (let e = 0; e < 12; e++) if (crosses(e)) any = true;
	if (!any) return [];
	for (const q of FACES) {
		const e = [0, 1, 2, 3].map((i) =>
			edgeOfCorners(q[i] as number, q[(i + 1) % 4] as number),
		);
		const hit = e.filter(crosses);
		if (hit.length === 2) join(hit[0] as number, hit[1] as number);
		else if (hit.length === 4) {
			const center = q.reduce((s, c) => s + (vals[c] as number), 0) / 4;
			const s0 = (vals[q[0]] as number) < 0;
			if (center < 0 === s0) {
				// q0 and q2 connect through the center: cut around q1 and around q3.
				join(e[0] as number, e[1] as number);
				join(e[2] as number, e[3] as number);
			} else {
				join(e[3] as number, e[0] as number);
				join(e[1] as number, e[2] as number);
			}
		}
	}
	const groups = new Map<number, number[]>();
	for (let e = 0; e < 12; e++) {
		if (!crosses(e)) continue;
		const r = find(e);
		const g = groups.get(r);
		if (g) g.push(e);
		else groups.set(r, [e]);
	}
	return [...groups.values()];
}

/** The lattice edge along `axis` as an edge of the cell at offset `o` around it. */
function edgeIn(axis: number, o: Vec3): number {
	if (axis === 0) return -o[1] + 2 * -o[2];
	if (axis === 1) return 4 + -o[0] + 2 * -o[2];
	return 8 + -o[0] + 2 * -o[1];
}

interface Block {
	bi: number;
	bj: number;
	bk: number;
	parts: number[];
	values: Float32Array;
}

export interface MeshOptions {
	/** Lattice cell size, model units. */
	cell: number;
}

/** The field's zero surface as an indexed triangle mesh. */
export function meshField(
	field: SculptField,
	options: MeshOptions,
): IndexedMesh {
	const h = options.cell;
	const { min, max } = field.bounds();
	const pad = 2 * h;
	const origin: Vec3 = [min[0] - pad, min[1] - pad, min[2] - pad];
	const cells: Vec3 = [
		Math.ceil((max[0] - min[0] + 2 * pad) / h),
		Math.ceil((max[1] - min[1] + 2 * pad) / h),
		Math.ceil((max[2] - min[2] + 2 * pad) / h),
	];
	const nb: Vec3 = [
		Math.ceil(cells[0] / B),
		Math.ceil(cells[1] / B),
		Math.ceil(cells[2] / B),
	];
	if (nb[0] * nb[1] * nb[2] > 4e6)
		throw new Error(
			`sculpt: cell ${h} is too fine for a ${(max[0] - min[0]).toFixed(0)}-unit model`,
		);
	// Lattice nodes span (cells + 1) per axis, rounded up to whole blocks.
	const NX = nb[0] * B + 1;
	const NY = nb[1] * B + 1;
	const cellId = (i: number, j: number, k: number) => (k * NY + j) * NX + i;
	const node = (i: number, j: number, k: number): Vec3 => [
		origin[0] + i * h,
		origin[1] + j * h,
		origin[2] + k * h,
	];

	const blocks: Block[] = [];
	const blockRadius = (B * h * Math.sqrt(3)) / 2;
	const L = field.lipschitz;
	for (let bk = 0; bk < nb[2]; bk++)
		for (let bj = 0; bj < nb[1]; bj++)
			for (let bi = 0; bi < nb[0]; bi++) {
				const c = node((bi + 0.5) * B, (bj + 0.5) * B, (bk + 0.5) * B);
				const parts = field.relevant(c, blockRadius);
				if (!parts.length) continue;
				const d = field.distance(c[0], c[1], c[2], parts);
				// The surface can't be in a block whose center is farther than its reach.
				if (Math.abs(d) > (blockRadius + h) * L) continue;
				const values = new Float32Array((B + 1) ** 3);
				let neg = false;
				let pos = false;
				for (let k = 0; k <= B; k++)
					for (let j = 0; j <= B; j++)
						for (let i = 0; i <= B; i++) {
							const p = node(bi * B + i, bj * B + j, bk * B + k);
							const v = field.distance(p[0], p[1], p[2], parts);
							values[(k * (B + 1) + j) * (B + 1) + i] = v;
							if (v < 0) neg = true;
							else pos = true;
						}
				if (neg && pos) blocks.push({ bi, bj, bk, parts, values });
			}

	const positions: number[] = [];
	// (cell, cell edge) → vertex: a cell holds one vertex per surface sheet through it.
	const vertexOf = new Map<number, number>();
	const key = (cell: number, edge: number) => cell * 12 + edge;
	const at = (b: Block, i: number, j: number, k: number) =>
		b.values[(k * (B + 1) + j) * (B + 1) + i] as number;
	const vals = new Array<number>(8);
	for (const b of blocks) {
		for (let k = 0; k < B; k++)
			for (let j = 0; j < B; j++)
				for (let i = 0; i < B; i++) {
					for (let c = 0; c < 8; c++) {
						const o = CORNERS[c] as Vec3;
						vals[c] = at(b, i + o[0], j + o[1], k + o[2]);
					}
					const sheets = cellSheets(vals);
					if (!sheets.length) continue;
					const gi = b.bi * B + i;
					const gj = b.bj * B + j;
					const gk = b.bk * B + k;
					const id = cellId(gi, gj, gk);
					for (const edges of sheets) {
						let sx = 0;
						let sy = 0;
						let sz = 0;
						for (const e of edges) {
							const [ea, eb] = EDGES[e] as [number, number];
							const va = vals[ea] as number;
							const vb = vals[eb] as number;
							const t = va / (va - vb);
							const ca = CORNERS[ea] as Vec3;
							const cb = CORNERS[eb] as Vec3;
							sx += ca[0] + (cb[0] - ca[0]) * t;
							sy += ca[1] + (cb[1] - ca[1]) * t;
							sz += ca[2] + (cb[2] - ca[2]) * t;
						}
						const n = edges.length;
						const p = node(gi + sx / n, gj + sy / n, gk + sz / n);
						project(field, p, h, b.parts);
						const v = positions.length / 3;
						positions.push(p[0], p[1], p[2]);
						for (const e of edges) vertexOf.set(key(id, e), v);
					}
				}
	}

	const indices: number[] = [];
	for (const b of blocks) {
		for (let k = 0; k < B; k++)
			for (let j = 0; j < B; j++)
				for (let i = 0; i < B; i++) {
					const v0 = at(b, i, j, k);
					for (let axis = 0; axis < 3; axis++) {
						const { step, around } = AXES[axis] as (typeof AXES)[number];
						const v1 = at(b, i + step[0], j + step[1], k + step[2]);
						if (v0 < 0 === v1 < 0) continue;
						const gi = b.bi * B + i;
						const gj = b.bj * B + j;
						const gk = b.bk * B + k;
						const q: number[] = [];
						for (const o of around) {
							// This lattice edge, as one of the 12 edges of the cell at offset o.
							const e = edgeIn(axis, o);
							const v = vertexOf.get(
								key(cellId(gi + o[0], gj + o[1], gk + o[2]), e),
							);
							if (v === undefined) break;
							q.push(v);
						}
						if (q.length < 4) continue;
						const [a, bb, c, d] = q as [number, number, number, number];
						// Each cycle winds toward +axis; the surface faces +axis where the field leaves the solid.
						if (v0 < 0) indices.push(a, bb, c, a, c, d);
						else indices.push(a, c, bb, a, d, c);
					}
				}
	}
	return {
		positions: Float64Array.from(positions),
		indices: Uint32Array.from(indices),
	};
}

/** Moves a Surface Nets point onto the zero surface by Newton steps, at most most of a cell. */
export function project(
	field: SculptField,
	p: Vec3,
	h: number,
	parts: readonly number[],
) {
	const start: Vec3 = [p[0], p[1], p[2]];
	for (let it = 0; it < 3; it++) {
		const d = field.distance(p[0], p[1], p[2], parts);
		if (Math.abs(d) < h * 1e-3) break;
		const n = field.normal(p[0], p[1], p[2], h * 0.25, parts);
		p[0] -= n[0] * d;
		p[1] -= n[1] * d;
		p[2] -= n[2] * d;
	}
	const dx = p[0] - start[0];
	const dy = p[1] - start[1];
	const dz = p[2] - start[2];
	const moved = Math.hypot(dx, dy, dz);
	const limit = 0.75 * h;
	if (moved > limit) {
		// A thin or sharp feature: keep the vertex in its cell's neighborhood.
		const s = limit / moved;
		p[0] = start[0] + dx * s;
		p[1] = start[1] + dy * s;
		p[2] = start[2] + dz * s;
	}
}

/** Signed volume (positive for an outward-wound closed mesh). */
export function meshVolume(m: IndexedMesh): number {
	let v = 0;
	const P = m.positions;
	for (let t = 0; t < m.indices.length; t += 3) {
		const a = (m.indices[t] as number) * 3;
		const b = (m.indices[t + 1] as number) * 3;
		const c = (m.indices[t + 2] as number) * 3;
		const ax = P[a] as number;
		const ay = P[a + 1] as number;
		const az = P[a + 2] as number;
		const bx = P[b] as number;
		const by = P[b + 1] as number;
		const bz = P[b + 2] as number;
		const cx = P[c] as number;
		const cy = P[c + 1] as number;
		const cz = P[c + 2] as number;
		v +=
			ax * (by * cz - bz * cy) -
			ay * (bx * cz - bz * cx) +
			az * (bx * cy - by * cx);
	}
	return v / 6;
}

/** Edges used by other than exactly two triangles, and by two triangles in the same direction. */
export function meshDefects(m: IndexedMesh): { open: number; flipped: number } {
	const count = new Map<string, number>();
	for (let t = 0; t < m.indices.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = m.indices[t + e] as number;
			const b = m.indices[t + ((e + 1) % 3)] as number;
			const key = `${a},${b}`;
			count.set(key, (count.get(key) ?? 0) + 1);
		}
	let open = 0;
	let flipped = 0;
	for (const [key, n] of count) {
		if (n > 1) flipped++;
		const [a, b] = key.split(",");
		if (!count.has(`${b},${a}`)) open++;
	}
	return { open, flipped };
}
