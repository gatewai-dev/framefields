/**
 * The sculpt's field: parts combined in order by hard or smooth unions,
 * cuts and intersections (Quilez's polynomial smooth min / max), each part
 * a shape in its own frame with optional twist, bend and noise detail. A
 * part belongs to a joint (or several), a material and a color, so the
 * same evaluation that places the surface tells skinning which bones move
 * it and which material it is.
 */
import { type ColorInput, linearRgba } from "../color.js";
import type { MaterialRef } from "../document.js";
import type { Vec3 } from "../skeleton.js";
import { Noise3 } from "./noise.js";
import { type Shape, type ShapeField, shapeField } from "./shapes.js";

export type PartOp = "union" | "subtract" | "intersect";

export interface Displacement {
	/** Height of the detail, model units (outward positive). */
	amplitude: number;
	/** Feature size, model units. */
	scale: number;
	/** Default 3. */
	octaves?: number;
	/** Default 0. */
	seed?: number;
}

interface PartOptions {
	/** Name for reports and errors. */
	name?: string;
	/** Where the shape's frame sits in model space. Default the origin. */
	at?: Vec3;
	/** Euler degrees [x, y, z] (applied Z, then Y, then X, like layers). */
	rotation?: Vec3;
	/** How this part combines with every part before it. Default "union". */
	op?: PartOp;
	/** Radius of the smooth join with what came before, model units. Default 0 (a hard edge). */
	blend?: number;
	/**
	 * The joint (or joints, shared by distance to their bones) that moves
	 * this part. Default: the joint whose bone passes nearest the part.
	 */
	joint?: string | string[];
	/** Moves with its joint only, with no blending into neighbors (armor plates, buckles). */
	rigid?: boolean;
	/** How far the part's skin influence reaches past its own surface. Default: its `blend`, at least 1.5 cells. */
	falloff?: number;
	material?: MaterialRef;
	/** Vertex color (display sRGB); blends across smooth joins. */
	color?: ColorInput;
	displace?: Displacement;
	/** Turns about the local y axis, degrees per model unit. */
	twist?: number;
	/** Bends the local y axis toward +x, degrees per model unit. */
	bend?: number;
}

/** A shape placed in the sculpt with how it joins, moves and looks. */
export type Part = Shape & PartOptions;

export interface PreparedPart {
	readonly part: Part;
	readonly index: number;
	readonly op: PartOp;
	readonly k: number;
	/** Bounding sphere in model space. */
	readonly center: Vec3;
	readonly radius: number;
	readonly color: [number, number, number, number] | undefined;
	/** Upper bound on how much faster than 1 per unit the part's field changes. */
	readonly lipschitz: number;
	distance(x: number, y: number, z: number): number;
	/** The part's own point in model space for picking its joint. */
	readonly anchor: Vec3;
}

function rotationRows(deg: Vec3 | undefined): number[] | null {
	if (!deg || (deg[0] === 0 && deg[1] === 0 && deg[2] === 0)) return null;
	const [x, y, z] = deg.map((d) => (d * Math.PI) / 180) as Vec3;
	const cx = Math.cos(x);
	const sx = Math.sin(x);
	const cy = Math.cos(y);
	const sy = Math.sin(y);
	const cz = Math.cos(z);
	const sz = Math.sin(z);
	// R = Rz·Ry·Rx, row-major.
	return [
		cz * cy,
		cz * sy * sx - sz * cx,
		cz * sy * cx + sz * sx,
		sz * cy,
		sz * sy * sx + cz * cx,
		sz * sy * cx - cz * sx,
		-sy,
		cy * sx,
		cy * cx,
	];
}

const DEG = Math.PI / 180;

function prepare(part: Part, index: number): PreparedPart {
	const shape: ShapeField = shapeField(part);
	const at = part.at ?? [0, 0, 0];
	const r = rotationRows(part.rotation);
	const toModel = (p: Vec3): Vec3 =>
		r
			? [
					at[0] +
						(r[0] as number) * p[0] +
						(r[1] as number) * p[1] +
						(r[2] as number) * p[2],
					at[1] +
						(r[3] as number) * p[0] +
						(r[4] as number) * p[1] +
						(r[5] as number) * p[2],
					at[2] +
						(r[6] as number) * p[0] +
						(r[7] as number) * p[1] +
						(r[8] as number) * p[2],
				]
			: [at[0] + p[0], at[1] + p[1], at[2] + p[2]];
	const twist = (part.twist ?? 0) * DEG;
	const bend = (part.bend ?? 0) * DEG;
	const noise = part.displace ? new Noise3(part.displace.seed ?? 0) : null;
	const amp = part.displace?.amplitude ?? 0;
	const freq = part.displace ? 1 / part.displace.scale : 0;
	const octaves = part.displace?.octaves ?? 3;
	const reach = shape.radius + Math.abs(shape.center[1]);
	// Twist and bend stretch space by up to the turn across the part.
	const lipschitz =
		1 +
		Math.abs(twist) * reach +
		Math.abs(bend) * reach +
		amp * freq * 2.5 * octaves;
	const distance = (x: number, y: number, z: number): number => {
		let lx = x - at[0];
		let ly = y - at[1];
		let lz = z - at[2];
		if (r) {
			const tx =
				(r[0] as number) * lx + (r[3] as number) * ly + (r[6] as number) * lz;
			const ty =
				(r[1] as number) * lx + (r[4] as number) * ly + (r[7] as number) * lz;
			const tz =
				(r[2] as number) * lx + (r[5] as number) * ly + (r[8] as number) * lz;
			lx = tx;
			ly = ty;
			lz = tz;
		}
		if (twist) {
			const a = -twist * ly;
			const c = Math.cos(a);
			const s = Math.sin(a);
			const tx = c * lx - s * lz;
			lz = s * lx + c * lz;
			lx = tx;
		}
		if (bend) {
			const a = bend * ly;
			const c = Math.cos(a);
			const s = Math.sin(a);
			const tx = c * lx - s * ly;
			ly = s * lx + c * ly;
			lx = tx;
		}
		let d = shape.distance(lx, ly, lz);
		if (noise) d -= amp * noise.fbm(lx * freq, ly * freq, lz * freq, octaves);
		return d;
	};
	const anchor = toModel(shape.center);
	return {
		part,
		index,
		op: part.op ?? "union",
		k: Math.max(0, part.blend ?? 0),
		center: anchor,
		radius: shape.radius * (1 + Math.abs(bend) * reach) + amp,
		color: part.color === undefined ? undefined : linearRgba(part.color),
		lipschitz,
		distance,
		anchor,
	};
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The composite field of an ordered list of parts. */
export class SculptField {
	readonly parts: PreparedPart[];
	/** The field's worst-case rate of change (1 for plain shapes). */
	readonly lipschitz: number;
	/** The part that owns the surface at the last evaluated point. */
	owner = -1;
	/** The blended linear color at the last point evaluated with color. */
	readonly color: [number, number, number, number] = [1, 1, 1, 1];
	private readonly base: [number, number, number, number];
	/** Per part: the widest blend of it or any part after it. */
	private readonly reach: number[];

	constructor(parts: Part[], base: ColorInput = "#ffffff") {
		if (!parts.length) throw new Error("sculpt: no parts");
		if ((parts[0]?.op ?? "union") !== "union")
			throw new Error("sculpt: the first part must be a union");
		this.parts = parts.map(prepare);
		this.lipschitz = Math.max(...this.parts.map((p) => p.lipschitz));
		this.reach = new Array(this.parts.length);
		let widest = 0;
		for (let i = this.parts.length - 1; i >= 0; i--) {
			widest = Math.max(widest, (this.parts[i] as PreparedPart).k);
			this.reach[i] = widest;
		}
		this.base = linearRgba(base);
	}

	/** Model-space box around every union part. */
	bounds(): { min: Vec3; max: Vec3 } {
		const min: Vec3 = [Infinity, Infinity, Infinity];
		const max: Vec3 = [-Infinity, -Infinity, -Infinity];
		for (const p of this.parts) {
			if (p.op !== "union") continue;
			const r = p.radius + p.k;
			for (let a = 0; a < 3; a++) {
				min[a] = Math.min(min[a] as number, (p.center[a] as number) - r);
				max[a] = Math.max(max[a] as number, (p.center[a] as number) + r);
			}
		}
		return { min, max };
	}

	/**
	 * Parts that can change the surface inside a sphere (`c`, `r`): unions
	 * and cuts whose own surface is out of reach can't, since a smooth join
	 * only acts within its blend radius.
	 */
	relevant(c: Vec3, r: number): number[] {
		const out: number[] = [];
		for (const p of this.parts) {
			if (p.op === "intersect") {
				out.push(p.index);
				continue;
			}
			const gap =
				Math.hypot(c[0] - p.center[0], c[1] - p.center[1], c[2] - p.center[2]) -
				p.radius -
				r;
			// A later smooth join reads what came before within its own radius.
			if (gap <= (this.reach[p.index] as number) + r) out.push(p.index);
		}
		return out;
	}

	/** The field at a point over `subset` (default every part); sets `owner`, and `color` when asked. */
	distance(
		x: number,
		y: number,
		z: number,
		subset?: readonly number[],
		withColor = false,
	): number {
		let d = Number.POSITIVE_INFINITY;
		let owner = -1;
		const color = this.color;
		if (withColor) {
			color[0] = this.base[0];
			color[1] = this.base[1];
			color[2] = this.base[2];
			color[3] = this.base[3];
		}
		const n = subset ? subset.length : this.parts.length;
		for (let i = 0; i < n; i++) {
			const p = this.parts[subset ? (subset[i] as number) : i] as PreparedPart;
			const e = p.distance(x, y, z);
			if (d === Number.POSITIVE_INFINITY) {
				if (p.op === "union") {
					d = e;
					owner = p.index;
					if (withColor && p.color) color.splice(0, 4, ...p.color);
				}
				continue;
			}
			const k = p.k;
			const o = p.op === "subtract" ? -e : e;
			let h: number;
			if (p.op === "union") {
				h = k > 0 ? clamp01(0.5 + (0.5 * (o - d)) / k) : o < d ? 0 : 1;
				d = o + (d - o) * h - k * h * (1 - h);
			} else {
				h = k > 0 ? clamp01(0.5 + (0.5 * (d - o)) / k) : d > o ? 1 : 0;
				d = o + (d - o) * h + k * h * (1 - h);
			}
			// h is the share of what came before; the part owns the surface past half.
			if (h < 0.5 && (p.op === "union" || p.part.material || p.color))
				owner = p.index;
			if (withColor) {
				const c = p.color ?? (p.op === "union" ? this.base : null);
				if (c)
					for (let a = 0; a < 4; a++)
						color[a] =
							(c[a] as number) + ((color[a] as number) - (c[a] as number)) * h;
			}
		}
		this.owner = owner;
		return d;
	}

	/** Unit outward normal from the central-difference gradient, step `e`. */
	normal(
		x: number,
		y: number,
		z: number,
		e: number,
		subset?: readonly number[],
	): Vec3 {
		const gx =
			this.distance(x + e, y, z, subset) - this.distance(x - e, y, z, subset);
		const gy =
			this.distance(x, y + e, z, subset) - this.distance(x, y - e, z, subset);
		const gz =
			this.distance(x, y, z + e, subset) - this.distance(x, y, z - e, subset);
		const len = Math.hypot(gx, gy, gz) || 1;
		return [gx / len, gy / len, gz / len];
	}
}
