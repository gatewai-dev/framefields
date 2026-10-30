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
