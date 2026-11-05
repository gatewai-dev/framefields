/**
 * Skin textures for a `human()`, made in code: a base color and a roughness
 * map baked into the body's own UV layout, and a tiling detail normal map
 * of pores and fine creases.
 *
 * Color varies where real skin does. Blood shows through as redness on
 * the cheeks, nose and eyelids, the lips are darker and redder, and
 * melanin and blood mottle the whole body at two scales. Roughness drops
 * on the wet lips and the oily nose. The facial regions come from the
 * face's own blend shapes (the lips are what `mouthPucker` moves, the
 * cheeks what `mouthSmile` lifts), so they follow any shaped face without
 * a hand-painted mask.
 */
import { type ColorInput, linearRgb } from "../color.js";
import { encodePng } from "../png.js";
import { Noise3 } from "../sculpt/noise.js";
import type { HumanModel } from "./human.js";

export interface SkinOptions {
	/** Base skin color (display sRGB). Default "#d9b29a". */
	color?: ColorInput;
	/** Lip color. Default: the skin, darker and redder. */
	lips?: ColorInput;
	/** Redness of the cheeks, nose and lids, 0 … 1. Default 0.5. */
	blush?: number;
	/** Mottling of the base color, 0 … 1. Default 0.5. */
	mottle?: number;
	/** Base roughness. Default 0.5. */
	roughness?: number;
	/** Color and roughness map size, pixels. Default 2048. */
	size?: number;
	/** Pore spacing, cm. Default 0.14. */
	poreSpacing?: number;
	seed?: number;
}

export interface SkinTextures {
	/** Base color, PNG (sRGB), on the body's UVs. */
	color: Uint8Array;
	/** glTF metallic-roughness PNG (roughness in green, metal 0), on the body's UVs. */
	roughness: Uint8Array;
	/** Tiling tangent-space normal map of pores and creases, PNG. */
	detail: Uint8Array;
	/** How many times `detail` repeats across the UV square for the pores to come out at `poreSpacing`. */
	detailRepeat: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/** Per vertex, how far a named blend shape moves it, over the shape's largest move (0 when the body has no such shape). */
function reach(body: HumanModel["body"], names: string[]): Float32Array {
	const n = body.positions.length / 3;
	const out = new Float32Array(n);
	for (const name of names) {
		const d = body.targets.find((t) => t.name === name)?.positions;
		if (!d) continue;
		let max = 0;
		const m = new Float32Array(n);
		for (let v = 0; v < n; v++) {
			m[v] = Math.hypot(
				d[v * 3] as number,
				d[v * 3 + 1] as number,
				d[v * 3 + 2] as number,
			);
			max = Math.max(max, m[v] as number);
		}
		if (max > 0)
			for (let v = 0; v < n; v++)
				out[v] = Math.max(out[v] as number, (m[v] as number) / max);
	}
	return out;
}

/**
 * The lips per vertex, 0 … 1. Pursing moves the mouth corners furthest,
 * which places them; the lips are the lens between them, the upper about
 * a sixth of the mouth's width tall and the lower a fifth, with soft edges.
 * Vertices inside the mouth fall in the lens too, which colors the inner
 * lips and gums alike.
 */
function lipMask(body: HumanModel["body"], pucker: Float32Array): Float32Array {
	const p = body.positions;
	const n = pucker.length;
	const corner = (side: 1 | -1) => {
		let best = -1;
		for (let v = 0; v < n; v++)
			if (
				side * (p[v * 3] as number) > 0 &&
				(best < 0 || (pucker[v] as number) > (pucker[best] as number))
			)
				best = v;
		return best;
	};
	const l = corner(1);
	const r = corner(-1);
	const out = new Float32Array(n);
	if (l < 0 || r < 0) return out;
	const cx = ((p[l * 3] as number) - (p[r * 3] as number)) / 2;
	const mx = ((p[l * 3] as number) + (p[r * 3] as number)) / 2;
	const my = ((p[l * 3 + 1] as number) + (p[r * 3 + 1] as number)) / 2;
	const mz = Math.min(p[l * 3 + 2] as number, p[r * 3 + 2] as number);
	const width = 2 * cx;
	const soft = width * 0.04;
	for (let v = 0; v < n; v++) {
		const x = ((p[v * 3] as number) - mx) / cx;
		const y = (p[v * 3 + 1] as number) - my;
		// Only the front of the face, not the back of the head.
		if (Math.abs(x) >= 1 || (p[v * 3 + 2] as number) < mz - width * 0.3)
			continue;
		const lens = Math.sqrt(1 - x * x);
		const extent = (y >= 0 ? 0.17 : 0.2) * width * lens;
		out[v] =
			(1 - smooth(extent - soft, extent + soft, Math.abs(y))) *
			(1 - smooth(0.88, 1, Math.abs(x)));
	}
	return out;
}

/** Facial regions per vertex, 0 … 1. */
function regions(body: HumanModel["body"]) {
	const pucker = reach(body, ["mouthPucker"]);
	const smile = reach(body, ["mouthSmileLeft", "mouthSmileRight"]);
	const nose = reach(body, ["noseWrinkle", "noseSneerLeft", "noseSneerRight"]);
	const lids = reach(body, ["eyeBlinkLeft", "eyeBlinkRight"]);
	const lips = lipMask(body, pucker);
	const n = pucker.length;
	const blush = new Float32Array(n);
	const lid = new Float32Array(n);
	for (let v = 0; v < n; v++) {
		blush[v] = Math.max(
			smooth(0.03, 0.35, smile[v] as number) * (1 - (lips[v] as number)),
			smooth(0.1, 0.6, nose[v] as number) * 0.8,
		);
		lid[v] = smooth(0.2, 0.7, lids[v] as number);
	}
	return { lips, blush, lid };
}

/** Model units (cm) per UV unit over the head, where the pores matter. */
function headTexelScale(body: HumanModel["body"], height: number): number {
	const p = body.positions;
	const uv = body.uvs;
	const idx = body.indices;
	const ratios: number[] = [];
	for (let f = 0; f < idx.length; f += 3) {
		const [a, b, c] = [idx[f], idx[f + 1], idx[f + 2]] as [
			number,
			number,
			number,
		];
		if ((p[a * 3 + 1] as number) < height * 0.88) continue;
		const e = (i: number, j: number, k: number) =>
			(p[j * 3 + k] as number) - (p[i * 3 + k] as number);
		const ex = [e(a, b, 0), e(a, b, 1), e(a, b, 2)];
		const fx = [e(a, c, 0), e(a, c, 1), e(a, c, 2)];
		const area3 =
			Math.hypot(
				(ex[1] as number) * (fx[2] as number) -
					(ex[2] as number) * (fx[1] as number),
				(ex[2] as number) * (fx[0] as number) -
					(ex[0] as number) * (fx[2] as number),
				(ex[0] as number) * (fx[1] as number) -
					(ex[1] as number) * (fx[0] as number),
			) / 2;
		const du1 = (uv[b * 2] as number) - (uv[a * 2] as number);
		const dv1 = (uv[b * 2 + 1] as number) - (uv[a * 2 + 1] as number);
		const du2 = (uv[c * 2] as number) - (uv[a * 2] as number);
		const dv2 = (uv[c * 2 + 1] as number) - (uv[a * 2 + 1] as number);
		const areaUv = Math.abs(du1 * dv2 - du2 * dv1) / 2;
		if (areaUv > 1e-12 && area3 > 0) ratios.push(Math.sqrt(area3 / areaUv));
	}
	ratios.sort((x, y) => x - y);
	return ratios[Math.floor(ratios.length / 2)] ?? 100;
}

/** Periodic 2D value lattice for tileable noise: `period` cells per tile. */
class TileNoise {
	private readonly values: Float32Array;
	constructor(
		private readonly period: number,
		seed: number,
	) {
		let s = seed >>> 0;
		this.values = Float32Array.from({ length: period * period * 2 }, () => {
			s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
			return (s / 4294967296) * 2 - 1;
		});
	}

	/** Gradient noise at tile coordinates `u, v` in 0 … 1, about -1 … 1. */
	at(u: number, v: number): number {
		const P = this.period;
		const x = u * P;
		const y = v * P;
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const fx = x - xi;
		const fy = y - yi;
		const g = (i: number, j: number, dx: number, dy: number) => {
			const k = ((((i % P) + P) % P) + (((j % P) + P) % P) * P) * 2;
			const a = (this.values[k] as number) * Math.PI;
			return Math.cos(a) * dx + Math.sin(a) * dy;
		};
		const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
		const sx = fade(fx);
		const sy = fade(fy);
		const n00 = g(xi, yi, fx, fy);
		const n10 = g(xi + 1, yi, fx - 1, fy);
		const n01 = g(xi, yi + 1, fx, fy - 1);
		const n11 = g(xi + 1, yi + 1, fx - 1, fy - 1);
		return (
			(n00 +
				sx * (n10 - n00) +
				sy * (n01 + sx * (n11 - n01) - n00 - sx * (n10 - n00))) *
			1.4
		);
	}
}

/** Pore cells across one tile of the detail map. */
const PORE_CELLS = 24;

/**
 * A tiling tangent-space normal map of skin microrelief: pits on a
 * jittered grid (one per cell, varied in size and depth), two families of
 * fine creases crossing at an angle, and a soft unevenness.
 */
export function poreNormalMap(size = 512, seed = 7): Uint8Array {
	const N = size;
	const height = new Float32Array(N * N);
	let s = seed >>> 0;
	const rand = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const G = PORE_CELLS;
	const pores = Array.from({ length: G * G }, () => ({
		x: rand(),
		y: rand(),
		r: 0.18 + 0.2 * rand(),
		depth: 0.5 + 0.5 * rand(),
	}));
	// Crease networks at about the pore spacing: pores sit where they cross.
	const creaseA = new TileNoise(G, seed + 1);
	const creaseB = new TileNoise(Math.round(G * 1.5), seed + 2);
	const soft = new TileNoise(4, seed + 3);
	for (let py = 0; py < N; py++)
		for (let px = 0; px < N; px++) {
			const u = (px + 0.5) / N;
			const v = (py + 0.5) / N;
			let h = 0;
			const cx = Math.floor(u * G);
			const cy = Math.floor(v * G);
			for (let oy = -1; oy <= 1; oy++)
				for (let ox = -1; ox <= 1; ox++) {
					const gx = cx + ox;
					const gy = cy + oy;
					const pore = pores[(((gx % G) + G) % G) + (((gy % G) + G) % G) * G];
					if (!pore) continue;
					const dx = u * G - (gx + pore.x);
					const dy = v * G - (gy + pore.y);
					const d = Math.hypot(dx, dy) / pore.r;
					if (d < 1) h -= pore.depth * (1 - d * d) ** 2;
				}
			// Creases: the zero lines of two noises, sharpened into grooves.
			const a = creaseA.at(u + 0.05 * soft.at(v, u), v);
			const b = creaseB.at(u, v + 0.05 * soft.at(u, v));
			h -= 0.2 * (1 - smooth(0, 0.15, Math.abs(a)));
			h -= 0.12 * (1 - smooth(0, 0.12, Math.abs(b)));
			h += 0.3 * soft.at(u, v);
			height[py * N + px] = h;
		}
	const rgba = new Uint8Array(N * N * 4);
	const k = N / 64; // slope scale: a unit of height over 1/64 of the tile
	const hAt = (x: number, y: number) =>
		height[(((y % N) + N) % N) * N + (((x % N) + N) % N)] as number;
	for (let y = 0; y < N; y++)
		for (let x = 0; x < N; x++) {
			const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 0.5 * (k / 8);
			// +Y in a glTF normal map points up the image (toward row 0).
			const dy = (hAt(x, y - 1) - hAt(x, y + 1)) * 0.5 * (k / 8);
			const l = Math.hypot(dx, dy, 1);
			const i = (y * N + x) * 4;
			rgba[i] = Math.round((-dx / l) * 127.5 + 127.5);
			rgba[i + 1] = Math.round((-dy / l) * 127.5 + 127.5);
			rgba[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
			rgba[i + 3] = 255;
		}
	return encodePng(rgba, N, N);
}

const toSrgb8 = (c: number) => {
	const x = clamp01(c);
	return Math.round(
		(x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255,
	);
};

/** Bakes the body's skin textures (see `SkinTextures`). */
export function skinTextures(
	h: Pick<HumanModel, "body" | "height">,
	options: SkinOptions = {},
): SkinTextures {
	const S = options.size ?? 2048;
	const base = linearRgb(options.color ?? "#d9b29a");
	const lipColor = options.lips
		? linearRgb(options.lips)
		: ([base[0] * 0.78, base[1] * 0.42, base[2] * 0.45] as [
				number,
				number,
				number,
			]);
	const blushAmount = options.blush ?? 0.5;
	const mottle = options.mottle ?? 0.5;
	const rough = options.roughness ?? 0.5;
	const seed = options.seed ?? 1;
	const { body } = h;
	const { lips, blush, lid } = regions(body);
	const melanin = new Noise3(seed);
	const blood = new Noise3(seed + 1);
	const p = body.positions;
	const uv = body.uvs;
	const idx = body.indices;

	// Per vertex: the skin's linear color and roughness. Broad variation
	// lives on the vertices (a few mm apart on the face); the texels add
	// the fine freckling.
	const n = p.length / 3;
	const vColor = new Float32Array(n * 3);
	const vRough = new Float32Array(n);
	for (let v = 0; v < n; v++) {
		const [x, y, z] = [
			p[v * 3] as number,
			p[v * 3 + 1] as number,
			p[v * 3 + 2] as number,
		];
		const lip = lips[v] as number;
		const red =
			((blush[v] as number) + (lid[v] as number) * 0.35) * blushAmount;
		const m = melanin.fbm(x / 8, y / 8, z / 8, 2);
		const b = blood.fbm(x / 3, y / 3, z / 3, 2);
		const dark = 1 - 0.08 * mottle * m;
		const flush = clamp01(red + 0.25 * mottle * b);
		for (let k = 0; k < 3; k++) {
			// Blood absorbs green and blue: redness scales them down.
			const skin =
				(base[k] as number) * dark * (k === 0 ? 1 : 1 - 0.28 * flush);
			vColor[v * 3 + k] = skin + ((lipColor[k] as number) - skin) * lip;
		}
		vRough[v] = clamp01(
			rough - 0.16 * lip - 0.04 * (blush[v] as number) + 0.04 * b,
		);
	}

	const color = new Float32Array(S * S * 3);
	const roughness = new Float32Array(S * S);
	const filled = new Uint8Array(S * S);
	const shade = (
		texel: number,
		w0: number,
		w1: number,
		w2: number,
		a: number,
		b: number,
		c: number,
	) => {
		const x =
			w0 * (p[a * 3] as number) +
			w1 * (p[b * 3] as number) +
			w2 * (p[c * 3] as number);
		const y =
			w0 * (p[a * 3 + 1] as number) +
			w1 * (p[b * 3 + 1] as number) +
			w2 * (p[c * 3 + 1] as number);
		const z =
			w0 * (p[a * 3 + 2] as number) +
			w1 * (p[b * 3 + 2] as number) +
			w2 * (p[c * 3 + 2] as number);
		// Freckling at about 1 cm.
		const fine = 1 - 0.05 * mottle * melanin.at(x, y, z);
		for (let k = 0; k < 3; k++)
			color[texel * 3 + k] =
				(w0 * (vColor[a * 3 + k] as number) +
					w1 * (vColor[b * 3 + k] as number) +
					w2 * (vColor[c * 3 + k] as number)) *
				fine;
		roughness[texel] =
			w0 * (vRough[a] as number) +
			w1 * (vRough[b] as number) +
			w2 * (vRough[c] as number);
		filled[texel] = 1;
	};
	for (let f = 0; f < idx.length; f += 3) {
		const vs = [idx[f], idx[f + 1], idx[f + 2]] as [number, number, number];
		const X = vs.map((v) => (uv[v * 2] as number) * S - 0.5);
		const Y = vs.map((v) => (uv[v * 2 + 1] as number) * S - 0.5);
		const [x0, x1, x2] = X as [number, number, number];
		const [y0, y1, y2] = Y as [number, number, number];
		const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
		if (Math.abs(area) < 1e-12) continue;
		const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
		const maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)));
		const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
		const maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
		for (let ty = minY; ty <= maxY; ty++)
			for (let tx = minX; tx <= maxX; tx++) {
				const w0 = ((x1 - tx) * (y2 - ty) - (x2 - tx) * (y1 - ty)) / area;
				const w1 = ((x2 - tx) * (y0 - ty) - (x0 - tx) * (y2 - ty)) / area;
				const w2 = 1 - w0 - w1;
				if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
				shade(ty * S + tx, w0, w1, w2, vs[0], vs[1], vs[2]);
			}
	}
	dilate(S, filled, [color, 3], [roughness, 1]);

	const colorRgba = new Uint8Array(S * S * 4);
	const roughRgba = new Uint8Array(S * S * 4);
	for (let t = 0; t < S * S; t++) {
		for (let k = 0; k < 3; k++)
			colorRgba[t * 4 + k] = toSrgb8(color[t * 3 + k] as number);
		colorRgba[t * 4 + 3] = 255;
		roughRgba[t * 4] = 255;
		roughRgba[t * 4 + 1] = Math.round((roughness[t] as number) * 255);
		roughRgba[t * 4 + 2] = 0;
		roughRgba[t * 4 + 3] = 255;
	}
	const tileCm = (options.poreSpacing ?? 0.14) * PORE_CELLS;
	return {
		color: encodePng(colorRgba, S, S),
		roughness: encodePng(roughRgba, S, S),
		detail: poreNormalMap(512, seed + 7),
		detailRepeat: Math.max(
			1,
			Math.round(headTexelScale(body, h.height) / tileCm),
		),
	};
}

/**
 * Grows the painted texels outward into the empty ones, so filtering and
 * mipmaps at UV seams average skin with skin instead of with black.
 */
function dilate(
	S: number,
	filled: Uint8Array,
	...channels: [Float32Array, number][]
) {
	let front = filled;
	for (let pass = 0; pass < 8; pass++) {
		const next = front.slice();
		for (let y = 0; y < S; y++)
			for (let x = 0; x < S; x++) {
				const t = y * S + x;
				if (front[t]) continue;
				let n = 0;
				for (const [dx, dy] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				] as const) {
					const xx = x + dx;
					const yy = y + dy;
					if (xx < 0 || yy < 0 || xx >= S || yy >= S || !front[yy * S + xx])
						continue;
					const s = yy * S + xx;
					for (const [data, size] of channels)
						for (let k = 0; k < size; k++)
							data[t * size + k] =
								(n ? (data[t * size + k] as number) : 0) +
								(data[s * size + k] as number);
					n++;
				}
				if (!n) continue;
				for (const [data, size] of channels)
					for (let k = 0; k < size; k++)
						data[t * size + k] = (data[t * size + k] as number) / n;
				next[t] = 1;
			}
		front = next;
	}
}
