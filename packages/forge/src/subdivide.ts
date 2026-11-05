/**
 * Loop subdivision of a triangle primitive: each triangle splits in four
 * and the surface relaxes toward its smooth limit (Loop, 1987). Everything
 * that moves with the surface rides the same linear stencil, so it stays
 * exact: blend shape deltas, skin weights (renormalized to four joints).
 * UVs are interpolated linearly per face corner, so texture seams stay
 * where they are. Vertices duplicated at a seam share one position: pass
 * `weld` (the same id for every copy) and the seam subdivides as one
 * surface instead of opening into a crease.
 */
import type { MorphTargetSpec, PrimitiveSpec } from "./document.js";

export interface SubdivideOptions {
	/** Levels (each multiplies the triangles by four). Default 1. */
	levels?: number;
	/** Per vertex: a topology id shared by copies of one surface point (UV seams). Default: the vertex index. */
	weld?: ArrayLike<number>;
}

type Numbers = ArrayLike<number>;

/** A vertex of the result as an affine combination of topology vertices. */
type Stencil = [number, number][];

export function subdivide(
	p: PrimitiveSpec,
	options: SubdivideOptions = {},
): PrimitiveSpec {
	let out = p;
	let weld = options.weld;
	for (let l = 0; l < (options.levels ?? 1); l++) {
		const r = subdivideOnce(out, weld);
		out = r.primitive;
		weld = r.weld;
	}
	return out;
}

function subdivideOnce(
	p: PrimitiveSpec,
	weldIn?: Numbers,
): { primitive: PrimitiveSpec; weld: number[] } {
	const nv = p.positions.length / 3;
	const idx = Array.from(p.indices ?? Array.from({ length: nv }, (_, i) => i));
	const weld = weldIn
		? Array.from(weldIn)
		: Array.from({ length: nv }, (_, i) => i);
	// Topology vertices: one per weld id.
	const topoOf = new Map<number, number>();
	const repr: number[] = [];
	const topo = weld.map((w, v) => {
		let t = topoOf.get(w);
		if (t === undefined) {
			t = repr.length;
			topoOf.set(w, t);
			repr.push(v);
		}
		return t;
	});
	const nt = repr.length;

	// Edges between topology vertices, with the opposite vertex of each face on them.
	const edgeKey = (a: number, b: number) => (a < b ? a * nt + b : b * nt + a);
	const opposite = new Map<number, number[]>();
	const neighbors: Set<number>[] = Array.from({ length: nt }, () => new Set());
	for (let f = 0; f < idx.length; f += 3)
		for (let k = 0; k < 3; k++) {
			const a = topo[idx[f + k] as number] as number;
			const b = topo[idx[f + ((k + 1) % 3)] as number] as number;
			const c = topo[idx[f + ((k + 2) % 3)] as number] as number;
			const key = edgeKey(a, b);
			const list = opposite.get(key) ?? [];
			list.push(c);
			opposite.set(key, list);
			(neighbors[a] as Set<number>).add(b);
			(neighbors[b] as Set<number>).add(a);
		}
	const boundary = (a: number, b: number) =>
		(opposite.get(edgeKey(a, b))?.length ?? 0) < 2;

	// Loop's stencils: moved old vertices, new edge vertices.
	const vertexStencil = (t: number): Stencil => {
		const ns = [...(neighbors[t] as Set<number>)];
		const rim = ns.filter((n) => boundary(t, n));
		if (rim.length >= 2)
			return [
				[t, 0.75],
				[rim[0] as number, 0.125],
				[rim[1] as number, 0.125],
			];
		const n = ns.length;
		if (!n) return [[t, 1]];
		const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
		return [[t, 1 - n * beta], ...ns.map((m): [number, number] => [m, beta])];
	};
	const edgeStencil = (a: number, b: number): Stencil => {
		const opp = opposite.get(edgeKey(a, b)) ?? [];
		if (opp.length !== 2)
			return [
				[a, 0.5],
				[b, 0.5],
			];
		return [
			[a, 0.375],
			[b, 0.375],
			[opp[0] as number, 0.125],
			[opp[1] as number, 0.125],
		];
	};

	// Output vertices: an old corner (topology vertex + its own UV), or an
	// edge's new vertex per distinct UV midpoint.
	const stencils: Stencil[] = [];
	const uvs: number[] = [];
	const uv1: number[] = [];
	const hasUv = Boolean(p.uvs);
	const hasUv1 = Boolean(p.uvs1);
	const newWeld: number[] = [];
	const oldOut = new Map<number, number>();
	const edgeOut = new Map<string, number>();
	const pushUv = (
		dst: number[],
		src: Numbers | undefined,
		a: number,
		b?: number,
	) => {
		if (!src) return;
		const u =
			b === undefined
				? (src[a * 2] as number)
				: ((src[a * 2] as number) + (src[b * 2] as number)) / 2;
		const v =
			b === undefined
				? (src[a * 2 + 1] as number)
				: ((src[a * 2 + 1] as number) + (src[b * 2 + 1] as number)) / 2;
		dst.push(u, v);
	};
	const old = (v: number) => {
		let o = oldOut.get(v);
		if (o === undefined) {
			o = stencils.length;
			oldOut.set(v, o);
			stencils.push(vertexStencil(topo[v] as number));
			pushUv(uvs, p.uvs, v);
			pushUv(uv1, p.uvs1, v);
			newWeld.push(topo[v] as number);
		}
		return o;
	};
	const mid = (va: number, vb: number) => {
		const a = topo[va] as number;
		const b = topo[vb] as number;
		const uvKey = hasUv
			? `${(((p.uvs?.[va * 2] as number) + (p.uvs?.[vb * 2] as number)) / 2).toFixed(6)},${(((p.uvs?.[va * 2 + 1] as number) + (p.uvs?.[vb * 2 + 1] as number)) / 2).toFixed(6)}`
			: "";
		const key = `${edgeKey(a, b)}|${uvKey}`;
		let o = edgeOut.get(key);
		if (o === undefined) {
			o = stencils.length;
			edgeOut.set(key, o);
			stencils.push(edgeStencil(a, b));
			pushUv(uvs, p.uvs, va, vb);
			pushUv(uv1, p.uvs1, va, vb);
			newWeld.push(nt + edgeKey(a, b));
		}
		return o;
	};
	const indices: number[] = [];
	for (let f = 0; f < idx.length; f += 3) {
		const [a, b, c] = [idx[f], idx[f + 1], idx[f + 2]] as [
			number,
			number,
			number,
		];
		const [oa, ob, oc] = [old(a), old(b), old(c)];
		const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
		indices.push(oa, ab, ca, ab, ob, bc, ca, bc, oc, ab, bc, ca);
	}

	// Per-topology-vertex values, then the stencils.
	const perTopo = (data: Numbers, size: number) => {
		const out = new Float64Array(nt * size);
		repr.forEach((v, t) => {
			for (let k = 0; k < size; k++)
				out[t * size + k] = data[v * size + k] as number;
		});
		return out;
	};
	const apply = (data: Float64Array, size: number) => {
		const out = new Array<number>(stencils.length * size).fill(0);
		stencils.forEach((s, i) => {
			for (const [t, w] of s)
				for (let k = 0; k < size; k++)
					out[i * size + k] =
						(out[i * size + k] as number) + w * (data[t * size + k] as number);
		});
		return out;
	};
	const positions = apply(perTopo(p.positions, 3), 3);
	const result: PrimitiveSpec = { ...p, positions, indices };
	if (hasUv) result.uvs = uvs;
	if (hasUv1) result.uvs1 = uv1;
	if (p.colors) result.colors = apply(perTopo(p.colors, 4), 4);
	if (p.joints && p.weights) {
		const j = p.joints;
		const w = p.weights;
		const lists = repr.map((v) => {
			const l = new Map<number, number>();
			for (let k = 0; k < 4; k++) {
				const wk = w[v * 4 + k] as number;
				if (wk > 0)
					l.set(
						j[v * 4 + k] as number,
						(l.get(j[v * 4 + k] as number) ?? 0) + wk,
					);
			}
			return l;
		});
		const joints: number[] = [];
		const weights: number[] = [];
		for (const s of stencils) {
			const acc = new Map<number, number>();
			for (const [t, sw] of s)
				for (const [jj, ww] of lists[t] as Map<number, number>)
					acc.set(jj, (acc.get(jj) ?? 0) + sw * ww);
			const top = [...acc]
				.filter(([, x]) => x > 0)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4);
			const sum = top.reduce((t, x) => t + x[1], 0) || 1;
			for (let k = 0; k < 4; k++) {
				joints.push(top[k]?.[0] ?? 0);
				weights.push((top[k]?.[1] ?? 0) / sum);
			}
		}
		result.joints = joints;
		result.weights = weights;
	}
	result.normals = smoothNormals(positions, indices, newWeld);
	if (p.targets?.length)
		result.targets = p.targets.map((t): MorphTargetSpec => {
			const delta = apply(perTopo(t.positions, 3), 3);
			if (!t.normals) return { name: t.name, positions: delta };
			const moved = positions.map((x, i) => x + (delta[i] as number));
			const shaped = smoothNormals(moved, indices, newWeld);
			return {
				name: t.name,
				positions: delta,
				normals: shaped.map((n, i) => n - (result.normals?.[i] as number)),
			};
		});
	return { primitive: result, weld: newWeld };
}

/** Area-weighted vertex normals, shared by welded copies. */
export function smoothNormals(
	positions: Numbers,
	indices: Numbers,
	weld: Numbers,
): number[] {
	const acc = new Map<number, [number, number, number]>();
	for (let f = 0; f < indices.length; f += 3) {
		const [a, b, c] = [indices[f], indices[f + 1], indices[f + 2]] as [
			number,
			number,
			number,
		];
		const ux = (positions[b * 3] as number) - (positions[a * 3] as number);
		const uy =
			(positions[b * 3 + 1] as number) - (positions[a * 3 + 1] as number);
		const uz =
			(positions[b * 3 + 2] as number) - (positions[a * 3 + 2] as number);
		const vx = (positions[c * 3] as number) - (positions[a * 3] as number);
		const vy =
			(positions[c * 3 + 1] as number) - (positions[a * 3 + 1] as number);
		const vz =
			(positions[c * 3 + 2] as number) - (positions[a * 3 + 2] as number);
		const n: [number, number, number] = [
			uy * vz - uz * vy,
			uz * vx - ux * vz,
			ux * vy - uy * vx,
		];
		for (const v of [a, b, c]) {
			const w = weld[v] as number;
			const cur = acc.get(w) ?? [0, 0, 0];
			acc.set(w, [cur[0] + n[0], cur[1] + n[1], cur[2] + n[2]]);
		}
	}
	const out: number[] = [];
	for (let v = 0; v < weld.length; v++) {
		const n = acc.get(weld[v] as number) ?? [0, 1, 0];
		const l = Math.hypot(n[0], n[1], n[2]) || 1;
		out.push(n[0] / l, n[1] / l, n[2] / l);
	}
	return out;
}
