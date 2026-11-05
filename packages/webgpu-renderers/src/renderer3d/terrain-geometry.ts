/**
 * Procedural terrain: a heightfield grid lifted by seeded fractal noise (or
 * a caller's height samples), optionally warped sideways on its cliffs into
 * overhangs, colored by altitude and slope, and closed underneath into a
 * watertight block.
 *
 * Local space: x across `width`, z across `depth`, both centered; the valley
 * floor (height 0) at y = 0 and the highest peak at y = -height (up is -y).
 */
import {
	createNoise,
	type FractalMode,
	fractal2,
	type Noise,
	terrace,
} from "../math3d/noise.js";
import {
	accumulateNormals,
	emptyArrays,
	flatten,
	type GeometryArrays,
	pushTriangle,
	pushVertex,
	type Rgba,
} from "./geometry-arrays.js";
import { parseHexOrRgbColor } from "./text-extruder.js";

export interface TerrainNoiseOptions {
	seed?: number;
	/** Size of the largest landforms, px. Default: a third of the longer side. */
	scale?: number;
	/** Noise layers summed, 1..10. Default 6. */
	octaves?: number;
	/** Amplitude kept per octave, 0..1. Default 0.5. */
	persistence?: number;
	/** Frequency gained per octave, 1..4. Default 2. */
	lacunarity?: number;
	/** "fbm" rolling hills, "ridged" sharp crests, "terrace" stepped plateaus. Default "fbm". */
	ridgeMode?: FractalMode;
	/** Plateaus for "terrace", 2..32. Default 6. */
	terraceSteps?: number;
}

export interface TerrainColorByElevation {
	lowColor: string;
	midColor?: string;
	highColor: string;
	/** Steep faces (slope cosine below `cliffThreshold`) blend to this. */
	cliffColor?: string;
	/** Slope cosine (1 = flat) below which cliffs show. Default 0.65. */
	cliffThreshold?: number;
	/** Normalized altitudes where low turns mid and mid turns high. Default [0.35, 0.7]. */
	bands?: [number, number];
}

export interface TerrainGeometryOptions {
	type: "terrain";
	width: number;
	depth: number;
	/** Peak-to-valley relief, px. Default 300. */
	height?: number;
	/** Grid cells along x and z (or both), 1..512. Default 128. */
	segments?: number | [number, number];
	noise?: TerrainNoiseOptions;
	/**
	 * Heights 0..1 on the (segments + 1)² grid, row by row from the near
	 * edge (-z) and left to right: a DEM, or a sampled height function.
	 * Replaces the noise.
	 */
	heights?: number[];
	/** Sideways warp of steep faces into overhangs, px. Default 0. */
	overhangWarp?: number;
	colorByElevation?: TerrainColorByElevation;
	/** Faceted, low-poly shading. */
	flatShaded?: boolean;
	/** Thickness of the solid under the valley floor, px. Default 10% of `height`. */
	base?: number;
	color?: string;
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	metallic?: number;
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));
const smooth = (e0: number, e1: number, x: number) => {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
};

export function terrainSegments(o: TerrainGeometryOptions): [number, number] {
	const s = o.segments ?? 128;
	const [sx, sz] = typeof s === "number" ? [s, s] : s;
	return [clamp(Math.round(sx), 1, 512), clamp(Math.round(sz), 1, 512)];
}

/** Normalized heights 0..1 on the (sx + 1) × (sz + 1) grid. */
export function terrainHeights(o: TerrainGeometryOptions): Float32Array {
	const [sx, sz] = terrainSegments(o);
	const n = (sx + 1) * (sz + 1);
	const out = new Float32Array(n);
	if (o.heights) {
		for (let i = 0; i < n; i++) out[i] = clamp(o.heights[i] ?? 0, 0, 1);
		return out;
	}
	const nz = o.noise ?? {};
	const noise = createNoise(nz.seed ?? 1);
	const mode = nz.ridgeMode ?? "fbm";
	const fractal = {
		octaves: clamp(Math.round(nz.octaves ?? 6), 1, 10),
		persistence: clamp(nz.persistence ?? 0.5, 0, 1),
		lacunarity: clamp(nz.lacunarity ?? 2, 1, 4),
		mode,
	};
	const scale = Math.max(1, nz.scale ?? Math.max(o.width, o.depth) / 3);
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	for (let j = 0; j <= sz; j++) {
		for (let i = 0; i <= sx; i++) {
			const x = (i / sx - 0.5) * o.width;
			const z = (j / sz - 0.5) * o.depth;
			const h = fractal2(noise, x / scale, z / scale, fractal);
			out[j * (sx + 1) + i] = h;
			lo = Math.min(lo, h);
			hi = Math.max(hi, h);
		}
	}
	// Stretched to span exactly 0..1, so `height` is the true relief.
	const span = hi - lo > 1e-9 ? hi - lo : 1;
	const steps = clamp(Math.round(nz.terraceSteps ?? 6), 2, 32);
	for (let k = 0; k < n; k++) {
		const h = (out[k]! - lo) / span;
		out[k] = mode === "terrace" ? terrace(h, steps) : h;
	}
	return out;
}

/**
 * Height at grid-space (gx, gy) on the mesh's own triangles: each cell
 * splits along its (i + 1, j)–(i, j + 1) diagonal, as `buildTop` does.
 */
function onTriangles(
	h: Float32Array,
	sx: number,
	sz: number,
	gx: number,
	gy: number,
): number {
	const x = clamp(gx, 0, sx);
	const y = clamp(gy, 0, sz);
	const i = Math.min(Math.floor(x), sx - 1);
	const j = Math.min(Math.floor(y), sz - 1);
	const fx = x - i;
	const fy = y - j;
	const at = (a: number, b: number) => h[b * (sx + 1) + a]!;
	if (fx + fy <= 1) {
		const a = at(i, j);
		return a + (at(i + 1, j) - a) * fx + (at(i, j + 1) - a) * fy;
	}
	const d = at(i + 1, j + 1);
	return d + (at(i, j + 1) - d) * (1 - fx) + (at(i + 1, j) - d) * (1 - fy);
}

export interface TerrainSampler {
	/** Surface y (local, up is -y) above local (x, z); clamped to the edges. */
	heightAt(x: number, z: number): number;
	/** Unit surface normal at local (x, z). */
	normalAt(x: number, z: number): [number, number, number];
	/** Normalized altitude 0..1 at local (x, z). */
	elevationAt(x: number, z: number): number;
}

/**
 * Samples the terrain's unwarped surface (exactly its triangles), so other layers (a camera, a
 * video screen, a glTF model, a light) can be stood on it.
 */
export function createTerrainSampler(
	o: TerrainGeometryOptions,
): TerrainSampler {
	const [sx, sz] = terrainSegments(o);
	const h = terrainHeights(o);
	const relief = o.height ?? 300;
	const grid = (x: number, z: number): [number, number] => [
		(x / o.width + 0.5) * sx,
		(z / o.depth + 0.5) * sz,
	];
	const elevationAt = (x: number, z: number) =>
		onTriangles(h, sx, sz, ...grid(x, z));
	const heightAt = (x: number, z: number) => -elevationAt(x, z) * relief;
	return {
		heightAt,
		elevationAt,
		normalAt(x, z) {
			const ex = o.width / sx;
			const ez = o.depth / sz;
			const dx = (heightAt(x + ex, z) - heightAt(x - ex, z)) / (2 * ex);
			const dz = (heightAt(x, z + ez) - heightAt(x, z - ez)) / (2 * ez);
			// Surface y = f(x, z): the up-facing normal is (f_x, -1, f_z).
			const len = Math.hypot(dx, 1, dz);
			return [dx / len, -1 / len, dz / len];
		},
	};
}

interface Palette {
	low: Rgba;
	mid?: Rgba;
	high: Rgba;
	cliff?: Rgba;
	threshold: number;
	bands: [number, number];
}

function palette(c: TerrainColorByElevation | undefined): Palette | undefined {
	if (!c) return undefined;
	return {
		low: parseHexOrRgbColor(c.lowColor),
		mid: c.midColor ? parseHexOrRgbColor(c.midColor) : undefined,
		high: parseHexOrRgbColor(c.highColor),
		cliff: c.cliffColor ? parseHexOrRgbColor(c.cliffColor) : undefined,
		threshold: clamp(c.cliffThreshold ?? 0.65, 0, 1),
		bands: c.bands ?? [0.35, 0.7],
	};
}

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
	a[0] + (b[0] - a[0]) * t,
	a[1] + (b[1] - a[1]) * t,
	a[2] + (b[2] - a[2]) * t,
	a[3] + (b[3] - a[3]) * t,
];

/** Biome color at normalized altitude `e` on a face whose up-ness is `up` (n·up). */
function biome(p: Palette, e: number, up: number): Rgba {
	const [b0, b1] = p.bands;
	const blend = 0.06;
	let c: Rgba;
	if (p.mid) {
		c = mix(p.low, p.mid, smooth(b0 - blend, b0 + blend, e));
		c = mix(c, p.high, smooth(b1 - blend, b1 + blend, e));
	} else {
		const b = (b0 + b1) / 2;
		c = mix(p.low, p.high, smooth(b - blend, b + blend, e));
	}
	if (p.cliff) {
		c = mix(c, p.cliff, smooth(p.threshold + 0.08, p.threshold - 0.08, up));
	}
	return c;
}

/**
 * Pushes steep faces sideways along their downhill direction by 3D noise
 * that changes with altitude, so cliffs fold out over their own feet.
 */
function warpCliffs(
	g: GeometryArrays,
	topCount: number,
	amount: number,
	noise: Noise,
	freq: number,
): void {
	const p = g.positions;
	const n = g.normals;
	for (let v = 0; v < topCount; v++) {
		const k = v * 3;
		const up = -n[k + 1]!;
		const steep = 1 - up * up;
		if (steep < 1e-3) continue;
		const hl = Math.hypot(n[k]!, n[k + 2]!) || 1;
		const w =
			amount *
			steep *
			(0.5 +
				0.5 * noise.noise3(p[k]! * freq, p[k + 1]! * freq, p[k + 2]! * freq));
		p[k] += (n[k]! / hl) * w;
		p[k + 2] += (n[k + 2]! / hl) * w;
	}
}

/** The top surface: one vertex per grid point. */
function buildTop(
	o: TerrainGeometryOptions,
	h: Float32Array,
	sx: number,
	sz: number,
): GeometryArrays {
	const g = emptyArrays();
	const relief = o.height ?? 300;
	for (let j = 0; j <= sz; j++) {
		for (let i = 0; i <= sx; i++) {
			const x = (i / sx - 0.5) * o.width;
			const z = (j / sz - 0.5) * o.depth;
			// v = 0 on the far edge: a map draped on it reads upright from the front.
			pushVertex(
				g,
				[x, -h[j * (sx + 1) + i]! * relief, z],
				[0, -1, 0],
				[i / sx, 1 - j / sz],
			);
		}
	}
	for (let j = 0; j < sz; j++) {
		for (let i = 0; i < sx; i++) {
			const a = j * (sx + 1) + i;
			const b = a + 1;
			const c = a + sx + 1;
			const d = c + 1;
			// cross(b - a, c - a) = cross(+x, +z) points up (-y).
			pushTriangle(g, a, b, c);
			pushTriangle(g, b, d, c);
		}
	}
	accumulateNormals(g);
	return g;
}

/** The top grid's rim, one side at a time: near (-z), far (+z), left (-x), right (+x). */
function rimIndices(side: number, sx: number, sz: number): number[] {
	const out: number[] = [];
	if (side === 0) for (let i = 0; i <= sx; i++) out.push(i);
	if (side === 1) for (let i = 0; i <= sx; i++) out.push(sz * (sx + 1) + i);
	if (side === 2) for (let j = 0; j <= sz; j++) out.push(j * (sx + 1));
	if (side === 3) for (let j = 0; j <= sz; j++) out.push(j * (sx + 1) + sx);
	return out;
}

const OUTWARD: Array<[number, number, number]> = [
	[0, 0, -1],
	[0, 0, 1],
	[-1, 0, 0],
	[1, 0, 0],
];

/**
 * Four walls from the top's rim down to y = base, and a floor fanned from
 * its center to the walls' feet: a closed solid with no T-junctions.
 */
function closeBlock(
	g: GeometryArrays,
	sx: number,
	sz: number,
	base: number,
	sideColor: Rgba | undefined,
): void {
	const p = g.positions;
	const at = (v: number) => [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!] as const;
	const feet: Array<[number, number][]> = [];
	for (let side = 0; side < 4; side++) {
		const n = OUTWARD[side]!;
		const ring = rimIndices(side, sx, sz);
		const pairs = ring.map((v, k): [number, number] => {
			const pos = at(v);
			const u = k / (ring.length - 1);
			return [
				pushVertex(g, pos, n, [u, 0], sideColor),
				pushVertex(g, [pos[0], base, pos[2]], n, [u, 1], sideColor),
			];
		});
		// Rims run toward +x / +z: the near and right walls wind as built.
		const flip = side === 1 || side === 2;
		for (let k = 0; k + 1 < pairs.length; k++) {
			const [t0, b0] = pairs[k]!;
			const [t1, b1] = pairs[k + 1]!;
			pushTriangle(g, t0, b0, t1, flip);
			pushTriangle(g, t1, b0, b1, flip);
		}
		feet.push(pairs.map(([, b]) => [b, 0]));
	}
	// The floor's boundary loop: near → right → far (reversed) → left (reversed).
	const loop = [
		...feet[0]!,
		...feet[3]!.slice(1),
		...feet[1]!.slice(0, -1).reverse(),
		...feet[2]!.slice(1, -1).reverse(),
	].map(([v]) => v);
	const down = [0, 1, 0] as const;
	let cx = 0;
	let cz = 0;
	for (const v of loop) {
		cx += p[v * 3]! / loop.length;
		cz += p[v * 3 + 2]! / loop.length;
	}
	const floorUv = (x: number, z: number): [number, number] => [x, z];
	const center = pushVertex(
		g,
		[cx, base, cz],
		down,
		floorUv(0.5, 0.5),
		sideColor,
	);
	const rim = loop.map((v) =>
		pushVertex(g, at(v), down, floorUv(0, 0), sideColor),
	);
	for (let k = 0; k < rim.length; k++) {
		pushTriangle(g, center, rim[(k + 1) % rim.length]!, rim[k]!);
	}
}

/** Builds the terrain's vertex arrays. */
export function buildTerrain(o: TerrainGeometryOptions): GeometryArrays {
	const [sx, sz] = terrainSegments(o);
	const h = terrainHeights(o);
	const relief = o.height ?? 300;
	let g = buildTop(o, h, sx, sz);
	const topCount = g.positions.length / 3;
	const warp = o.overhangWarp ?? 0;
	if (warp > 0) {
		const noise = createNoise((o.noise?.seed ?? 1) + 101);
		warpCliffs(g, topCount, warp, noise, 3 / Math.max(1, relief));
		accumulateNormals(g);
	}
	const pal = palette(o.colorByElevation);
	if (pal) {
		for (let v = 0; v < topCount; v++) {
			g.colors.push(...biome(pal, h[v]!, -g.normals[v * 3 + 1]!));
		}
	}
	const base = o.base ?? relief * 0.1;
	const side = pal ? mix(pal.cliff ?? pal.low, [0, 0, 0, 1], 0.35) : undefined;
	closeBlock(g, sx, sz, base, side);
	if (o.flatShaded) g = flatten(g);
	return g;
}
