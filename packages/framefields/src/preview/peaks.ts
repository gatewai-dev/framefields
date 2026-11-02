/** Waveform peaks of a stereo mix: the loudest sample of either channel per bin, 0–1. */
export function computePeaks(
	left: Float32Array,
	right: Float32Array,
	bins: number,
): number[] {
	const peaks = new Array<number>(bins).fill(0);
	if (left.length === 0) return peaks;
	const per = left.length / bins;
	for (let b = 0; b < bins; b++) {
		const start = Math.floor(b * per);
		const end = Math.min(left.length, Math.floor((b + 1) * per));
		let max = 0;
		for (let i = start; i < end; i++) {
			const v = Math.max(Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
			if (v > max) max = v;
		}
		peaks[b] = Math.min(1, max);
	}
	return peaks;
}

/** Bins the page's waveform draws. */
export const PEAK_BINS = 1200;

/** A mix counts as silent below this peak. */
export const SILENT_PEAK = 0.001;
