/** Seeded randomness for scene parameters: the same seed, the same draws. */

export interface Random {
	/** [0, 1). */
	next(): number;
	/** [min, max). */
	range(min: number, max: number): number;
	/** An integer in [min, max]. */
	int(min: number, max: number): number;
	pick<T>(items: readonly T[]): T;
}

/** mulberry32, salted so nearby seeds start far apart. */
export function random(seed: number): Random {
	let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		range: (min, max) => min + (max - min) * next(),
		int: (min, max) => min + Math.floor((max - min + 1) * next()),
		pick: (items) => items[Math.floor(items.length * next())],
	};
}
