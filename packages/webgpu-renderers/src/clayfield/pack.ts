/**
 * Packs a clay program into the flat operation records the evaluators read
 * (see `layout.ts`), and works out what binning needs to know about each
 * record: where it can matter, how far it can move the surface, and how
 * much it can steepen the field.
 */
import type { Rgba } from "../renderer3d/geometry-arrays.js";
import { parseHexOrRgbColor } from "../renderer3d/text-extruder.js";
import { OP, OP_FLOATS } from "./layout.js";
import type {
	ClayDetail,
	ClayGeometryOptions,
	ClayInflate,
	ClayMode,
	ClayOp,
	ClaySolid,
	ClayStroke,
	ClayWarp,
} from "./program.js";
import { warpStretch } from "./warp-bounds.js";

type V3 = [number, number, number];

const MODES: Record<ClayMode, number> = { add: 0, carve: 1, intersect: 2 };

/** Most a warp's displacement may change per unit distance: larger pushes are applied in steps. */
const MAX_WARP_GRADIENT = 0.4;
/** Largest gradient of each unit Kelvinlet, and of the fade window (per 1 / reach): they size the steps. */
const GRAB_GRADIENT = 0.6111;
const SPIN_GRADIENT = 1;
const SPIN_DISPLACEMENT = 0.3188;
const WINDOW_GRADIENT = 1.54;
/**
 * Largest gradient of one octave of the lattice noise (`noise3`), measured
 * over 4e5 points (3.62). Octaves add as a root sum of squares: their
 * steepest points do not line up (measured 7.15 for four, against 7.4).
 */
const NOISE_GRADIENT = 3.7;

export interface Aabb {
	min: V3;
	max: V3;
}

/** What binning knows about one record. */
export interface OpInfo {
	type: number;
	/** Segments of one stroke share a group: they are joined before the stroke meets the field. */
	group: number;
	/** Where the record can change the field; null = everywhere. */
	box: Aabb | null;
	/** Material added here (for fitting bounds), without the join's blend. */
	solid: Aabb | null;
	/** How far the record can move the surface, px. */
	shift: number;
	/** The field's Lipschitz bound becomes max(L, lipMax) + lipAdd. */
	lipMax: number;
	lipAdd: number;
	/**
	 * Warps: how much the field steepens (Lipschitz - 1) at each distance
	 * from `center` or farther, evenly spaced out to `reach`.
	 */
	stretch: Float32Array | null;
	center: V3;
	reach: number;
	/**
	 * Detail: how far it can move the surface, and the slope it adds. Kept
	 * apart from the bound above: detail is marched as a shell of this
	 * thickness around the smooth field.
	 */
	relief: number;
	reliefSlope: number;
}

export interface PackedProgram {
	ops: Float32Array;
	info: OpInfo[];
	/** Bit 0 = x, 1 = y, 2 = z. */
	symmetry: number;
	colored: boolean;
}

const sphereBox = (c: V3, r: number): Aabb => ({
	min: [c[0] - r, c[1] - r, c[2] - r],
	max: [c[0] + r, c[1] + r, c[2] + r],
});

export const growBox = (b: Aabb, by: number): Aabb => ({
	min: [b.min[0] - by, b.min[1] - by, b.min[2] - by],
	max: [b.max[0] + by, b.max[1] + by, b.max[2] + by],
});

/** The inverse of R = Rz · Ry · Rx (the node transform order) as a quaternion. */
function inverseRotation(
	deg: V3 | undefined,
): [number, number, number, number] {
	if (!deg || (deg[0] === 0 && deg[1] === 0 && deg[2] === 0))
		return [0, 0, 0, 1];
	const [hx, hy, hz] = deg.map((d) => (d * Math.PI) / 360) as V3;
	const [sx, cx, sy, cy, sz, cz] = [
		Math.sin(hx),
		Math.cos(hx),
		Math.sin(hy),
		Math.cos(hy),
		Math.sin(hz),
		Math.cos(hz),
	];
	// qz ⊗ qy ⊗ qx, conjugated.
	return [
		-(cz * cy * sx - sz * sy * cx),
		-(cz * sy * cx + sz * cy * sx),
		-(sz * cy * cx - cz * sy * sx),
		cz * cy * cx + sz * sy * sx,
	];
}

class Packer {
	readonly floats: number[] = [];
	readonly info: OpInfo[] = [];
	colored = false;
	private groups = 0;

	nextGroup(): number {
		return this.groups++;
	}

	/** Appends a record; returns it as the evaluators will read it. */
	push(
		head: [number, number, number],
		p1: number[],
		p2: number[],
		p3: number[],
		color: Rgba | undefined,
		info: Omit<OpInfo, "type">,
	): Float32Array {
		const pad = (v: number[]) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
		this.floats.push(
			...head,
			0,
			...pad(p1),
			...pad(p2),
			...pad(p3),
			...(color ?? [1, 1, 1, 1]),
		);
		this.info.push({ type: head[0], ...info });
		return new Float32Array(this.floats.slice(-OP_FLOATS));
	}
}

const NEUTRAL = {
	shift: 0,
	lipMax: 1,
	lipAdd: 0,
	stretch: null,
	center: [0, 0, 0] as V3,
	reach: 0,
	relief: 0,
	reliefSlope: 0,
};

function materialHead(
	type: number,
	op: { mode?: ClayMode; smoothness?: number },
): [number, number, number] {
	return [type, MODES[op.mode ?? "add"], Math.max(0, op.smoothness ?? 0)];
}

/**
 * An operation's color. Without one, added material is white (the node's
 * color tints it) and a cut keeps the color of what it cuts: alpha 0.
 */
function materialColor(
	p: Packer,
	op: { mode?: ClayMode; color?: string },
): Rgba {
	if (!op.color) return [1, 1, 1, (op.mode ?? "add") === "add" ? 1 : 0];
	p.colored = true;
	const [r, g, b] = parseHexOrRgbColor(op.color);
	return [r, g, b, 1];
}

/** [size parameter, shape vec4, bounding radius] of a solid. */
function solidShape(s: ClaySolid): [number, number[], number] {
	switch (s.type) {
		case "sphere":
			return [s.radius, [], s.radius];
		case "box": {
			const h = s.size.map((v) => v / 2);
			return [Math.max(0, s.radius ?? 0), h, Math.hypot(h[0], h[1], h[2])];
		}
		case "cylinder":
			return [s.radius, [s.height / 2], Math.hypot(s.radius, s.height / 2)];
		case "capsule": {
			const half = Math.max(0, s.height / 2 - s.radius);
			return [s.radius, [half], half + s.radius];
		}
		case "torus":
			return [s.radius, [s.tube], s.radius + s.tube];
	}
}

function packSolid(p: Packer, s: ClaySolid): void {
	const center = s.center ?? [0, 0, 0];
	const [size, shape, reach] = solidShape(s);
	const head = materialHead(OP[s.type], s);
	const solid = sphereBox(center, reach);
	p.push(
		head,
		[...center, size],
		inverseRotation(s.rotation),
		shape,
		materialColor(p, s),
		{
			...NEUTRAL,
			group: p.nextGroup(),
			// An intersection removes everything outside it: it matters everywhere.
			box: s.mode === "intersect" ? null : growBox(solid, head[2]),
			solid: (s.mode ?? "add") === "add" ? growBox(solid, head[2] / 4) : null,
		},
	);
}

type Knot = [number, number, number, number];

const mid = (a: Knot, b: Knot): Knot => [
	(a[0] + b[0]) / 2,
	(a[1] + b[1]) / 2,
	(a[2] + b[2]) / 2,
	(a[3] + b[3]) / 2,
];

/**
 * The stroke as quadratic Béziers: each inner point is a control point, the
 * curve passes through the midpoints between them and ends on the first and
 * last points, so it is smooth however the points are placed.
 */
function strokeSegments(knots: Knot[]): Array<[Knot, Knot, Knot]> {
	if (knots.length === 1) return [[knots[0], knots[0], knots[0]]];
	if (knots.length === 2)
		return [[knots[0], mid(knots[0], knots[1]), knots[1]]];
	const out: Array<[Knot, Knot, Knot]> = [];
	let from = knots[0];
	for (let i = 1; i < knots.length - 1; i++) {
		const to =
			i === knots.length - 2 ? knots[i + 1] : mid(knots[i], knots[i + 1]);
		out.push([from, knots[i], to]);
		from = to;
	}
	return out;
}

const dist3 = (a: number[], b: number[]) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function packStroke(p: Packer, s: ClayStroke): void {
	const knots = s.path.map((q): Knot => [q[0], q[1], q[2], q[3] ?? s.radius]);
	if (knots.length === 0) return;
	const segments = strokeSegments(knots);
	const lengths = segments.map(([a, b, c]) =>
		Math.max(1e-6, dist3(a, b) + dist3(b, c)),
	);
	const drawn =
		Math.min(1, Math.max(0, s.progress ?? 1)) *
		lengths.reduce((sum, l) => sum + l, 0);
	const head = materialHead(OP.segment, s);
	const color = materialColor(p, s);
	const group = p.nextGroup();
	let start = 0;
	segments.forEach(([a, b, c], i) => {
		const limit = Math.min(1, (drawn - start) / lengths[i]);
		start += lengths[i];
		if (limit <= 0) return;
		const r = Math.max(a[3], c[3]);
		const hull: Aabb = {
			min: [0, 1, 2].map((k) => Math.min(a[k], b[k], c[k]) - r) as V3,
			max: [0, 1, 2].map((k) => Math.max(a[k], b[k], c[k]) + r) as V3,
		};
		// A radius that changes along the curve tilts the field's gradient.
		const taper = Math.abs(a[3] - c[3]) / Math.max(dist3(a, c), 1e-3);
		p.push(head, [...a], [b[0], b[1], b[2], limit], [...c], color, {
			...NEUTRAL,
			group,
			box: s.mode === "intersect" ? null : growBox(hull, head[2]),
			solid: (s.mode ?? "add") === "add" ? growBox(hull, head[2] / 4) : null,
			lipMax: Math.min(3, 1 + taper),
		});
	});
}

/**
 * A warp's vector, the gradient and largest displacement of the whole push,
 * and the center's travel (grab only): the push is applied in equal steps
 * small enough to stay invertible.
 */
function warpPlan(w: ClayWarp): {
	vector: V3;
	gradient: number;
	displacement: number;
	travel: V3;
} {
	const reach = w.reach ?? w.radius * 4;
	if (w.type === "grab") {
		const len = Math.hypot(...w.delta);
		return {
			vector: w.delta,
			gradient:
				(GRAB_GRADIENT * len) / w.radius + (WINDOW_GRADIENT * len) / reach,
			displacement: len,
			travel: w.delta,
		};
	}
	const size =
		w.type === "twist"
			? (Math.abs(w.angle) * Math.PI) / 180
			: Math.abs(w.amount);
	const displacement = SPIN_DISPLACEMENT * w.radius * size;
	const gradient =
		SPIN_GRADIENT * size + (WINDOW_GRADIENT * displacement) / reach;
	if (w.type === "bulge")
		return {
			vector: [w.amount, 0, 0],
			gradient,
			displacement,
			travel: [0, 0, 0],
		};
	const len = Math.hypot(...w.axis) || 1;
	const turn = (w.angle * Math.PI) / 180 / len;
	return {
		vector: [w.axis[0] * turn, w.axis[1] * turn, w.axis[2] * turn],
		gradient,
		displacement,
		travel: [0, 0, 0],
	};
}

function packWarp(p: Packer, w: ClayWarp): void {
	const reach = w.reach ?? w.radius * 4;
	const plan = warpPlan(w);
	const steps = Math.max(1, Math.ceil(plan.gradient / MAX_WARP_GRADIENT));
	const vector = plan.vector.map((v) => v / steps);
	// Every step is the same push, moved: one table serves them all.
	let stretch: Float32Array | null = null;
	for (let i = 0; i < steps; i++) {
		const center = w.center.map(
			(c, k) => c + (plan.travel[k] * i) / steps,
		) as V3;
		const info: OpInfo = {
			...NEUTRAL,
			type: OP[w.type],
			group: p.nextGroup(),
			box: sphereBox(center, reach),
			solid: null,
			shift: plan.displacement / steps,
			center,
			reach,
		};
		const record = p.push(
			[OP[w.type], 0, 0],
			[...center, w.radius],
			[...vector, reach],
			[],
			undefined,
			info,
		);
		stretch ??= warpStretch(record);
		p.info[p.info.length - 1].stretch = stretch;
	}
}

function packInflate(p: Packer, o: ClayInflate): void {
	p.push(
		[OP.inflate, 0, 0],
		[...o.center, o.radius],
		[o.amount],
		[],
		undefined,
		{
			...NEUTRAL,
			group: p.nextGroup(),
			box: sphereBox(o.center, o.radius),
			solid: null,
			shift: Math.abs(o.amount),
			lipAdd: (Math.abs(o.amount) * WINDOW_GRADIENT) / o.radius,
		},
	);
}

function packDetail(p: Packer, o: ClayDetail): void {
	const octaves = Math.min(8, Math.max(1, Math.round(o.octaves ?? 4)));
	const persistence = o.persistence ?? 0.5;
	const lacunarity = o.lacunarity ?? 2;
	let height = 0;
	let slope = 0;
	for (let i = 0; i < octaves; i++) {
		height += persistence ** i;
		slope += (persistence * lacunarity) ** (2 * i);
	}
	height *= Math.abs(o.amplitude);
	const center = o.center ?? [0, 0, 0];
	const radius = o.center && o.radius ? o.radius : 0;
	p.push(
		[OP.detail, 0, 0],
		[...center, radius],
		[o.amplitude, 1 / o.scale, octaves, Math.round(o.seed ?? 0)],
		[persistence, lacunarity, o.ridged ? 1 : 0],
		undefined,
		{
			...NEUTRAL,
			group: p.nextGroup(),
			box: radius > 0 ? sphereBox(center, radius) : null,
			solid: null,
			shift: height,
			relief: height,
			reliefSlope:
				(Math.abs(o.amplitude) / o.scale) * NOISE_GRADIENT * Math.sqrt(slope) +
				(radius > 0 ? (height * WINDOW_GRADIENT) / radius : 0),
		},
	);
}

function packOp(p: Packer, op: ClayOp): void {
	if (op.type === "stroke") packStroke(p, op);
	else if (op.type === "grab" || op.type === "twist" || op.type === "bulge")
		packWarp(p, op);
	else if (op.type === "inflate") packInflate(p, op);
	else if (op.type === "detail") packDetail(p, op);
	else packSolid(p, op);
}

function symmetryMask(axes: string | undefined): number {
	let mask = 0;
	for (const axis of axes ?? "") {
		const bit = "xyz".indexOf(axis.toLowerCase());
		if (bit < 0) throw new Error(`Clay symmetry: unknown axis "${axis}"`);
		mask |= 1 << bit;
	}
	return mask;
}

export function packProgram(o: ClayGeometryOptions): PackedProgram {
	const p = new Packer();
	for (const op of o.ops) packOp(p, op);
	// Clipping to `bounds` is one more operation: every evaluator agrees on it.
	if (o.bounds)
		packSolid(p, { type: "box", size: o.bounds, mode: "intersect" });
	return {
		ops: new Float32Array(p.floats),
		info: p.info,
		symmetry: symmetryMask(o.symmetry),
		colored: p.colored,
	};
}
