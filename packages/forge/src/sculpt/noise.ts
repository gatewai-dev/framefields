/**
 * Deterministic 3D gradient noise (Perlin's improved noise with a seeded
 * permutation) and its fractal sum, for surface detail: bark, rock, bone
 * pitting, fur clumps. Values lie in about -1..1.
 */

const GRAD: ReadonlyArray<readonly [number, number, number]> = [
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
];

function permutation(seed: number): Uint8Array {
	const p = new Uint8Array(512);
	const base = Array.from({ length: 256 }, (_, i) => i);
	// Mulberry32: a small, well-mixed seeded generator.
	let s = seed >>> 0;
	const rand = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[base[i], base[j]] = [base[j] as number, base[i] as number];
	}
	for (let i = 0; i < 512; i++) p[i] = base[i & 255] as number;
	return p;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Noise3 {
	private readonly p: Uint8Array;

	constructor(seed = 0) {
		this.p = permutation(seed);
	}

	private grad(h: number, x: number, y: number, z: number): number {
		const g = GRAD[h % 12] as readonly [number, number, number];
		return g[0] * x + g[1] * y + g[2] * z;
	}

	/** Gradient noise at a point, about -1..1. */
	at(x: number, y: number, z: number): number {
		const p = this.p;
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const zi = Math.floor(z);
		const X = xi & 255;
		const Y = yi & 255;
		const Z = zi & 255;
		const xf = x - xi;
		const yf = y - yi;
		const zf = z - zi;
		const u = fade(xf);
		const v = fade(yf);
		const w = fade(zf);
		const A = (p[X] as number) + Y;
		const AA = (p[A] as number) + Z;
		const AB = (p[A + 1] as number) + Z;
		const B = (p[X + 1] as number) + Y;
		const BA = (p[B] as number) + Z;
		const BB = (p[B + 1] as number) + Z;
		const g = (i: number) => p[i] as number;
		return lerp(
			lerp(
				lerp(this.grad(g(AA), xf, yf, zf), this.grad(g(BA), xf - 1, yf, zf), u),
				lerp(
					this.grad(g(AB), xf, yf - 1, zf),
					this.grad(g(BB), xf - 1, yf - 1, zf),
					u,
				),
				v,
			),
			lerp(
				lerp(
					this.grad(g(AA + 1), xf, yf, zf - 1),
					this.grad(g(BA + 1), xf - 1, yf, zf - 1),
					u,
				),
				lerp(
					this.grad(g(AB + 1), xf, yf - 1, zf - 1),
					this.grad(g(BB + 1), xf - 1, yf - 1, zf - 1),
					u,
				),
				v,
			),
			w,
		);
	}

	/** Fractal sum of `octaves` layers, each twice the frequency and half the amplitude; about -1..1. */
	fbm(x: number, y: number, z: number, octaves: number): number {
		let sum = 0;
		let amp = 1;
		let norm = 0;
		let f = 1;
		for (let o = 0; o < octaves; o++) {
			sum += amp * this.at(x * f, y * f, z * f);
			norm += amp;
			amp *= 0.5;
			f *= 2.03;
		}
		return sum / norm;
	}
}
