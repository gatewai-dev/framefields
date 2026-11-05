/**
 * Seeded, deterministic gradient noise (Perlin, improved) and the fractal
 * sums procedural geometry is built from. Same seed, same field: on every
 * machine and every frame.
 */

/** mulberry32: a small, fast, well-distributed 32-bit PRNG. Returns [0, 1). */
export function createRandom(seed: number): () => number {
	let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The 12 cube-edge gradients of improved Perlin noise (z ignored in 2D). */
const GRAD3 = [
	[1, 1, 0],
	[-1, 1, 0],
	[1, -1, 0],
	[-1, -1, 0],
	[1, 0, 1],
	[-1, 0, 1],
	[1, 0, -1],
	[-1, 0, -1],
	[0, 1, 1],
	[0, -1, 1],
	[0, 1, -1],
	[0, -1, -1],
] as const;

const GRAD2 = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[Math.SQRT1_2, Math.SQRT1_2],
	[-Math.SQRT1_2, Math.SQRT1_2],
	[Math.SQRT1_2, -Math.SQRT1_2],
	[-Math.SQRT1_2, -Math.SQRT1_2],
] as const;

export interface Noise {
	/** Gradient noise in about [-1, 1]. */
	noise2(x: number, y: number): number;
	/** Gradient noise in about [-1, 1]. */
	noise3(x: number, y: number, z: number): number;
}

/** A gradient noise field whose lattice is shuffled by `seed`. */
export function createNoise(seed = 1): Noise {
	const rand = createRandom(seed);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const t = p[i]!;
		p[i] = p[j]!;
		p[j] = t;
	}
	const perm = new Uint8Array(512);
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

	const g2 = (h: number, x: number, y: number) => {
		const g = GRAD2[h & 7]!;
		return g[0] * x + g[1] * y;
	};
	const g3 = (h: number, x: number, y: number, z: number) => {
		const g = GRAD3[h % 12]!;
		return g[0] * x + g[1] * y + g[2] * z;
	};

	return {
		noise2(x, y) {
			const xi = Math.floor(x);
			const yi = Math.floor(y);
			const xf = x - xi;
			const yf = y - yi;
			const X = xi & 255;
			const Y = yi & 255;
			const aa = perm[perm[X]! + Y]!;
			const ab = perm[perm[X]! + Y + 1]!;
			const ba = perm[perm[X + 1]! + Y]!;
			const bb = perm[perm[X + 1]! + Y + 1]!;
			const u = fade(xf);
			const v = fade(yf);
			// Scaled so the field reaches about ±1.
			return (
				1.41 *
				lerp(
					lerp(g2(aa, xf, yf), g2(ba, xf - 1, yf), u),
					lerp(g2(ab, xf, yf - 1), g2(bb, xf - 1, yf - 1), u),
					v,
				)
			);
		},
		noise3(x, y, z) {
			const xi = Math.floor(x);
			const yi = Math.floor(y);
			const zi = Math.floor(z);
			const xf = x - xi;
			const yf = y - yi;
			const zf = z - zi;
			const X = xi & 255;
			const Y = yi & 255;
			const Z = zi & 255;
			const A = perm[X]! + Y;
			const B = perm[X + 1]! + Y;
			const AA = perm[A]! + Z;
			const AB = perm[A + 1]! + Z;
			const BA = perm[B]! + Z;
			const BB = perm[B + 1]! + Z;
			const u = fade(xf);
			const v = fade(yf);
			const w = fade(zf);
			return lerp(
				lerp(
					lerp(g3(perm[AA]!, xf, yf, zf), g3(perm[BA]!, xf - 1, yf, zf), u),
					lerp(
						g3(perm[AB]!, xf, yf - 1, zf),
						g3(perm[BB]!, xf - 1, yf - 1, zf),
						u,
					),
					v,
				),
				lerp(
					lerp(
						g3(perm[AA + 1]!, xf, yf, zf - 1),
						g3(perm[BA + 1]!, xf - 1, yf, zf - 1),
						u,
					),
					lerp(
						g3(perm[AB + 1]!, xf, yf - 1, zf - 1),
						g3(perm[BB + 1]!, xf - 1, yf - 1, zf - 1),
						u,
					),
					v,
				),
				w,
			);
		},
	};
}

export type FractalMode = "fbm" | "ridged" | "terrace";

export interface FractalOptions {
	octaves: number;
	persistence: number;
	lacunarity: number;
	mode: FractalMode;
}

/**
 * Fractal sum of `octaves` noise layers at (x, y), in [0, 1] before any
 * normalization: "fbm" rolls, "ridged" folds each octave into sharp crests
 * (Musgrave's ridged multifractal: each octave weighted by the last, so
 * detail gathers on ridges, not in valleys). Terracing is applied later,
 * over the normalized field.
 */
export function fractal2(
	noise: Noise,
	x: number,
	y: number,
	o: FractalOptions,
): number {
	let sum = 0;
	let norm = 0;
	let amp = 1;
	let freq = 1;
	let weight = 1;
	for (let i = 0; i < o.octaves; i++) {
		// Offset each octave so their lattices never line up.
		const n = noise.noise2(x * freq + i * 17.31, y * freq - i * 9.77);
		if (o.mode === "ridged") {
			let r = 1 - Math.abs(n);
			r *= r;
			r *= weight;
			weight = Math.min(1, Math.max(0, r * 2));
			sum += r * amp;
		} else {
			sum += (n * 0.5 + 0.5) * amp;
		}
		norm += amp;
		amp *= o.persistence;
		freq *= o.lacunarity;
	}
	return norm > 0 ? sum / norm : 0;
}

/** Stepped plateaus: each step flat for most of its width, then a steep riser. */
export function terrace(h: number, steps: number): number {
	const k = h * steps;
	const base = Math.floor(k);
	const f = k - base;
	const t = Math.min(1, Math.max(0, (f - 0.7) / 0.3));
	return Math.min(1, (base + t * t * (3 - 2 * t)) / steps);
}
