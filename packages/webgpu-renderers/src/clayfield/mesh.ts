/**
 * The triangles of a clay field at a chosen resolution: Surface Nets on a
 * lattice that only exists where the surface can be. Each brick the surface
 * can cross is split as an octree down to lattice cells, leaving out every
 * cube the field's Lipschitz bound puts clear of the surface, so the work
 * follows the surface's area and not the volume: a lattice a thousand cells
 * across costs what a dense one of a hundred did.
 */
import {
	emptyArrays,
	type GeometryArrays,
	pushTriangle,
	pushVertex,
	type Rgba,
} from "../renderer3d/geometry-arrays.js";
import { boxUv } from "../renderer3d/sdf-geometry.js";
import type { BrickField, ClayField } from "./field.js";

type V3 = [number, number, number];

/** Lattice cells along the longest side when the program does not say. */
export const CLAY_RESOLUTION = 64;
/** Most lattice cells along a brick's edge. */
const MAX_BRICK_CELLS = 64;

/** A cube's corners, x fastest, and its 12 edges as corner pairs. */
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
/**
 * The four cells around a lattice edge along each axis, in an order that
 * winds toward +axis.
 */
const AROUND: Array<[V3, V3, V3, V3]> = [
	[
		[0, 0, 0],
		[0, -1, 0],
		[0, -1, -1],
		[0, 0, -1],
	],
	[
		[0, 0, 0],
		[0, 0, -1],
		[-1, 0, -1],
		[-1, 0, 0],
	],
	[
		[0, 0, 0],
		[-1, 0, 0],
		[-1, -1, 0],
		[0, -1, 0],
	],
];

/** Lattice cells along a brick's edge for `resolution` cells along the field's longest side. */
export function brickCells(field: ClayField, resolution: number): number {
	const wanted = resolution / Math.max(...field.dims);
	let cells = 1;
	while (cells < wanted && cells < MAX_BRICK_CELLS) cells *= 2;
	return cells;
}

class Mesher {
	readonly out = emptyArrays();
	/** Lattice cell (global key) → its vertex. */
	private vertexOf = new Map<number, number>();
	/** Lattice edges the surface crosses: i, j, k of the start, axis, whether the start is outside. */
	private crossings: number[] = [];
	private h: number;
	/** Lattice points along each axis of the whole grid. */
	private span: V3;
	private side: number;
	/** The brick being meshed: its lattice values (NaN = not evaluated yet). */
	private values: Float32Array;
	private brick!: BrickField;
	private base: V3 = [0, 0, 0];
	private uv: { bounds: V3; center: V3 };

	constructor(
		private field: ClayField,
		private n: number,
	) {
		this.h = field.brickSize / n;
		this.span = field.dims.map((d) => d * n + 1) as V3;
		this.side = n + 1;
		this.values = new Float32Array(this.side ** 3);
		this.uv = {
			bounds: field.max.map((v, k) => v - field.min[k]) as V3,
			center: field.max.map((v, k) => (v + field.min[k]) / 2) as V3,
		};
	}

	private key(i: number, j: number, k: number): number {
		return (k * this.span[1] + j) * this.span[0] + i;
	}

	private point(i: number, j: number, k: number): V3 {
		const { min } = this.field;
		return [min[0] + i * this.h, min[1] + j * this.h, min[2] + k * this.h];
	}

	/** The field at a lattice point of the current brick (local indices). */
	private value(i: number, j: number, k: number): number {
		const at = (k * this.side + j) * this.side + i;
		let v = this.values[at];
		if (Number.isNaN(v)) {
			const [x, y, z] = this.point(
				this.base[0] + i,
				this.base[1] + j,
				this.base[2] + k,
			);
			v = this.brick.value(x, y, z, this.h);
			this.values[at] = v;
		}
		return v;
	}

	meshBrick(cell: number): void {
		const [nx, ny] = this.field.dims;
		this.base = [
			(cell % nx) * this.n,
			(Math.floor(cell / nx) % ny) * this.n,
			Math.floor(cell / (nx * ny)) * this.n,
		];
		// Lattice cells read the field a cell's diagonal past the brick's faces.
		this.brick = this.field.brickField(cell, this.h * Math.sqrt(3));
		this.values.fill(Number.NaN);
		this.visit(0, 0, 0, this.n);
	}

	/** Descends into a cube of `size` lattice cells unless the surface cannot cross it. */
	private visit(i: number, j: number, k: number, size: number): void {
		const half = size / 2;
		const [x, y, z] = this.point(
			this.base[0] + i + half,
			this.base[1] + j + half,
			this.base[2] + k + half,
		);
		const d = Math.abs(this.brick.value(x, y, z, this.h));
		const reach = half * this.h * Math.sqrt(3);
		const { lipschitz, detailed, relief } = this.brick;
		if (d > Math.min(lipschitz * reach + 2 * relief, detailed * reach)) return;
		if (size === 1) {
			this.cell(i, j, k);
			return;
		}
		for (const [a, b, c] of CORNERS)
			this.visit(i + a * half, j + b * half, k + c * half, half);
	}

	/** A lattice cell: its vertex where the surface crosses it, and the crossed edges it owns. */
	private cell(i: number, j: number, k: number): void {
		const v = CORNERS.map(([a, b, c]) => this.value(i + a, j + b, k + c));
		const inside = v[0] < 0;
		if (v.every((value) => value < 0 === inside)) return;
		const g: V3 = [this.base[0] + i, this.base[1] + j, this.base[2] + k];
		this.vertexOf.set(this.key(g[0], g[1], g[2]), this.vertex(g, v));
		// The three edges leaving the cell's first corner are this cell's.
		[1, 2, 4].forEach((other, axis) => {
			if (v[other] < 0 !== inside)
				this.crossings.push(g[0], g[1], g[2], axis, inside ? 0 : 1);
		});
	}

	/** The cell's vertex: the mean of its edges' zero crossings, its normal the lattice gradient. */
	private vertex(g: V3, v: number[]): number {
		const sum: V3 = [0, 0, 0];
		let count = 0;
		for (const [a, b] of EDGES) {
			if (v[a] < 0 === v[b] < 0) continue;
			const t = v[a] / (v[a] - v[b]);
			for (let c = 0; c < 3; c++)
				sum[c] += CORNERS[a][c] + (CORNERS[b][c] - CORNERS[a][c]) * t;
			count++;
		}
		const p = this.point(
			g[0] + sum[0] / count,
			g[1] + sum[1] / count,
			g[2] + sum[2] / count,
		);
		const grad: V3 = [0, 0, 0];
		CORNERS.forEach((corner, at) => {
			for (let c = 0; c < 3; c++) grad[c] += corner[c] ? v[at] : -v[at];
		});
		const len = Math.hypot(grad[0], grad[1], grad[2]) || 1;
		const n: V3 = [grad[0] / len, grad[1] / len, grad[2] / len];
		let color: Rgba | undefined;
		if (this.field.colored) {
			this.brick.value(p[0], p[1], p[2], this.h);
			const c = this.brick.color;
			color = [c[1], c[2], c[3], 1];
		}
		return pushVertex(this.out, p, n, boxUv(p, n, this.uv), color);
	}

	/**
	 * A cell's vertex from the whole program: for a cell around a crossed
	 * edge that its own brick's bounds left out.
	 */
	private rescue(g: V3): number | undefined {
		if (g.some((c, axis) => c < 0 || c >= this.span[axis] - 1))
			return undefined;
		const v = CORNERS.map(([a, b, c]) => {
			const [x, y, z] = this.point(g[0] + a, g[1] + b, g[2] + c);
			return this.field.distance(x, y, z, this.h);
		});
		if (v.every((value) => value < 0 === v[0] < 0)) return undefined;
		const index = this.vertex(g, v);
		this.vertexOf.set(this.key(g[0], g[1], g[2]), index);
		return index;
	}

	/** A quad for every crossed lattice edge, joining the four cells around it. */
	stitch(): void {
		const c = this.crossings;
		for (let e = 0; e < c.length; e += 5) {
			const quad: number[] = [];
			for (const [a, b, d] of AROUND[c[e + 3]]) {
				const g: V3 = [c[e] + a, c[e + 1] + b, c[e + 2] + d];
				const vertex =
					this.vertexOf.get(this.key(g[0], g[1], g[2])) ?? this.rescue(g);
				if (vertex === undefined) break;
				quad.push(vertex);
			}
			if (quad.length < 4) continue;
			// Each cycle winds toward +axis; the surface faces along +axis
			// where the field leaves the solid going that way.
			const flip = c[e + 4] === 1;
			pushTriangle(this.out, quad[0], quad[1], quad[2], flip);
			pushTriangle(this.out, quad[0], quad[2], quad[3], flip);
		}
	}
}

/** The field's surface as triangles, `resolution` lattice cells along its longest side. */
export function meshClay(field: ClayField, resolution: number): GeometryArrays {
	const mesher = new Mesher(field, brickCells(field, resolution));
	field.grid.forEach((brick, cell) => {
		if (brick !== 0) mesher.meshBrick(cell);
	});
	mesher.stitch();
	return mesher.out;
}
