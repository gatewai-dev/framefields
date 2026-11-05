/**
 * Quadric error simplification (Garland and Heckbert, 1997): edges collapse
 * cheapest-first, each costed by the summed squared distance to the planes
 * of the faces it has absorbed. Collapses that would tear the surface (the
 * link condition), fold a face over, or move a border between face tags
 * (materials) are refused, so the mesh stays closed and its materials keep
 * their outlines.
 */
import type { IndexedMesh } from "./mesh.js";

export interface SimplifyOptions {
	/** Stop at this many triangles or fewer. */
	triangles: number;
	/** Per-triangle tags (material ids); vertices where tags meet stay put. */
	tags?: Int32Array;
}

export interface SimplifiedMesh extends IndexedMesh {
	tags: Int32Array;
}

interface Entry {
	cost: number;
	a: number;
	b: number;
	va: number;
	vb: number;
	x: number;
	y: number;
	z: number;
}

class Heap {
	private items: Entry[] = [];
	get size() {
		return this.items.length;
	}
	push(e: Entry) {
		const a = this.items;
		a.push(e);
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if ((a[p] as Entry).cost <= e.cost) break;
			a[i] = a[p] as Entry;
			i = p;
		}
		a[i] = e;
	}
	pop(): Entry | undefined {
		const a = this.items;
		const top = a[0];
		const last = a.pop();
		if (!a.length || !last) return top;
		let i = 0;
		for (;;) {
			const l = 2 * i + 1;
			if (l >= a.length) break;
			const r = l + 1;
			const c =
				r < a.length && (a[r] as Entry).cost < (a[l] as Entry).cost ? r : l;
			if ((a[c] as Entry).cost >= last.cost) break;
			a[i] = a[c] as Entry;
			i = c;
		}
		a[i] = last;
		return top;
	}
}

/** Q += plane quadric of (n, d) weighted by w; 10 symmetric entries per vertex. */
function addPlane(
	q: Float64Array,
	o: number,
	nx: number,
	ny: number,
	nz: number,
	d: number,
	w: number,
) {
	q[o] = (q[o] as number) + w * nx * nx;
	q[o + 1] = (q[o + 1] as number) + w * nx * ny;
	q[o + 2] = (q[o + 2] as number) + w * nx * nz;
	q[o + 3] = (q[o + 3] as number) + w * nx * d;
	q[o + 4] = (q[o + 4] as number) + w * ny * ny;
	q[o + 5] = (q[o + 5] as number) + w * ny * nz;
	q[o + 6] = (q[o + 6] as number) + w * ny * d;
	q[o + 7] = (q[o + 7] as number) + w * nz * nz;
	q[o + 8] = (q[o + 8] as number) + w * nz * d;
	q[o + 9] = (q[o + 9] as number) + w * d * d;
}

export function simplify(
	mesh: IndexedMesh,
	options: SimplifyOptions,
): SimplifiedMesh {
	const P = Float64Array.from(mesh.positions);
	const F = Uint32Array.from(mesh.indices);
	const nv = P.length / 3;
	const nf = F.length / 3;
	const tags = options.tags
		? Int32Array.from(options.tags)
		: new Int32Array(nf);
	if (nf <= options.triangles) return { positions: P, indices: F, tags };

	const faceAlive = new Uint8Array(nf).fill(1);
	const vertAlive = new Uint8Array(nv).fill(1);
	const version = new Uint32Array(nv);
	const faces: number[][] = Array.from({ length: nv }, () => []);
	for (let f = 0; f < nf; f++)
		for (let c = 0; c < 3; c++)
			(faces[F[f * 3 + c] as number] as number[]).push(f);

	const Q = new Float64Array(nv * 10);
	const normal = (f: number, out: number[]) => {
		const a = (F[f * 3] as number) * 3;
		const b = (F[f * 3 + 1] as number) * 3;
		const c = (F[f * 3 + 2] as number) * 3;
		const ux = (P[b] as number) - (P[a] as number);
		const uy = (P[b + 1] as number) - (P[a + 1] as number);
		const uz = (P[b + 2] as number) - (P[a + 2] as number);
		const vx = (P[c] as number) - (P[a] as number);
		const vy = (P[c + 1] as number) - (P[a + 1] as number);
		const vz = (P[c + 2] as number) - (P[a + 2] as number);
		out[0] = uy * vz - uz * vy;
		out[1] = uz * vx - ux * vz;
		out[2] = ux * vy - uy * vx;
		return a;
	};
	const n3 = [0, 0, 0];
	for (let f = 0; f < nf; f++) {
		const a = normal(f, n3);
		const len = Math.hypot(n3[0] as number, n3[1] as number, n3[2] as number);
		if (len < 1e-20) continue;
		const nx = (n3[0] as number) / len;
		const ny = (n3[1] as number) / len;
		const nz = (n3[2] as number) / len;
		const d = -(
			nx * (P[a] as number) +
			ny * (P[a + 1] as number) +
			nz * (P[a + 2] as number)
		);
		for (let c = 0; c < 3; c++)
			addPlane(Q, (F[f * 3 + c] as number) * 10, nx, ny, nz, d, len / 2);
	}

	const locked = new Uint8Array(nv);
	if (options.tags)
		for (let v = 0; v < nv; v++) {
			const fs = faces[v] as number[];
			const t0 = tags[fs[0] as number];
			if (fs.some((f) => tags[f] !== t0)) locked[v] = 1;
		}

	const err = (o: number, o2: number, x: number, y: number, z: number) => {
		const q = (i: number) => (Q[o + i] as number) + (Q[o2 + i] as number);
		return (
			q(0) * x * x +
			2 * q(1) * x * y +
			2 * q(2) * x * z +
			2 * q(3) * x +
			q(4) * y * y +
			2 * q(5) * y * z +
			2 * q(6) * y +
			q(7) * z * z +
			2 * q(8) * z +
			q(9)
		);
	};

	const heap = new Heap();
	const consider = (a: number, b: number) => {
		if (locked[a] && locked[b]) return;
		const oa = a * 10;
		const ob = b * 10;
		const pa = a * 3;
		const pb = b * 3;
		const cands: [number, number, number][] = [];
		if (!locked[b])
			cands.push([P[pa] as number, P[pa + 1] as number, P[pa + 2] as number]);
		if (!locked[a])
			cands.push([P[pb] as number, P[pb + 1] as number, P[pb + 2] as number]);
		if (!locked[a] && !locked[b])
			cands.push([
				((P[pa] as number) + (P[pb] as number)) / 2,
				((P[pa + 1] as number) + (P[pb + 1] as number)) / 2,
				((P[pa + 2] as number) + (P[pb + 2] as number)) / 2,
			]);
		let best = cands[0] as [number, number, number];
		let cost = Number.POSITIVE_INFINITY;
		for (const c of cands) {
			const e = err(oa, ob, c[0], c[1], c[2]);
			if (e < cost) {
				cost = e;
				best = c;
			}
		}
		heap.push({
			cost: Math.max(0, cost),
			a,
			b,
			va: version[a] as number,
			vb: version[b] as number,
			x: best[0],
			y: best[1],
			z: best[2],
		});
	};

	const neighbors = (v: number, out: Set<number>) => {
		out.clear();
		for (const f of faces[v] as number[])
			if (faceAlive[f])
				for (let c = 0; c < 3; c++) {
					const w = F[f * 3 + c] as number;
					if (w !== v) out.add(w);
				}
		return out;
	};
	const na = new Set<number>();
	const nb = new Set<number>();
	for (let v = 0; v < nv; v++)
		for (const w of neighbors(v, na)) if (w > v) consider(v, w);

	/** Whether moving v (one of the collapsing pair) to (x, y, z) folds any face that survives. */
	const folds = (v: number, other: number, x: number, y: number, z: number) => {
		const before = [0, 0, 0];
		const after = [0, 0, 0];
		for (const f of faces[v] as number[]) {
			if (!faceAlive[f]) continue;
			let hasOther = false;
			for (let c = 0; c < 3; c++) if (F[f * 3 + c] === other) hasOther = true;
			if (hasOther) continue;
			normal(f, before);
			const o = v * 3;
			const sx = P[o] as number;
			const sy = P[o + 1] as number;
			const sz = P[o + 2] as number;
			P[o] = x;
			P[o + 1] = y;
			P[o + 2] = z;
			normal(f, after);
			P[o] = sx;
			P[o + 1] = sy;
			P[o + 2] = sz;
			const lb = Math.hypot(
				before[0] as number,
				before[1] as number,
				before[2] as number,
			);
			const la = Math.hypot(
				after[0] as number,
				after[1] as number,
				after[2] as number,
			);
			if (la < lb * 1e-3) return true;
			const cos =
				((before[0] as number) * (after[0] as number) +
					(before[1] as number) * (after[1] as number) +
					(before[2] as number) * (after[2] as number)) /
				(lb * la);
			if (cos < 0.3) return true;
		}
		return false;
	};

	let live = nf;
	while (live > options.triangles && heap.size) {
		const e = heap.pop() as Entry;
		const { a, b } = e;
		if (!vertAlive[a] || !vertAlive[b]) continue;
		if (version[a] !== e.va || version[b] !== e.vb) continue;
		// Link condition: the pair may share only the two vertices opposite their edge.
		neighbors(a, na);
		if (!na.has(b)) continue;
		neighbors(b, nb);
		let shared = 0;
		for (const w of na) if (nb.has(w)) shared++;
		if (shared !== 2) continue;
		if (folds(a, b, e.x, e.y, e.z) || folds(b, a, e.x, e.y, e.z)) continue;
		// Keep a, drop b.
		const keep = locked[b] ? b : a;
		const drop = keep === a ? b : a;
		P[keep * 3] = e.x;
		P[keep * 3 + 1] = e.y;
		P[keep * 3 + 2] = e.z;
		for (let i = 0; i < 10; i++)
			Q[keep * 10 + i] =
				(Q[keep * 10 + i] as number) + (Q[drop * 10 + i] as number);
		const kept = faces[keep] as number[];
		for (const f of faces[drop] as number[]) {
			if (!faceAlive[f]) continue;
			let hasKeep = false;
			for (let c = 0; c < 3; c++) if (F[f * 3 + c] === keep) hasKeep = true;
			if (hasKeep) {
				faceAlive[f] = 0;
				live--;
				continue;
			}
			for (let c = 0; c < 3; c++)
				if (F[f * 3 + c] === drop) F[f * 3 + c] = keep;
			kept.push(f);
		}
		faces[keep] = kept.filter((f) => faceAlive[f]);
		faces[drop] = [];
		vertAlive[drop] = 0;
		// Only edges at `keep` changed (its position and quadric): re-cost them;
		// the version bump retires their old heap entries.
		version[keep] = (version[keep] as number) + 1;
		for (const w of neighbors(keep, na)) consider(keep, w);
	}

	const remap = new Int32Array(nv).fill(-1);
	const positions: number[] = [];
	const indices: number[] = [];
	const outTags: number[] = [];
	for (let f = 0; f < nf; f++) {
		if (!faceAlive[f]) continue;
		for (let c = 0; c < 3; c++) {
			const v = F[f * 3 + c] as number;
			if ((remap[v] as number) < 0) {
				remap[v] = positions.length / 3;
				positions.push(
					P[v * 3] as number,
					P[v * 3 + 1] as number,
					P[v * 3 + 2] as number,
				);
			}
			indices.push(remap[v] as number);
		}
		outTags.push(tags[f] as number);
	}
	return {
		positions: Float64Array.from(positions),
		indices: Uint32Array.from(indices),
		tags: Int32Array.from(outTags),
	};
}
