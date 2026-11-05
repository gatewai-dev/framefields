/**
 * Deterministic Voronoi fracture of a mesh into convex-cell pieces.
 *
 * Seeds are scattered inside the solid (denser around an impact point);
 * each seed's Voronoi cell is the box clipped by the bisector planes of its
 * neighbors (exact: neighbors are taken nearest first until none can cut).
 * The source triangles are then clipped by each cell's planes, and every
 * cut is closed with a cap: the cut segments are chained into loops on the
 * plane and triangulated, holes included, so pieces of a watertight source
 * are watertight too. Cut points are computed from canonically ordered
 * edge endpoints, so neighbors produce bit-identical vertices and loops
 * chain by exact position.
 *
 * The result is one model whose vertices are rigidly skinned to one joint
 * per piece: posing the joints moves the pieces, all in one draw per
 * material. At rest every joint is the identity and the model looks intact.
 */
import earcut from "earcut";
import { poseNodes } from "../loaders/pose.js";
import type {
	Material3D,
	Mesh3DData,
	Model3DData,
	ModelNode3D,
} from "../loaders/types.js";
import { type Mat4, Matrix4Math } from "../math3d/matrix4.js";
import { createRandom } from "../math3d/noise.js";
import type { Vec3 } from "../math3d/vector3.js";
import { parseHexOrRgbColor } from "./text-extruder.js";

export interface FractureOptions {
	/** Voronoi cells (2..256). Default 48. */
	cells?: number;
	seed?: number;
	/** Object-space point the cells crowd around (smaller pieces there). */
	impactPoint?: Vec3;
	/** Color of the newly exposed faces. Default "#d8d2c4". */
	interiorColor?: string;
	/** Roughness of the newly exposed faces. Default 0.9. */
	interiorRoughness?: number;
}

export interface FractureCell {
	/** Center of mass at rest, object space. */
	centroid: Vec3;
	volume: number;
	/** Hull points around the centroid, flat xyz (at most 256). */
	hull: number[];
}

export interface FracturedModel {
	/** One joint per cell (`nodes[i]` sits at `cells[i].centroid`). */
	model: Model3DData;
	cells: FractureCell[];
}

/** Name of the material on cut faces. */
export const FRACTURE_INTERIOR_MATERIAL = "fracture-interior";

type Rgba = [number, number, number, number];

interface FVertex {
	p: Vec3;
	n: Vec3;
	uv: [number, number];
	c: Rgba;
}

interface FPoly {
	v: FVertex[];
	/** Source mesh index, or -1 for cut faces. */
	group: number;
}

interface Plane {
	n: Vec3;
	d: number;
	/** The neighbor seed this bisector separates from (cell planes only). */
	other?: number;
}

/**
 * Makes points within `tol` of each other one point: a cut through a
 * collinear junction meets the same spot from different edges, and the
 * cap's loops chain by exact position.
 */
class PointWelder {
	private readonly grid = new Map<number, Vec3[]>();
	constructor(private readonly tol: number) {}

	private static hash(x: number, y: number, z: number): number {
		return (
			(Math.imul(x, 73856093) ^
				Math.imul(y, 19349663) ^
				Math.imul(z, 83492791)) |
			0
		);
	}

	weld(p: Vec3): Vec3 {
		const t = this.tol;
		const f = [p[0] / t, p[1] / t, p[2] / t];
		const c = f.map(Math.floor) as Vec3;
		// A point within `tol` lies in its own grid cell or the nearer neighbor on each axis.
		const step = f.map((v, k) => (v - c[k]! < 0.5 ? -1 : 1));
		for (let m = 0; m < 8; m++) {
			const x = c[0] + (m & 1 ? step[0]! : 0);
			const y = c[1] + (m & 2 ? step[1]! : 0);
			const z = c[2] + (m & 4 ? step[2]! : 0);
			const hit = this.grid
				.get(PointWelder.hash(x, y, z))
				?.find(
					(q) =>
						Math.abs(q[0] - p[0]) <= t &&
						Math.abs(q[1] - p[1]) <= t &&
						Math.abs(q[2] - p[2]) <= t,
				);
			if (hit) return hit;
		}
		const k = PointWelder.hash(c[0], c[1], c[2]);
		const list = this.grid.get(k);
		if (list) list.push(p);
		else this.grid.set(k, [p]);
		return p;
	}
}

/** Clip tolerances: what counts as on a plane, and the point welder. */
interface ClipContext {
	eps: number;
	welder: PointWelder;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
};
const key = (p: Vec3) => `${p[0]},${p[1]},${p[2]}`;
const lexLess = (a: Vec3, b: Vec3) =>
	a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

// --- Source triangles -------------------------------------------------------

function transformPoint(m: Mat4, p: Vec3): Vec3 {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
	];
}

function transformNormal(m: Mat4, n: Vec3): Vec3 {
	const inv = Matrix4Math.invert(m) ?? Matrix4Math.identity();
	// Inverse transpose, upper 3x3.
	return normalize([
		inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2],
		inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2],
		inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2],
	]);
}

/** Each triangle mesh's rest placement in object space (root transform included). */
function restPlacements(model: Model3DData): Mat4[] {
	const root = model.rootTransform ?? Matrix4Math.identity();
	const world = model.nodes ? poseNodes(model, undefined, 0) : [];
	return model.meshes.map((m) =>
		m.skin === undefined && m.node !== undefined && world[m.node]
			? Matrix4Math.multiply(root, world[m.node]!)
			: root,
	);
}

/** Source triangles in object space, welded: equal positions (to `tol`) become identical. */
function sourcePolys(model: Model3DData, welder: PointWelder): FPoly[] {
	const placements = restPlacements(model);
	const weld = (p: Vec3) => welder.weld(p);
	const polys: FPoly[] = [];
	model.meshes.forEach((mesh, group) => {
		if (mesh.topology && mesh.topology !== "triangle-list") return;
		const m = placements[group]!;
		const vertex = (i: number): FVertex => {
			const pos = mesh.positions;
			const nor = mesh.normals;
			const p = transformPoint(m, [
				pos[i * 3]!,
				pos[i * 3 + 1]!,
				pos[i * 3 + 2]!,
			]);
			return {
				p: weld(p),
				n: nor.length
					? transformNormal(m, [nor[i * 3]!, nor[i * 3 + 1]!, nor[i * 3 + 2]!])
					: [0, -1, 0],
				uv: mesh.uvs.length ? [mesh.uvs[i * 2]!, mesh.uvs[i * 2 + 1]!] : [0, 0],
				c: mesh.colors
					? [
							mesh.colors[i * 4]!,
							mesh.colors[i * 4 + 1]!,
							mesh.colors[i * 4 + 2]!,
							mesh.colors[i * 4 + 3]!,
						]
					: [1, 1, 1, 1],
			};
		};
		const idx = mesh.indices;
		for (let t = 0; t + 2 < idx.length; t += 3) {
			const v = [vertex(idx[t]!), vertex(idx[t + 1]!), vertex(idx[t + 2]!)];
			if (key(v[0]!.p) === key(v[1]!.p) || key(v[1]!.p) === key(v[2]!.p))
				continue;
			if (key(v[0]!.p) === key(v[2]!.p)) continue;
			polys.push({ v, group });
		}
	});
	return polys;
}

/** Every edge shared by exactly two triangles, consistently. */
function isWatertight(polys: FPoly[]): boolean {
	const count = new Map<string, number>();
	for (const poly of polys) {
		const n = poly.v.length;
		for (let i = 0; i < n; i++) {
			const a = key(poly.v[i]!.p);
			const b = key(poly.v[(i + 1) % n]!.p);
			const k = a < b ? `${a}|${b}` : `${b}|${a}`;
			count.set(k, (count.get(k) ?? 0) + 1);
		}
	}
	for (const c of count.values()) if (c !== 2) return false;
	return count.size > 0;
}

/** Ray parity: whether `p` is inside the closed triangle soup. */
function inside(polys: FPoly[], p: Vec3): boolean {
	// An irrational-ish direction misses edges and vertices in practice.
	const dir: Vec3 = normalize([0.5773, 0.6123, 0.5401]);
	let hits = 0;
	for (const poly of polys) {
		const [a, b, c] = poly.v as [FVertex, FVertex, FVertex];
		const e1 = sub(b.p, a.p);
		const e2 = sub(c.p, a.p);
		const h = cross(dir, e2);
		const det = dot(e1, h);
		if (Math.abs(det) < 1e-12) continue;
		const f = 1 / det;
		const s = sub(p, a.p);
		const u = f * dot(s, h);
		if (u < 0 || u > 1) continue;
		const q = cross(s, e1);
		const v = f * dot(dir, q);
		if (v < 0 || u + v > 1) continue;
		if (f * dot(e2, q) > 0) hits++;
	}
	return hits % 2 === 1;
}

// --- Clipping and capping ----------------------------------------------------

/** The point where edge (a, b) meets the plane, from canonically ordered endpoints. */
function cut(
	a: FVertex,
	b: FVertex,
	plane: Plane,
	welder: PointWelder,
): FVertex {
	const [x, y] = lexLess(a.p, b.p) ? [a, b] : [b, a];
	const dx = dot(plane.n, x.p) - plane.d;
	const dy = dot(plane.n, y.p) - plane.d;
	const t = dx / (dx - dy);
	const mix = (u: number, w: number) => u + (w - u) * t;
	return {
		p: welder.weld([
			mix(x.p[0], y.p[0]),
			mix(x.p[1], y.p[1]),
			mix(x.p[2], y.p[2]),
		]),
		n: normalize([
			mix(x.n[0], y.n[0]),
			mix(x.n[1], y.n[1]),
			mix(x.n[2], y.n[2]),
		]),
		uv: [mix(x.uv[0], y.uv[0]), mix(x.uv[1], y.uv[1])],
		c: [
			mix(x.c[0], y.c[0]),
			mix(x.c[1], y.c[1]),
			mix(x.c[2], y.c[2]),
			mix(x.c[3], y.c[3]),
		],
	};
}

class Segments {
	private readonly edges = new Map<string, [FVertex, FVertex]>();

	/** Adds a→b; a pending b→a cancels instead (an edge between two kept faces). */
	add(a: FVertex, b: FVertex): void {
		const ka = key(a.p);
		const kb = key(b.p);
		const reverse = `${kb}|${ka}`;
		if (this.edges.delete(reverse)) return;
		this.edges.set(`${ka}|${kb}`, [a, b]);
	}

	/** Closed loops of points, following a→b. */
	loops(): FVertex[][] {
		const from = new Map<string, [FVertex, FVertex][]>();
		for (const seg of this.edges.values()) {
			const k = key(seg[0].p);
			const list = from.get(k);
			if (list) list.push(seg);
			else from.set(k, [seg]);
		}
		const out: FVertex[][] = [];
		for (const [start, list] of from) {
			while (list.length) {
				const loop = this.walk(start, list.pop()!, from);
				if (loop && loop.length >= 3) out.push(loop);
			}
		}
		return out;
	}

	private walk(
		start: string,
		first: [FVertex, FVertex],
		from: Map<string, [FVertex, FVertex][]>,
	): FVertex[] | undefined {
		const loop: FVertex[] = [first[0]];
		let at = first[1];
		for (let guard = 0; guard < 1_000_000; guard++) {
			const k = key(at.p);
			if (k === start) return loop;
			loop.push(at);
			const next = from.get(k)?.pop();
			if (!next) return undefined;
			at = next[1];
		}
		return undefined;
	}
}

/**
 * Keeps the part of each polygon with n·p ≤ d and returns the cut's boundary
 * segments, oriented so the cap they bound faces +n.
 */
function clipPolys(
	polys: FPoly[],
	plane: Plane,
	ctx: ClipContext,
): { kept: FPoly[]; segments: Segments } {
	const { eps } = ctx;
	const kept: FPoly[] = [];
	const segments = new Segments();
	for (const poly of polys) {
		const dist = poly.v.map((v) => {
			const s = dot(plane.n, v.p) - plane.d;
			return Math.abs(s) <= eps ? 0 : s;
		});
		if (dist.every((s) => s > 0)) continue;
		if (dist.every((s) => s <= 0)) {
			kept.push(poly);
			if (dist.every((s) => s === 0)) continue;
			boundaryOf(poly.v, dist, segments);
			continue;
		}
		const out: FVertex[] = [];
		const on: boolean[] = [];
		const n = poly.v.length;
		for (let i = 0; i < n; i++) {
			const a = poly.v[i]!;
			const b = poly.v[(i + 1) % n]!;
			const da = dist[i]!;
			const db = dist[(i + 1) % n]!;
			if (da <= 0) {
				out.push(a);
				on.push(da === 0);
			}
			if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
				out.push(cut(a, b, plane, ctx.welder));
				on.push(true);
			}
		}
		if (out.length < 3) continue;
		kept.push({ v: out, group: poly.group });
		boundaryOf(
			out,
			on.map((o) => (o ? 0 : -1)),
			segments,
		);
	}
	return { kept, segments };
}

/** Polygon edges lying on the plane, reversed (the cap runs the other way). */
function boundaryOf(v: FVertex[], dist: number[], segments: Segments): void {
	const n = v.length;
	for (let i = 0; i < n; i++) {
		if (dist[i] === 0 && dist[(i + 1) % n] === 0) {
			segments.add(v[(i + 1) % n]!, v[i]!);
		}
	}
}

/** An orthonormal basis (u, v) of the plane with u × v = n. */
function planeBasis(n: Vec3): [Vec3, Vec3] {
	const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const u = normalize(cross(helper, n));
	return [u, cross(n, u)];
}

const signedArea = (pts: [number, number][]) => {
	let a = 0;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i]!;
		const q = pts[(i + 1) % pts.length]!;
		a += p[0] * q[1] - q[0] * p[1];
	}
	return a / 2;
};

function pointInPolygon(
	p: [number, number],
	poly: [number, number][],
): boolean {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i]!;
		const b = poly[j]!;
		if (
			a[1] > p[1] !== b[1] > p[1] &&
			p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
		)
			c = !c;
	}
	return c;
}

/**
 * earcut drops collinear boundary points, but the faces around the cap
 * still end there: split the cap triangle whose edge passes through each
 * dropped point, so the cap meets its neighbors vertex to vertex.
 */
function restoreCollinear(tris: number[], coords: number[]): number[] {
	const n = coords.length / 2;
	const used = new Set(tris);
	const out = tris.slice();
	const x = (i: number) => coords[i * 2]!;
	const y = (i: number) => coords[i * 2 + 1]!;
	for (let m = 0; m < n; m++) {
		if (used.has(m)) continue;
		for (let t = 0; t + 2 < out.length; t += 3) {
			const e = [0, 1, 2].find((k) =>
				onSegment(m, out[t + k]!, out[t + ((k + 1) % 3)]!, x, y),
			);
			if (e === undefined) continue;
			const a = out[t + e]!;
			const b = out[t + ((e + 1) % 3)]!;
			const c = out[t + ((e + 2) % 3)]!;
			out.splice(t, 3, a, m, c);
			out.push(m, b, c);
			used.add(m);
			break;
		}
	}
	return out;
}

function onSegment(
	m: number,
	a: number,
	b: number,
	x: (i: number) => number,
	y: (i: number) => number,
): boolean {
	const abx = x(b) - x(a);
	const aby = y(b) - y(a);
	const len2 = abx * abx + aby * aby;
	if (len2 === 0) return false;
	const t = ((x(m) - x(a)) * abx + (y(m) - y(a)) * aby) / len2;
	if (t <= 0 || t >= 1) return false;
	const crossz = (x(m) - x(a)) * aby - (y(m) - y(a)) * abx;
	return Math.abs(crossz) <= 1e-7 * len2;
}

/** Triangulates the loops of a cut (outer loops counter-clockwise about n, holes clockwise). */
function capPolys(loops: FVertex[][], plane: Plane, uvScale: number): FPoly[] {
	const [u, v] = planeBasis(plane.n);
	const flat = loops.map((loop) =>
		loop.map((x) => [dot(x.p, u), dot(x.p, v)] as [number, number]),
	);
	const areas = flat.map(signedArea);
	const outers = loops.map((_, i) => i).filter((i) => areas[i]! > 0);
	const holesOf = new Map<number, number[]>(outers.map((i) => [i, []]));
	for (let h = 0; h < loops.length; h++) {
		if (areas[h]! >= 0) continue;
		// The smallest outer loop around the hole holds it.
		const owner = outers
			.filter((o) => pointInPolygon(flat[h]![0]!, flat[o]!))
			.sort((a, b) => areas[a]! - areas[b]!)[0];
		if (owner !== undefined) holesOf.get(owner)!.push(h);
	}
	const out: FPoly[] = [];
	const vertexAt = (x: FVertex): FVertex => ({
		p: x.p,
		n: plane.n,
		uv: [dot(x.p, u) / uvScale, dot(x.p, v) / uvScale],
		c: [1, 1, 1, 1],
	});
	for (const o of outers) {
		const ring = [o, ...holesOf.get(o)!];
		const coords: number[] = [];
		const holeStarts: number[] = [];
		const verts: FVertex[] = [];
		for (const r of ring) {
			if (r !== o) holeStarts.push(verts.length);
			for (let k = 0; k < loops[r]!.length; k++) {
				coords.push(...flat[r]![k]!);
				verts.push(loops[r]![k]!);
			}
		}
		const tris = restoreCollinear(
			earcut(coords, holeStarts.length ? holeStarts : undefined, 2),
			coords,
		);
		for (let t = 0; t + 2 < tris.length; t += 3) {
			let a = verts[tris[t]!]!;
			let b = verts[tris[t + 1]!]!;
			const c = verts[tris[t + 2]!]!;
			if (dot(cross(sub(b.p, a.p), sub(c.p, a.p)), plane.n) < 0)
				[a, b] = [b, a];
			out.push({ v: [vertexAt(a), vertexAt(b), vertexAt(c)], group: -1 });
		}
	}
	return out;
}

/** Clips a closed soup by a plane and closes the cut. */
function clipAndCap(
	polys: FPoly[],
	plane: Plane,
	ctx: ClipContext,
	uvScale: number,
): FPoly[] {
	const { kept, segments } = clipPolys(polys, plane, ctx);
	return kept.concat(capPolys(segments.loops(), plane, uvScale));
}

// --- Voronoi cells -----------------------------------------------------------

function boxPolys(min: Vec3, max: Vec3): FPoly[] {
	const c = (x: number, y: number, z: number): FVertex => ({
		p: [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]],
		n: [0, 0, 0],
		uv: [0, 0],
		c: [1, 1, 1, 1],
	});
	// Outward winding: cross(b - a, c - a) points out.
	const quads = [
		[c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
		[c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
		[c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
		[c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
		[c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
		[c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
	];
	return quads.map((v) => ({ v, group: -1 }));
}

/** The planes that bound seed i's Voronoi cell inside the box. */
function cellPlanes(
	seeds: Vec3[],
	i: number,
	min: Vec3,
	max: Vec3,
	eps: number,
): { planes: Plane[]; min: Vec3; max: Vec3 } {
	const s = seeds[i]!;
	const ctx: ClipContext = { eps, welder: new PointWelder(eps * 4) };
	let cell = boxPolys(min, max);
	const planes: Plane[] = [];
	const order = seeds
		.map((p, j) => ({ j, d: Math.hypot(...sub(p, s)) }))
		.filter((o) => o.j !== i && o.d > 0)
		.sort((a, b) => a.d - b.d || a.j - b.j);
	for (const { j, d } of order) {
		let reach = 0;
		for (const poly of cell)
			for (const v of poly.v)
				reach = Math.max(reach, Math.hypot(...sub(v.p, s)));
		// No farther seed's bisector can reach the cell.
		if (d / 2 > reach) break;
		const p = seeds[j]!;
		const n = normalize(sub(p, s));
		const plane: Plane = {
			n,
			d: dot(n, [(p[0] + s[0]) / 2, (p[1] + s[1]) / 2, (p[2] + s[2]) / 2]),
			other: j,
		};
		const cuts = cell.some((poly) =>
			poly.v.some((v) => dot(n, v.p) - plane.d > eps),
		);
		if (!cuts) continue;
		cell = clipAndCap(cell, plane, ctx, 1);
		planes.push(plane);
	}
	const lo: Vec3 = [Infinity, Infinity, Infinity];
	const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const poly of cell)
		for (const v of poly.v)
			for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k]!, v.p[k]!);
				hi[k] = Math.max(hi[k]!, v.p[k]!);
			}
	return { planes, min: lo, max: hi };
}

function gaussian(rand: () => number): number {
	const u = Math.max(1e-12, rand());
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function scatterSeeds(
	polys: FPoly[],
	min: Vec3,
	max: Vec3,
	options: FractureOptions,
	solid: boolean,
): Vec3[] {
	const count = Math.max(2, Math.min(256, Math.round(options.cells ?? 48)));
	const rand = createRandom((options.seed ?? 1) * 92821 + 17);
	const size = sub(max, min);
	const sigma = 0.18 * Math.max(...size);
	const seeds: Vec3[] = [];
	const impact = options.impactPoint;
	for (
		let attempt = 0;
		seeds.length < count && attempt < count * 60;
		attempt++
	) {
		const near = impact && rand() < 0.6;
		const p: Vec3 = near
			? [
					impact[0] + gaussian(rand) * sigma,
					impact[1] + gaussian(rand) * sigma,
					impact[2] + gaussian(rand) * sigma,
				]
			: [
					min[0] + rand() * size[0],
					min[1] + rand() * size[1],
					min[2] + rand() * size[2],
				];
		if (p.some((v, k) => v < min[k]! || v > max[k]!)) continue;
		if (solid && !inside(polys, p)) continue;
		seeds.push(p);
	}
	return seeds;
}

/** Keeps the part of the polygons inside every plane (no caps). */
function clipInside(
	polys: FPoly[],
	planes: Plane[],
	ctx: ClipContext,
): FPoly[] {
	let out = polys;
	for (const plane of planes) {
		if (!out.length) break;
		out = clipPolys(out, plane, ctx).kept;
	}
	return out;
}

/**
 * One cell's piece: the surface inside the cell, plus one face per cell
 * plane, the solid's whole cross-section on that plane (so its loops close
 * and holes nest) clipped to the cell's other planes.
 */
function cellPiece(
	polys: FPoly[],
	cell: { planes: Plane[]; min: Vec3; max: Vec3 },
	ctx: ClipContext,
	pad: number,
	uvScale: number,
	section: (plane: Plane) => FVertex[][],
): FPoly[] {
	const near = polys.filter((poly) =>
		[0, 1, 2].every(
			(k) =>
				poly.v.some((v) => v.p[k]! >= cell.min[k]! - pad) &&
				poly.v.some((v) => v.p[k]! <= cell.max[k]! + pad),
		),
	);
	const piece = clipInside(near, cell.planes, ctx);
	cell.planes.forEach((plane, j) => {
		const loops = section(plane);
		if (!loops.length) return;
		const others = cell.planes.filter((_, k) => k !== j);
		piece.push(...clipInside(capPolys(loops, plane, uvScale), others, ctx));
	});
	return piece;
}

// --- Assembly ----------------------------------------------------------------

/** Volume and center of mass of a closed, outward-wound soup. */
function massProperties(polys: FPoly[]): { volume: number; centroid: Vec3 } {
	let volume = 0;
	const c: Vec3 = [0, 0, 0];
	const avg: Vec3 = [0, 0, 0];
	let count = 0;
	for (const poly of polys) {
		const a = poly.v[0]!.p;
		for (let k = 1; k + 1 < poly.v.length; k++) {
			const b = poly.v[k]!.p;
			const d = poly.v[k + 1]!.p;
			const v = dot(a, cross(b, d)) / 6;
			volume += v;
			for (let i = 0; i < 3; i++) c[i]! += ((a[i]! + b[i]! + d[i]!) / 4) * v;
		}
		for (const x of poly.v) {
			for (let i = 0; i < 3; i++) avg[i]! += x.p[i];
			count++;
		}
	}
	if (Math.abs(volume) > 1e-9) {
		return {
			volume: Math.abs(volume),
			centroid: c.map((x) => x / volume) as Vec3,
		};
	}
	return {
		volume: 0,
		centroid: avg.map((x) => x / Math.max(1, count)) as Vec3,
	};
}

function hullPoints(polys: FPoly[], centroid: Vec3): number[] {
	const seen = new Map<string, Vec3>();
	for (const poly of polys) for (const v of poly.v) seen.set(key(v.p), v.p);
	const pts = [...seen.values()];
	const stride = Math.max(1, Math.ceil(pts.length / 256));
	const out: number[] = [];
	for (let i = 0; i < pts.length; i += stride) {
		out.push(...sub(pts[i]!, centroid));
	}
	return out;
}

class MeshAccumulator {
	positions: number[] = [];
	normals: number[] = [];
	uvs: number[] = [];
	colors: number[] = [];
	joints: number[] = [];
	indices: number[] = [];

	add(poly: FPoly, joint: number): void {
		const base = this.positions.length / 3;
		for (const v of poly.v) {
			this.positions.push(...v.p);
			this.normals.push(...v.n);
			this.uvs.push(...v.uv);
			this.colors.push(...v.c);
			this.joints.push(joint, 0, 0, 0);
		}
		for (let k = 1; k + 1 < poly.v.length; k++) {
			this.indices.push(base, base + k, base + k + 1);
		}
	}

	build(
		name: string,
		materialName: string | undefined,
		colors: boolean,
	): Mesh3DData {
		const n = this.positions.length / 3;
		const weights = new Float32Array(n * 4);
		for (let i = 0; i < n; i++) weights[i * 4] = 1;
		return {
			name,
			positions: new Float32Array(this.positions),
			normals: new Float32Array(this.normals),
			uvs: new Float32Array(this.uvs),
			...(colors && { colors: new Float32Array(this.colors) }),
			indices: new Uint32Array(this.indices),
			jointIndices: new Float32Array(this.joints),
			jointWeights: weights,
			materialName,
			skin: 0,
		};
	}
}

function bounds(meshes: Mesh3DData[]): Model3DData["bounds"] {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const m of meshes)
		for (let i = 0; i < m.positions.length; i += 3)
			for (let k = 0; k < 3; k++) {
				min[k] = Math.min(min[k]!, m.positions[i + k]!);
				max[k] = Math.max(max[k]!, m.positions[i + k]!);
			}
	if (!Number.isFinite(min[0])) {
		min.fill(0);
		max.fill(0);
	}
	const size = sub(max, min);
	return {
		min,
		max,
		center: [
			(min[0] + max[0]) / 2,
			(min[1] + max[1]) / 2,
			(min[2] + max[2]) / 2,
		],
		size,
		boundingSphereRadius: Math.hypot(...size) / 2,
	};
}

function assemble(
	source: Model3DData,
	pieces: { polys: FPoly[]; centroid: Vec3 }[],
	options: FractureOptions,
): Model3DData {
	const groups = new Map<number, MeshAccumulator>();
	pieces.forEach((piece, joint) => {
		for (const poly of piece.polys) {
			let acc = groups.get(poly.group);
			if (!acc) {
				acc = new MeshAccumulator();
				groups.set(poly.group, acc);
			}
			acc.add(poly, joint);
		}
	});
	const materials: Record<string, Material3D> = { ...source.materials };
	const [r, g, b] = parseHexOrRgbColor(options.interiorColor ?? "#d8d2c4");
	materials[FRACTURE_INTERIOR_MATERIAL] = {
		name: FRACTURE_INTERIOR_MATERIAL,
		diffuseColor: [r, g, b, 1],
		roughness: options.interiorRoughness ?? 0.9,
		metallic: 0,
		twoSided: true,
	};
	const meshes: Mesh3DData[] = [...groups.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([group, acc]) => {
			if (group < 0)
				return acc.build(
					"fracture-interior",
					FRACTURE_INTERIOR_MATERIAL,
					false,
				);
			const src = source.meshes[group]!;
			return acc.build(
				src.name ?? `fracture-${group}`,
				src.materialName,
				Boolean(src.colors),
			);
		});
	const nodes: ModelNode3D[] = pieces.map((p, i) => ({
		name: `piece-${i}`,
		parent: -1,
		translation: [...p.centroid],
		rotation: [0, 0, 0, 1],
		scale: [1, 1, 1],
	}));
	const ibm = new Float32Array(pieces.length * 16);
	pieces.forEach((p, i) => {
		ibm.set(
			Matrix4Math.translate(-p.centroid[0], -p.centroid[1], -p.centroid[2]),
			i * 16,
		);
	});
	return {
		name: `${source.name ?? "model"}-fractured`,
		meshes,
		materials,
		nodes,
		skins: [{ joints: nodes.map((_, i) => i), inverseBindMatrices: ibm }],
		animations: [],
		bounds: bounds(meshes),
	};
}

const cache = new WeakMap<Model3DData, Map<string, FracturedModel>>();

/**
 * Breaks a model into Voronoi pieces (cached per model and options). Pieces
 * smaller than a thousandth of the largest are dropped.
 */
export function fractureModel(
	model: Model3DData,
	options: FractureOptions = {},
): FracturedModel {
	const k = JSON.stringify([
		options.cells ?? 48,
		options.seed ?? 1,
		options.impactPoint ?? null,
		options.interiorColor ?? null,
		options.interiorRoughness ?? null,
	]);
	let byKey = cache.get(model);
	if (!byKey) {
		byKey = new Map();
		cache.set(model, byKey);
	}
	const hit = byKey.get(k);
	if (hit) return hit;
	const result = buildFracture(model, options);
	byKey.set(k, result);
	return result;
}

function buildFracture(
	model: Model3DData,
	options: FractureOptions,
): FracturedModel {
	const extent = Math.max(1e-6, model.bounds.boundingSphereRadius * 2);
	const eps = extent * 1e-7;
	const ctx: ClipContext = { eps, welder: new PointWelder(extent * 1e-6) };
	const polys = sourcePolys(model, ctx.welder);
	const lo: Vec3 = [Infinity, Infinity, Infinity];
	const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const poly of polys)
		for (const v of poly.v)
			for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k]!, v.p[k]!);
				hi[k] = Math.max(hi[k]!, v.p[k]!);
			}
	if (!polys.length) return { model: assemble(model, [], options), cells: [] };
	const solid = isWatertight(polys);
	const seeds = scatterSeeds(polys, lo, hi, options, solid);
	const pad = extent * 0.01;
	const boxMin: Vec3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
	const boxMax: Vec3 = [hi[0] + pad, hi[1] + pad, hi[2] + pad];
	// A bisector's cross-section serves both cells it separates, reversed.
	const sections = new Map<string, FVertex[][]>();
	const raw = seeds.map((_, i) => {
		const cell = cellPlanes(seeds, i, boxMin, boxMax, eps);
		const section = (plane: Plane): FVertex[][] => {
			const j = plane.other ?? -1;
			const mine = sections.get(`${i},${j}`);
			if (mine) return mine;
			const theirs = sections.get(`${j},${i}`);
			if (theirs) return theirs.map((loop) => loop.slice().reverse());
			const loops = clipPolys(polys, plane, ctx).segments.loops();
			sections.set(`${i},${j}`, loops);
			return loops;
		};
		return cellPiece(polys, cell, ctx, pad, extent / 4, section);
	});
	const measured = raw
		.filter((p) => p.length > 0)
		.map((p) => ({ polys: p, ...massProperties(p) }));
	const largest = Math.max(0, ...measured.map((m) => m.volume));
	const pieces = measured.filter((m) => !solid || m.volume > largest * 1e-3);
	return {
		model: assemble(model, pieces, options),
		cells: pieces.map((p) => ({
			centroid: p.centroid,
			volume: p.volume,
			hull: hullPoints(p.polys, p.centroid),
		})),
	};
}
