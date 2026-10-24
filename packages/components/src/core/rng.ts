/**
 * Seeded randomness. Components never call `Math.random`: every random choice
 * derives from the `seed` prop, so the same props give the same frames.
 */

export interface Rng {
	/** Uniform in [0, 1). */
	next(): number;
	/** Uniform in [min, max). */
	range(min: number, max: number): number;
	/** Integer in [min, max] (inclusive). */
	int(min: number, max: number): number;
	/** One element of `items`. */
	pick<T>(items: readonly T[]): T;
	/** Uniform in [-amount, amount). */
	spread(amount: number): number;
}

/** splitmix32: tiny, fast, and well distributed for animation jitter. */
export function rng(seed: number): Rng {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x9e3779b9) >>> 0;
		let z = state;
		z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
		z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
		z = (z ^ (z >>> 16)) >>> 0;
		return z / 0x100000000;
	};
	return {
		next,
		range: (min, max) => min + (max - min) * next(),
		int: (min, max) => min + Math.floor(next() * (max - min + 1)),
		pick: (items) => {
			if (items.length === 0) throw new Error("rng.pick: empty list");
			return items[Math.floor(next() * items.length)] as never;
		},
		spread: (amount) => (next() * 2 - 1) * amount,
	};
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(value: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/**
 * A stream keyed by `key` under `seed`: the n-th word of a caption gets the
 * same jitter whether or not earlier words change.
 */
export function hashRng(seed: number, key: string | number): Rng {
	return rng(
		(Math.imul(seed >>> 0, 0x9e3779b1) ^ hashString(String(key))) >>> 0,
	);
}
