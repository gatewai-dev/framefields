/**
 * Procedural surface scattering: deterministic points on any mesh (terrain,
 * SDF sculpture, primitive or loaded model), sampled by triangle area,
 * filtered by slope, altitude and exclusion zones, spaced by a Poisson-disk
 * test on a spatial hash, and oriented between world up and the surface.
 */

import { poseNodes, type Quat } from "../loaders/pose.js";
import type { Model3DData } from "../loaders/types.js";
import { type Mat4, Matrix4Math } from "../math3d/matrix4.js";
import { createRandom } from "../math3d/noise.js";

type V3 = [number, number, number];

export interface ScatterExclusion {
	/** Center in the surface's parent space, px. */
	x: number;
	z: number;
	/** Nothing grows inside this radius, px. */
	radius: number;
	/** Density ramps back to full over this many px past `radius`. Default 0. */
	falloff?: number;
}

export interface ScatterOptions {
	/** Points to place (fewer when spacing or filters leave no room). */
	count: number;
	/** Poisson-disk spacing: no two points closer than this, px. */
	minDistance?: number;
	seed?: number;
	/** Allowed slope in degrees from level ground. Default [0, 89]. */
	slopeRange?: [number, number];
	/** Allowed altitude 0..1 across the surface's vertical extent (0 = lowest). Default [0, 1]. */
	elevationRange?: [number, number];
	/** 0 keeps instances upright, 1 stands them on the surface normal. Default 0.3. */
	alignToNormal?: number;
	/** Uniform scale drawn per point. Default [1, 1]. */
	scaleRange?: [number, number];
	/** Random turn around the instance's up axis. Default true. */
	randomYaw?: boolean;
	exclude?: ScatterExclusion[];
}

export interface ScatterPoint {
	/** On the surface, in its parent space. */
	position: V3;
	/** Unit face normal there. */
	normal: V3;
	rotation: Quat;
	scale: number;
	/** Normalized altitude 0..1. */
	elevation: number;
}

export interface ScatterSurface {
	model: Model3DData;
	/** The surface layer's transform (its parent space ← model space). */
	matrix?: Mat4;
}

export interface ScatterResult {
	points: ScatterPoint[];
	/** Share of the surface's area its slope and altitude filters keep, 0..1. */
	acceptedArea: number;
}

const UP: V3 = [0, -1, 0];

function transformPoint(m: Mat4, x: number, y: number, z: number): V3 {
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
	];
}

/** Every triangle of the model in the surface's parent space, flat xyz × 3. */
export function surfaceTriangles(surface: ScatterSurface): Float64Array {
	const { model } = surface;
	const root = Matrix4Math.multiply(
		surface.matrix ?? Matrix4Math.identity(),
		model.rootTransform ?? Matrix4Math.identity(),
	);
	const posed = model.nodes ? poseNodes(model, undefined, 0) : undefined;
	const tris: number[] = [];
	for (const mesh of model.meshes) {
		if (mesh.topology && mesh.topology !== "triangle-list") continue;
		const node =
			posed && mesh.node !== undefined && mesh.skin === undefined
				? posed[mesh.node]
				: undefined;
		const m = node ? Matrix4Math.multiply(root, node) : root;
		const p = mesh.positions;
		for (const i of mesh.indices) {
			tris.push(...transformPoint(m, p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!));
		}
	}
	return new Float64Array(tris);
}

function quatMul(a: Quat, b: Quat): Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

/** Shortest rotation taking unit `a` onto unit `b`. */
function quatBetween(a: V3, b: V3): Quat {
	const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	if (d < -0.999999) return [1, 0, 0, 0];
	const c: V3 = [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
	const q: Quat = [c[0], c[1], c[2], 1 + d];
	const len = Math.hypot(...q);
	return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Rotates `v` by unit quaternion `q`. */
export function rotateByQuat(q: Quat, v: V3): V3 {
	const t: V3 = [
		2 * (q[1] * v[2] - q[2] * v[1]),
		2 * (q[2] * v[0] - q[0] * v[2]),
		2 * (q[0] * v[1] - q[1] * v[0]),
	];
	return [
		v[0] + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]),
		v[1] + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]),
		v[2] + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0]),
	];
}

interface Candidates {
	/** Accepted triangle indices and their cumulative areas. */
	tris: Int32Array;
	cumulative: Float64Array;
	normals: Float64Array;
	minY: number;
	maxY: number;
	acceptedArea: number;
}

/** Face normal of triangle `t`, and its area. */
function face(tri: Float64Array, t: number): { n: V3; area: number } {
	const o = t * 9;
	const ex = tri[o + 3]! - tri[o]!;
	const ey = tri[o + 4]! - tri[o + 1]!;
	const ez = tri[o + 5]! - tri[o + 2]!;
	const fx = tri[o + 6]! - tri[o]!;
	const fy = tri[o + 7]! - tri[o + 1]!;
	const fz = tri[o + 8]! - tri[o + 2]!;
	const c: V3 = [ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx];
	const len = Math.hypot(...c);
	return {
		n: len > 0 ? [c[0] / len, c[1] / len, c[2] / len] : [0, -1, 0],
		area: len / 2,
	};
}

/** The triangles the slope and altitude filters keep, weighted by area. */
function candidates(tri: Float64Array, o: ScatterOptions): Candidates {
	const count = tri.length / 9;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 1; i < tri.length; i += 3) {
		minY = Math.min(minY, tri[i]!);
		maxY = Math.max(maxY, tri[i]!);
	}
	const spanY = maxY - minY > 1e-9 ? maxY - minY : 1;
	const [s0, s1] = o.slopeRange ?? [0, 89];
	const [e0, e1] = o.elevationRange ?? [0, 1];
	const keep: number[] = [];
	const cumulative: number[] = [];
	const normals: number[] = [];
	let total = 0;
	let all = 0;
	for (let t = 0; t < count; t++) {
		const { n, area } = face(tri, t);
		all += area;
		if (area <= 0) continue;
		const slope = (Math.acos(Math.max(-1, Math.min(1, -n[1]))) * 180) / Math.PI;
		const cy = (tri[t * 9 + 1]! + tri[t * 9 + 4]! + tri[t * 9 + 7]!) / 3;
		const elevation = (maxY - cy) / spanY;
		if (slope < s0 || slope > s1 || elevation < e0 || elevation > e1) continue;
		total += area;
		keep.push(t);
		cumulative.push(total);
		normals.push(...n);
	}
	return {
		tris: Int32Array.from(keep),
		cumulative: Float64Array.from(cumulative),
		normals: Float64Array.from(normals),
		minY,
		maxY,
		acceptedArea: all > 0 ? total / all : 0,
	};
}

/** Index of the first cumulative area above `x`. */
function pick(cumulative: Float64Array, x: number): number {
	let lo = 0;
	let hi = cumulative.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cumulative[mid]! > x) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

/** Whether exclusion zones let a point at (x, z) grow, given a uniform draw `r`. */
function allowed(
	zones: ScatterExclusion[] | undefined,
	x: number,
	z: number,
	r: number,
): boolean {
	for (const e of zones ?? []) {
		const d = Math.hypot(x - e.x, z - e.z) - e.radius;
		if (d < 0) return false;
		const f = e.falloff ?? 0;
		if (f > 0 && d < f && r > d / f) return false;
	}
	return true;
}

/** A spatial hash of accepted points, for the Poisson-disk distance test. */
class PoissonGrid {
	private cells = new Map<string, V3[]>();
	constructor(private spacing: number) {}

	private key(x: number, y: number, z: number): string {
		const s = this.spacing;
		return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
	}

	fits(p: V3): boolean {
		const s = this.spacing;
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (let dz = -1; dz <= 1; dz++) {
					const near = this.cells.get(
						this.key(p[0] + dx * s, p[1] + dy * s, p[2] + dz * s),
					);
					for (const q of near ?? []) {
						if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < s)
							return false;
					}
				}
		return true;
	}

	add(p: V3): void {
		const k = this.key(...p);
		const list = this.cells.get(k);
		if (list) list.push(p);
		else this.cells.set(k, [p]);
	}
}

function orient(n: V3, o: ScatterOptions, rand: () => number): Quat {
	const a = Math.max(0, Math.min(1, o.alignToNormal ?? 0.3));
	const u: V3 = [
		UP[0] + (n[0] - UP[0]) * a,
		UP[1] + (n[1] - UP[1]) * a,
		UP[2] + (n[2] - UP[2]) * a,
	];
	const len = Math.hypot(...u) || 1;
	const align = quatBetween(UP, [u[0] / len, u[1] / len, u[2] / len]);
	const yaw = (o.randomYaw ?? true) ? rand() * Math.PI * 2 : 0;
	// Turn around the instance's own up (-y) first, then lean onto the surface.
	const spin: Quat = [0, -Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
	return quatMul(align, spin);
}

/** Scatters points on `surface`. Same inputs, same points. */
export function scatterOnSurface(
	surface: ScatterSurface,
	o: ScatterOptions,
): ScatterResult {
	const tri = surfaceTriangles(surface);
	const c = candidates(tri, o);
	const points: ScatterPoint[] = [];
	const total = c.cumulative[c.cumulative.length - 1] ?? 0;
	const count = Math.max(0, Math.floor(o.count));
	if (total <= 0 || count === 0)
		return { points, acceptedArea: c.acceptedArea };
	const rand = createRandom(o.seed ?? 1);
	const spacing = Math.max(0, o.minDistance ?? 0);
	const poisson = spacing > 0 ? new PoissonGrid(spacing) : undefined;
	const [sc0, sc1] = o.scaleRange ?? [1, 1];
	const spanY = c.maxY - c.minY > 1e-9 ? c.maxY - c.minY : 1;
	const attempts = count * 30;
	for (let a = 0; a < attempts && points.length < count; a++) {
		const k = pick(c.cumulative, rand() * total);
		const t = c.tris[k]! * 9;
		// Uniform on the triangle.
		const r1 = Math.sqrt(rand());
		const r2 = rand();
		const w0 = 1 - r1;
		const w1 = r1 * (1 - r2);
		const w2 = r1 * r2;
		const p: V3 = [0, 1, 2].map(
			(d) => w0 * tri[t + d]! + w1 * tri[t + 3 + d]! + w2 * tri[t + 6 + d]!,
		) as V3;
		const gate = rand();
		const yawDraw = createRandom(Math.floor(rand() * 2 ** 31));
		const scaleDraw = rand();
		if (!allowed(o.exclude, p[0], p[2], gate)) continue;
		if (poisson && !poisson.fits(p)) continue;
		poisson?.add(p);
		const n: V3 = [
			c.normals[k * 3]!,
			c.normals[k * 3 + 1]!,
			c.normals[k * 3 + 2]!,
		];
		points.push({
			position: p,
			normal: n,
			rotation: orient(n, o, yawDraw),
			scale: sc0 + (sc1 - sc0) * scaleDraw,
			elevation: (c.maxY - p[1]) / spanY,
		});
	}
	return { points, acceptedArea: c.acceptedArea };
}

/**
 * Where an instance's origin goes so its lowest point (local max y, as up
 * is -y) rests on the scattered point, sunk `sink` px into the surface.
 */
export function seatOnSurface(
	point: ScatterPoint,
	bottomY: number,
	sink = 0,
): V3 {
	const lift = rotateByQuat(point.rotation, [
		0,
		bottomY * point.scale - sink,
		0,
	]);
	return [
		point.position[0] - lift[0],
		point.position[1] - lift[1],
		point.position[2] - lift[2],
	];
}
