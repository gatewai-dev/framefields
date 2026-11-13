/**
 * A compiled clay program: the packed records, and the brick grid that
 * keeps evaluation local. Every brick stores the short list of records
 * that can change the field inside it (as Slug's bands store the curves
 * that can cross a pixel), and a step scale from the field's Lipschitz
 * bound there. Bricks the surface cannot cross are never drawn.
 */
import type { Rgba } from "../renderer3d/geometry-arrays.js";
import { evalList } from "./eval.js";
import {
	BRICK_BYTES,
	CLAY_EMPTY,
	GROUP_END,
	isWarp,
	MAX_WARPS,
} from "./layout.js";
import {
	type Aabb,
	growBox,
	type OpInfo,
	type PackedProgram,
	packProgram,
} from "./pack.js";
import type { ClayGeometryOptions } from "./program.js";

type V3 = [number, number, number];

/** A brick's list is gathered this far (in brick sizes) past its faces, so normals near a face see the same field. */
const BRICK_MARGIN = 0.05;

const overlaps = (a: Aabb, b: Aabb) =>
	a.min[0] <= b.max[0] &&
	a.max[0] >= b.min[0] &&
	a.min[1] <= b.max[1] &&
	a.max[1] >= b.min[1] &&
	a.min[2] <= b.max[2] &&
	a.max[2] >= b.min[2];

function union(a: Aabb | null, b: Aabb): Aabb {
	if (!a) return { min: [...b.min], max: [...b.max] };
	return {
		min: a.min.map((v, k) => Math.min(v, b.min[k])) as V3,
		max: a.max.map((v, k) => Math.max(v, b.max[k])) as V3,
	};
}

/** The box that holds the sculpture: its added material, moved by what follows. */
function fitBounds(program: PackedProgram, o: ClayGeometryOptions): Aabb {
	if (o.bounds) {
		const h = o.bounds.map((v) => v / 2) as V3;
		return { min: [-h[0], -h[1], -h[2]], max: h };
	}
	let box: Aabb | null = null;
	for (const info of program.info) {
		if (info.solid) box = union(box, info.solid);
		else if (box && info.shift > 0 && (!info.box || overlaps(box, info.box)))
			box = growBox(box, info.shift);
	}
	if (!box) return { min: [-1, -1, -1], max: [1, 1, 1] };
	for (let k = 0; k < 3; k++) {
		if (!(program.symmetry & (1 << k))) continue;
		const far = Math.max(Math.abs(box.min[k]), Math.abs(box.max[k]));
		box.min[k] = -far;
		box.max[k] = far;
	}
	const size = Math.max(...box.max.map((v, k) => v - box.min[k]));
	return growBox(box, size * 0.01 + 1e-3);
}

/** The region of the folded half-space a box covers under mirror symmetry. */
function fold(box: Aabb, symmetry: number): Aabb {
	const out: Aabb = { min: [...box.min], max: [...box.max] };
	for (let k = 0; k < 3; k++) {
		if (!(symmetry & (1 << k))) continue;
		const lo = box.min[k];
		const hi = box.max[k];
		out.min[k] = lo < 0 && hi > 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
		out.max[k] = Math.max(Math.abs(lo), Math.abs(hi));
	}
	return out;
}

interface BrickList {
	entries: number[];
	warps: number;
	/** Lipschitz bound of the field these records make, without its detail. */
	lipschitz: number;
	/** How far detail can move the surface, and the bound with it. */
	relief: number;
	detailed: number;
}

/** How much a warp steepens the field in a region (Lipschitz - 1). */
function stretchIn(op: OpInfo, region: Aabb): number {
	if (!op.stretch) return 0;
	const away = Math.hypot(
		...op.center.map((c, k) =>
			Math.max(region.min[k] - c, 0, c - region.max[k]),
		),
	);
	const at = Math.floor((away / op.reach) * op.stretch.length);
	return at < op.stretch.length ? op.stretch[at] : 0;
}

/**
 * The records that can change the field inside `box`, in program order.
 * Walking backwards, the box grows by what each kept record can move: an
 * earlier record matters if it reaches where the material came from.
 */
function gather(info: OpInfo[], box: Aabb): BrickList {
	const kept: number[] = [];
	const stretch = new Map<number, number>();
	let region = box;
	for (let i = info.length - 1; i >= 0; i--) {
		const op = info[i];
		if (op.box && !overlaps(region, op.box)) continue;
		kept.push(i);
		stretch.set(i, 1 + stretchIn(op, region));
		if (op.shift > 0) region = growBox(region, op.shift);
	}
	kept.reverse();
	let lipschitz = 1;
	let detailed = 1;
	let relief = 0;
	let warps = 0;
	const entries = kept.map((i, at) => {
		const op = info[i];
		const by = stretch.get(i) ?? 1;
		lipschitz = (Math.max(lipschitz, op.lipMax) + op.lipAdd) * by;
		detailed =
			(Math.max(detailed, op.lipMax) + op.lipAdd + op.reliefSlope) * by;
		relief += op.relief;
		if (isWarp(op.type)) warps++;
		const next = kept[at + 1];
		const ends = next === undefined || info[next].group !== op.group;
		return ends ? (i | GROUP_END) >>> 0 : i;
	});
	if (warps > MAX_WARPS) {
		throw new Error(
			`Clay: ${warps} warp steps overlap in one region (limit ${MAX_WARPS}). Use smaller grab / twist / bulge amounts, or spread them out.`,
		);
	}
	return { entries, warps, lipschitz, relief, detailed };
}

interface Sample {
	d: number;
	color: Rgba;
}

export class ClayField {
	readonly ops: Float32Array;
	readonly symmetry: number;
	readonly colored: boolean;
	/** Every cell's list, concatenated: record indices, `GROUP_END` on a group's last. */
	readonly lists: Uint32Array;
	/** The bricks the surface can cross, as the GPU reads them (`BRICK_BYTES` each, see `layout.ts`). */
	readonly bricks: ArrayBuffer;
	readonly brickCount: number;
	/** Per cell: 1 + the index of its brick, 0 where the surface cannot be. */
	readonly grid: Uint32Array;
	/** The grid: its corner, cell size and cell counts. */
	readonly min: V3;
	readonly max: V3;
	readonly brickSize: number;
	readonly dims: V3;
	private cellOffset: Uint32Array;
	private cellCount: Uint32Array;
	private cellWarps: Uint8Array;
	private scratch = new Float64Array(5);

	constructor(options: ClayGeometryOptions) {
		const program = packProgram(options);
		this.ops = program.ops;
		this.symmetry = program.symmetry;
		this.colored = program.colored;

		const bounds = fitBounds(program, options);
		const extent = bounds.max.map((v, k) => v - bounds.min[k]) as V3;
		const along = Math.min(48, Math.max(4, Math.round(options.bricks ?? 16)));
		this.brickSize = Math.max(...extent) / along;
		this.dims = extent.map((e) =>
			Math.max(1, Math.ceil(e / this.brickSize - 1e-6)),
		) as V3;
		this.min = bounds.min;
		this.max = this.dims.map(
			(n, k) => bounds.min[k] + n * this.brickSize,
		) as V3;

		const cells = this.dims[0] * this.dims[1] * this.dims[2];
		this.cellOffset = new Uint32Array(cells);
		this.cellCount = new Uint32Array(cells);
		this.cellWarps = new Uint8Array(cells);
		const lists: number[] = [];
		const bricks: number[][] = [];
		const cellBounds = new Float32Array(cells * 3);
		const s = this.brickSize;
		const margin = s * BRICK_MARGIN;
		const reach = (s / 2 + margin) * Math.sqrt(3);
		for (let cell = 0; cell < cells; cell++) {
			const origin = this.cellOrigin(cell);
			const box = growBox(
				{ min: origin, max: [origin[0] + s, origin[1] + s, origin[2] + s] },
				margin,
			);
			const list = gather(program.info, fold(box, this.symmetry));
			this.cellOffset[cell] = lists.length;
			this.cellCount[cell] = list.entries.length;
			this.cellWarps[cell] = list.warps;
			cellBounds.set([list.lipschitz, list.relief, list.detailed], cell * 3);
			for (const e of list.entries) lists.push(e);
		}
		this.lists = new Uint32Array(lists);
		this.grid = new Uint32Array(cells);
		for (let cell = 0; cell < cells; cell++) {
			const origin = this.cellOrigin(cell);
			const d = this.cellValue(
				cell,
				origin[0] + s / 2,
				origin[1] + s / 2,
				origin[2] + s / 2,
			);
			const [lipschitz, relief, detailed] = cellBounds.subarray(cell * 3);
			// The surface can only cross a brick whose center is this close to
			// it: detail moves it by `relief`, and the value there by as much.
			if (Math.abs(d) <= lipschitz * reach + 2 * relief) {
				this.grid[cell] = bricks.length + 1;
				bricks.push([
					...origin,
					s,
					this.cellOffset[cell],
					this.cellCount[cell],
					this.cellWarps[cell],
					1 / lipschitz,
					relief,
					1 / detailed,
				]);
			}
		}
		this.brickCount = bricks.length;
		this.bricks = new ArrayBuffer(Math.max(1, bricks.length) * BRICK_BYTES);
		const f = new Float32Array(this.bricks);
		const u = new Uint32Array(this.bricks);
		const stride = BRICK_BYTES / 4;
		bricks.forEach((b, i) => {
			f.set(b.slice(0, 4), i * stride);
			u.set(b.slice(4, 7), i * stride + 4);
			f.set(b.slice(7, 10), i * stride + 7);
		});
	}

	private cellOrigin(cell: number): V3 {
		const [nx, ny] = this.dims;
		const i = cell % nx;
		const j = Math.floor(cell / nx) % ny;
		const k = Math.floor(cell / (nx * ny));
		return [
			this.min[0] + i * this.brickSize,
			this.min[1] + j * this.brickSize,
			this.min[2] + k * this.brickSize,
		];
	}

	private cellValue(
		cell: number,
		x: number,
		y: number,
		z: number,
		footprint = 0,
	): number {
		evalList(
			this.ops,
			this.lists,
			this.cellOffset[cell],
			this.cellCount[cell],
			this.cellWarps[cell],
			this.symmetry,
			x,
			y,
			z,
			footprint,
			this.scratch,
		);
		return this.scratch[0];
	}

	/** The cell holding a point (the nearest one outside the grid). */
	private cellAt(x: number, y: number, z: number): number {
		const at = (v: number, k: number) =>
			Math.min(
				this.dims[k] - 1,
				Math.max(0, Math.floor((v - this.min[k]) / this.brickSize)),
			);
		return (at(z, 2) * this.dims[1] + at(y, 1)) * this.dims[0] + at(x, 0);
	}

	/**
	 * Signed distance bound: negative inside the clay. `footprint` is the
	 * size of a pixel at the point (0 = full detail).
	 */
	distance(x: number, y: number, z: number, footprint = 0): number {
		return Math.min(
			this.cellValue(this.cellAt(x, y, z), x, y, z, footprint),
			CLAY_EMPTY,
		);
	}

	sample(x: number, y: number, z: number): Sample {
		const d = this.distance(x, y, z);
		const c = this.scratch;
		return { d, color: [c[1], c[2], c[3], 1] };
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
