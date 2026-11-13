/**
 * Signed distance field sculpting: primitives combined in order by hard or
 * smooth boolean operations (union, subtract, intersect), meshed with Surface
 * Nets into a watertight surface whose normals are the field's gradient.
 * Colored primitives blend where their smooth joins blend.
 *
 * Local space follows the primitives': centered on the origin, up is -y;
 * cylinders and capsules stand along y.
 */
import {
	emptyArrays,
	flatten,
	type GeometryArrays,
	pushTriangle,
	pushVertex,
	type Rgba,
} from "./geometry-arrays.js";
import { parseHexOrRgbColor } from "./text-extruder.js";

export type SdfOp = "union" | "subtract" | "intersect";

interface SdfPrimitiveBase {
	/** How this shape combines with everything before it. Default "union". */
	op?: SdfOp;
	/** Blend radius of the join, px (0 = a hard edge). Default 0. */
	smoothness?: number;
	/** Center, px, in the sculpture's local space. Default [0, 0, 0]. */
	center?: [number, number, number];
	/** Euler degrees [x, y, z]. */
	rotation?: [number, number, number];
	/** Surface color where this shape forms the surface (cuts too). */
	color?: string;
}

export type SdfPrimitive = SdfPrimitiveBase &
	(
		| { shape: "sphere"; radius: number }
		| {
				shape: "box";
				size: [number, number, number];
				/** Corner rounding, px. */
				radius?: number;
		  }
		| { shape: "cylinder" | "capsule"; radius: number; height: number }
		| { shape: "torus"; radius: number; tube: number }
		| {
				shape: "gyroid";
				/** Period of the lattice, px. */
				scale: number;
				/** Wall thickness, px. */
				thickness: number;
		  }
	);

export interface SdfGeometryOptions {
	type: "sdf";
	primitives: SdfPrimitive[];
	/** The sculpture is clipped to this box [width, height, depth], px. */
	bounds: [number, number, number];
	/** Cells along the longest side of `bounds`, 16..160. Default 64. */
	resolution?: number;
	/** Faceted shading. */
	flatShaded?: boolean;
	color?: string;
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	metallic?: number;
}

type V3 = [number, number, number];

interface Prepared {
	prim: SdfPrimitive;
	op: SdfOp;
	k: number;
	center: V3;
	/** Rows of the inverse rotation (world → shape). */
	inv: [V3, V3, V3] | null;
	color: Rgba | undefined;
}

function rotationRows(deg: V3 | undefined): [V3, V3, V3] | null {
	if (!deg || (deg[0] === 0 && deg[1] === 0 && deg[2] === 0)) return null;
	const [x, y, z] = deg.map((d) => (d * Math.PI) / 180) as V3;
	const [cx, sx, cy, sy, cz, sz] = [
		Math.cos(x),
		Math.sin(x),
		Math.cos(y),
		Math.sin(y),
		Math.cos(z),
		Math.sin(z),
	];
	// R = Rz · Ry · Rx (the node transform order); its inverse is its transpose.
	const r: [V3, V3, V3] = [
		[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
		[sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
		[-sy, cy * sx, cy * cx],
	];
	return [
		[r[0][0], r[1][0], r[2][0]],
		[r[0][1], r[1][1], r[2][1]],
		[r[0][2], r[1][2], r[2][2]],
	];
}

function shapeDistance(s: SdfPrimitive, x: number, y: number, z: number) {
	switch (s.shape) {
		case "sphere":
			return Math.hypot(x, y, z) - s.radius;
		case "box": {
			const r = Math.max(0, s.radius ?? 0);
			const qx = Math.abs(x) - s.size[0] / 2 + r;
			const qy = Math.abs(y) - s.size[1] / 2 + r;
			const qz = Math.abs(z) - s.size[2] / 2 + r;
			const outside = Math.hypot(
				Math.max(qx, 0),
				Math.max(qy, 0),
				Math.max(qz, 0),
			);
			return outside + Math.min(Math.max(qx, qy, qz), 0) - r;
		}
		case "cylinder": {
			const dr = Math.hypot(x, z) - s.radius;
			const dy = Math.abs(y) - s.height / 2;
			return (
				Math.min(Math.max(dr, dy), 0) +
				Math.hypot(Math.max(dr, 0), Math.max(dy, 0))
			);
		}
		case "capsule": {
			const half = Math.max(0, s.height / 2 - s.radius);
			const cy = Math.max(-half, Math.min(half, y));
			return Math.hypot(x, y - cy, z) - s.radius;
		}
		case "torus":
			return Math.hypot(Math.hypot(x, z) - s.radius, y) - s.tube;
		case "gyroid": {
			const f = (2 * Math.PI) / Math.max(1e-3, s.scale);
			const g =
				Math.sin(x * f) * Math.cos(y * f) +
				Math.sin(y * f) * Math.cos(z * f) +
				Math.sin(z * f) * Math.cos(x * f);
			// |∇g| peaks near 1.5·f: a conservative distance estimate.
			return Math.abs(g) / (1.5 * f) - s.thickness / 2;
		}
	}
}

interface Sample {
	d: number;
	color: Rgba;
}

/** A signed field Surface Nets can mesh: negative inside. */
export interface SurfaceField {
	/** Whether `sample` returns colors worth storing per vertex. */
	readonly colored: boolean;
	distance(x: number, y: number, z: number): number;
	sample(x: number, y: number, z: number): { color: Rgba };
	/** Unit outward normal, from differences `e` apart. */
	normal(x: number, y: number, z: number, e: number): V3;
}

/** The box a field is meshed in. */
export interface MeshFieldOptions {
	/** [width, height, depth], px. */
	bounds: V3;
	/** The box's center. Default the origin. */
	center?: V3;
	/** Cells along the longest side of `bounds`, 16..160. Default 64. */
	resolution?: number;
	/** Faceted shading. */
	flatShaded?: boolean;
}

/**
 * The composite field. Joins follow Quilez's polynomial smooth min / max;
 * the blend weight `h` they compute also mixes the two sides' colors.
 */
export class SdfField implements SurfaceField {
	private prims: Prepared[];
	private half: V3;
	private base: Rgba;
	readonly colored: boolean;

	constructor(o: SdfGeometryOptions) {
		this.base = parseHexOrRgbColor(o.color ?? "#ffffff");
		this.prims = o.primitives.map((prim) => ({
			prim,
			op: prim.op ?? "union",
			k: Math.max(0, prim.smoothness ?? 0),
			center: prim.center ?? [0, 0, 0],
			inv: rotationRows(prim.rotation),
			color: prim.color ? parseHexOrRgbColor(prim.color) : undefined,
		}));
		this.colored = this.prims.some((p) => p.color);
		this.half = [o.bounds[0] / 2, o.bounds[1] / 2, o.bounds[2] / 2];
	}

	private local(p: Prepared, x: number, y: number, z: number): number {
		const dx = x - p.center[0];
		const dy = y - p.center[1];
		const dz = z - p.center[2];
		if (!p.inv) return shapeDistance(p.prim, dx, dy, dz);
		const [a, b, c] = p.inv;
		return shapeDistance(
			p.prim,
			a[0] * dx + a[1] * dy + a[2] * dz,
			b[0] * dx + b[1] * dy + b[2] * dz,
			c[0] * dx + c[1] * dy + c[2] * dz,
		);
	}

	sample(x: number, y: number, z: number): Sample {
		let d = Number.POSITIVE_INFINITY;
		let color = this.base;
		for (const p of this.prims) {
			const e = this.local(p, x, y, z);
			const c = p.color ?? (p.op === "union" ? this.base : color);
			// The other operand: inverted for a cut.
			const o = p.op === "subtract" ? -e : e;
			if (!Number.isFinite(d)) {
				// Nothing to cut or intersect yet: the first union starts the shape.
				if (p.op === "union") {
					d = e;
					color = c;
				}
				continue;
			}
			const k = p.k;
			if (p.op === "union") {
				const h = k > 0 ? clamp01(0.5 + (0.5 * (o - d)) / k) : o < d ? 0 : 1;
				d = o + (d - o) * h - k * h * (1 - h);
				color = mixRgba(c, color, h);
			} else {
				const h = k > 0 ? clamp01(0.5 + (0.5 * (d - o)) / k) : d > o ? 1 : 0;
				d = o + (d - o) * h + k * h * (1 - h);
				color = mixRgba(c, color, h);
			}
		}
		// Clipped to the bounds box: the mesh always closes.
		const [hx, hy, hz] = this.half;
		const qx = Math.abs(x) - hx;
		const qy = Math.abs(y) - hy;
		const qz = Math.abs(z) - hz;
		const box =
			Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
			Math.min(Math.max(qx, qy, qz), 0);
		return { d: Math.max(d, box), color };
	}

	distance(x: number, y: number, z: number): number {
		return this.sample(x, y, z).d;
	}

	/** Unit outward normal: the normalized central-difference gradient. */
	normal(x: number, y: number, z: number, e: number): V3 {
		const gx = this.distance(x + e, y, z) - this.distance(x - e, y, z);
		const gy = this.distance(x, y + e, z) - this.distance(x, y - e, z);
		const gz = this.distance(x, y, z + e) - this.distance(x, y, z - e);
		const len = Math.hypot(gx, gy, gz) || 1;
		return [gx / len, gy / len, gz / len];
	}
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mixRgba = (a: Rgba, b: Rgba, t: number): Rgba => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t,
	a[3] + (b[3] - a[3]) * t,
];

interface Grid {
	nx: number;
	ny: number;
	nz: number;
	cell: number;
	origin: V3;
	values: Float32Array;
}

/** Field values on a lattice that covers the bounds with one cell to spare on every side. */
function sampleGrid(field: SurfaceField, o: MeshFieldOptions): Grid {
	const res = Math.min(160, Math.max(16, Math.round(o.resolution ?? 64)));
	const cell = Math.max(...o.bounds) / res;
	const count = (s: number) => Math.ceil(s / cell) + 3;
	const [nx, ny, nz] = [
		count(o.bounds[0]),
		count(o.bounds[1]),
		count(o.bounds[2]),
	];
	const center = o.center ?? [0, 0, 0];
	const origin: V3 = [
		center[0] - ((nx - 1) * cell) / 2,
		center[1] - ((ny - 1) * cell) / 2,
		center[2] - ((nz - 1) * cell) / 2,
	];
	const values = new Float32Array(nx * ny * nz);
	for (let k = 0; k < nz; k++) {
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				values[(k * ny + j) * nx + i] = field.distance(
					origin[0] + i * cell,
					origin[1] + j * cell,
					origin[2] + k * cell,
				);
			}
		}
	}
	return { nx, ny, nz, cell, origin, values };
}

const CORNERS: V3[] = [
	[0, 0, 0],
	[1, 0, 0],
	[0, 1, 0],
	[1, 1, 0],
	[0, 0, 1],
	[1, 0, 1],
	[0, 1, 1],
	[1, 1, 1],
];
/** The cube's 12 edges as corner index pairs. */
const EDGES: Array<[number, number]> = [
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

/** The surface point of a cell: the mean of its edges' zero crossings. */
function cellPoint(g: Grid, i: number, j: number, k: number): V3 | null {
	const vals = CORNERS.map(
		([a, b, c]) => g.values[((k + c) * g.ny + j + b) * g.nx + i + a]!,
	);
	let sum: V3 = [0, 0, 0];
	let n = 0;
	for (const [a, b] of EDGES) {
		const va = vals[a]!;
		const vb = vals[b]!;
		if (va < 0 === vb < 0) continue;
		const t = va / (va - vb);
		const ca = CORNERS[a]!;
		const cb = CORNERS[b]!;
		sum = [
			sum[0] + ca[0] + (cb[0] - ca[0]) * t,
			sum[1] + ca[1] + (cb[1] - ca[1]) * t,
			sum[2] + ca[2] + (cb[2] - ca[2]) * t,
		];
		n++;
	}
	if (n === 0) return null;
	return [
		g.origin[0] + (i + sum[0] / n) * g.cell,
		g.origin[1] + (j + sum[1] / n) * g.cell,
		g.origin[2] + (k + sum[2] / n) * g.cell,
	];
}

/** Box-projected UVs: the face of `bounds` the normal points at. */
export function boxUv(at: V3, n: V3, o: MeshFieldOptions): [number, number] {
	const { bounds, center = [0, 0, 0] } = o;
	const p: V3 = [at[0] - center[0], at[1] - center[1], at[2] - center[2]];
	const ax = Math.abs(n[0]);
	const ay = Math.abs(n[1]);
	const az = Math.abs(n[2]);
	const u = (v: number, s: number) => v / s + 0.5;
	if (ay >= ax && ay >= az) return [u(p[0], bounds[0]), u(p[2], bounds[2])];
	if (ax >= az) return [u(p[2], bounds[2]), u(p[1], bounds[1])];
	return [u(p[0], bounds[0]), u(p[1], bounds[1])];
}

/** One vertex per surface cell, normal from the field's gradient. */
function placeVertices(
	g: Grid,
	field: SurfaceField,
	o: MeshFieldOptions,
	out: GeometryArrays,
): Int32Array {
	const index = new Int32Array((g.nx - 1) * (g.ny - 1) * (g.nz - 1)).fill(-1);
	for (let k = 0; k < g.nz - 1; k++) {
		for (let j = 0; j < g.ny - 1; j++) {
			for (let i = 0; i < g.nx - 1; i++) {
				const p = cellPoint(g, i, j, k);
				if (!p) continue;
				const n = field.normal(p[0], p[1], p[2], g.cell * 0.5);
				const color = field.colored
					? field.sample(p[0], p[1], p[2]).color
					: undefined;
				index[(k * (g.ny - 1) + j) * (g.nx - 1) + i] = pushVertex(
					out,
					p,
					n,
					boxUv(p, n, o),
					color,
				);
			}
		}
	}
	return index;
}

/**
 * A quad for every lattice edge the surface crosses, joining the four
 * cells around it; it faces from inside (negative) to outside.
 */
function stitch(g: Grid, index: Int32Array, out: GeometryArrays): void {
	const cx = g.nx - 1;
	const cy = g.ny - 1;
	const cell = (i: number, j: number, k: number) =>
		index[(k * cy + j) * cx + i]!;
	const value = (i: number, j: number, k: number) =>
		g.values[(k * g.ny + j) * g.nx + i]!;
	const axes: Array<{
		step: V3;
		around: [V3, V3, V3, V3];
	}> = [
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
	for (let k = 1; k < g.nz - 1; k++) {
		for (let j = 1; j < g.ny - 1; j++) {
			for (let i = 1; i < g.nx - 1; i++) {
				const v0 = value(i, j, k);
				for (const { step, around } of axes) {
					const v1 = value(i + step[0], j + step[1], k + step[2]);
					if (v0 < 0 === v1 < 0) continue;
					const q = around.map(([a, b, c]) => cell(i + a, j + b, k + c));
					if (q.some((v) => v < 0)) continue;
					// Each `around` cycle winds toward +axis; the surface faces
					// along +axis where the field leaves the solid going that way.
					const flip = v0 >= 0;
					pushTriangle(out, q[0]!, q[1]!, q[2]!, flip);
					pushTriangle(out, q[0]!, q[2]!, q[3]!, flip);
				}
			}
		}
	}
}

/** Surface Nets: a watertight mesh of the field's zero surface inside the box. */
export function meshField(
	field: SurfaceField,
	o: MeshFieldOptions,
): GeometryArrays {
	const grid = sampleGrid(field, o);
	const out = emptyArrays();
	const index = placeVertices(grid, field, o, out);
	stitch(grid, index, out);
	return o.flatShaded ? flatten(out) : out;
}

/** Builds the sculpture's vertex arrays. */
export function buildSdf(o: SdfGeometryOptions): GeometryArrays {
	return meshField(new SdfField(o), o);
}
