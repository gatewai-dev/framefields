/**
 * @file packages/webgpu-renderers/src/text-animations/selectors.ts
 * After Effects Range, Wiggly, and Signal selector weight evaluators.
 */

import type { SelectorMode, SelectorShape } from "./types.js";

/**
 * Computes After Effects Range Selector weight for a single glyph index.
 *
 * @param index Normalized position of the glyph in the string (0.0 to 1.0)
 * @param start Start boundary (0.0 to 1.0)
 * @param end End boundary (0.0 to 1.0)
 * @param offset Window shift (-1.0 to 1.0)
 * @param shape Falloff curve
 * @param easeHigh Non-linear easing for high values
 * @param easeLow Non-linear easing for low values
 * @returns Weight in [0.0, 1.0]
 */
export function computeRangeSelectorWeight(
	index: number,
	start: number,
	end: number,
	offset: number,
	shape: SelectorShape,
	easeHigh = 0,
	easeLow = 0,
): number {
	const effStart = start + offset;
	const effEnd = end + offset;

	if (effEnd <= effStart) return 0;

	const relativePos = (index - effStart) / (effEnd - effStart);

	let baseWeight = 0;
	switch (shape) {
		case "square":
			baseWeight = relativePos >= 0 && relativePos <= 1 ? 1 : 0;
			break;
		case "ramp_up":
			baseWeight = Math.max(0, Math.min(1, relativePos));
			break;
		case "ramp_down":
			baseWeight = 1 - Math.max(0, Math.min(1, relativePos));
			break;
		case "triangle": {
			if (relativePos < 0 || relativePos > 1) {
				baseWeight = 0;
			} else if (relativePos < 0.5) {
				baseWeight = relativePos * 2;
			} else {
				baseWeight = (1 - relativePos) * 2;
			}
			break;
		}
		case "round": {
			if (relativePos < 0 || relativePos > 1) {
				baseWeight = 0;
			} else {
				baseWeight = 0.5 - 0.5 * Math.cos(relativePos * 2 * Math.PI);
			}
			break;
		}
		case "smooth": {
			if (relativePos <= 0) baseWeight = 0;
			else if (relativePos >= 1) baseWeight = 1;
			else baseWeight = relativePos * relativePos * (3 - 2 * relativePos);
			break;
		}
	}

	if (baseWeight > 0 && baseWeight < 1) {
		if (easeHigh !== 0 && baseWeight > 0.5) {
			const norm = (baseWeight - 0.5) * 2;
			const power = easeHigh > 0 ? 1 + easeHigh * 3 : 1 / (1 - easeHigh * 3);
			baseWeight = 0.5 + 0.5 * norm ** power;
		}
		if (easeLow !== 0 && baseWeight <= 0.5) {
			const norm = baseWeight * 2;
			const power = easeLow > 0 ? 1 + easeLow * 3 : 1 / (1 - easeLow * 3);
			baseWeight = 0.5 * norm ** power;
		}
	}

	return Math.max(0, Math.min(1, baseWeight));
}

/**
 * 1D Gradient deterministic hash noise for Wiggly Selectors.
 */
export function deterministicWigglyNoise(
	seed: number,
	glyphIndex: number,
	phase: number,
	correlation: number,
): number {
	const coord =
		(glyphIndex * (1 - correlation) + correlation) * 12.9898 +
		phase +
		seed * 78.233;
	const raw = Math.sin(coord) * 43758.5453;
	return (raw - Math.floor(raw)) * 2 - 1;
}

/**
 * Deterministic pseudo-random number generator for seeded order shuffling.
 */
export function getShuffledOrder(count: number, seed: number): number[] {
	let s = seed;
	const nextRand = () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};

	const arr = Array.from({ length: count }, (_, i) => i);
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(nextRand() * (i + 1));
		const temp = arr[i];
		arr[i] = arr[j];
		arr[j] = temp;
	}
	return arr;
}

/**
 * Combines consecutive selector weights using After Effects Selector Mode logic.
 */
export function evaluateSelectorCombination(
	prevWeight: number,
	currWeight: number,
	mode: SelectorMode,
): number {
	switch (mode) {
		case "add":
			return Math.max(0, Math.min(1, prevWeight + currWeight));
		case "subtract":
			return Math.max(0, Math.min(1, prevWeight - currWeight));
		case "intersect":
			return prevWeight * currWeight;
		case "min":
			return Math.min(prevWeight, currWeight);
		case "max":
			return Math.max(prevWeight, currWeight);
		case "difference":
			return Math.abs(prevWeight - currWeight);
	}
}
