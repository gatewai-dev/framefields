import { getFingerprint } from "./virtual-media.js";

/**
 * Checks if a cached node result can be reused based on source fingerprint.
 * Returns the valid cached result, or null if the cache is stale.
 */
export function checkNodeResultCache<T extends { sourceFingerprint?: string }>(
	currentResult: T | undefined | null,
	input: unknown,
): T | null {
	if (!currentResult?.sourceFingerprint) return null;

	const inputFingerprint = getFingerprint(input);
	if (currentResult.sourceFingerprint !== inputFingerprint) return null;

	return currentResult;
}

/**
 * Creates a fresh result with a source fingerprint stamp.
 */
export function stampResult<T>(
	result: T,
	input: unknown,
): T & { sourceFingerprint: string } {
	return {
		...result,
		sourceFingerprint: getFingerprint(input),
	};
}
