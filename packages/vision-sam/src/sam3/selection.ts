/**
 * Text-selected instances as one mask (`sam3.merge`): each pixel keeps its most confident
 * instance's logit, so the union is positive wherever any instance is.
 */
export function mergeSelections(masks: readonly Float32Array[]): Float32Array {
	const merged = new Float32Array(masks[0]?.length ?? 0).fill(-Infinity);
	for (const mask of masks)
		for (let i = 0; i < merged.length; i++)
			merged[i] = Math.max(merged[i] ?? -Infinity, mask[i] ?? -Infinity);
	return merged;
}

/** Logit SAM uses for a given mask's pixels (and its object score): ±10. */
export const MASK_LOGIT = 10;

/** A re-detected instance is new while tracked objects cover less than this share of it. */
const NEW_OBJECT_COVERAGE = 0.5;

/** A tracked object's 1008² logits and presence logit. */
export interface TrackedMask {
	readonly logits: Float32Array;
	readonly score: number;
}

/** Where any present tracked object is, on the 288² concept grid, as ±10 logits. */
export function coveredCells(tracked: readonly TrackedMask[]): Float32Array {
	const covered = new Float32Array(288 * 288).fill(-MASK_LOGIT);
	for (const { logits, score } of tracked) {
		if (score <= 0) continue;
		for (let y = 0; y < 288; y++) {
			const row = Math.floor(((y + 0.5) * 1008) / 288) * 1008;
			for (let x = 0; x < 288; x++)
				if ((logits[row + Math.floor(((x + 0.5) * 1008) / 288)] ?? 0) > 0)
					covered[y * 288 + x] = MASK_LOGIT;
		}
	}
	return covered;
}

/** Re-detected 288² instances that the covered cells do not already hold. */
export function uncovered(
	found: readonly Float32Array[],
	covered: Float32Array,
): Float32Array[] {
	return found.filter((instance) => {
		let inside = 0;
		let area = 0;
		for (let i = 0; i < instance.length; i++) {
			if ((instance[i] ?? 0) <= 0) continue;
			area++;
			if ((covered[i] ?? 0) > 0) inside++;
		}
		return area > 0 && inside / area < NEW_OBJECT_COVERAGE;
	});
}

/** 1008² seed logits that keep a present tracked mask at full resolution and add `added` to it. */
export function keepTracked(
	tracked: TrackedMask | undefined,
	added: Float32Array,
): Float32Array {
	if (!tracked || tracked.score <= 0) return added;
	return Float32Array.from(added, (value, i) =>
		(tracked.logits[i] ?? 0) > 0 ? MASK_LOGIT : value,
	);
}
