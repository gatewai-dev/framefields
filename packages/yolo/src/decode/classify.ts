import type { DetectedObject } from "@gitframes/core";
import type { YoloClassifyResult } from "../types.js";

/** Classification head: [1, nc] logits → softmax → top-5. */
export function decodeClassifyOutput(
	output: Float32Array,
	nc: number,
): YoloClassifyResult {
	const count = Math.min(nc, output.length);

	// Numerically stable softmax
	let max = -Infinity;
	for (let i = 0; i < count; i++) {
		if (output[i] > max) max = output[i];
	}
	let sum = 0;
	const probs = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		const p = Math.exp(output[i] - max);
		probs[i] = p;
		sum += p;
	}
	const inv = sum > 0 ? 1 / sum : 0;
	for (let i = 0; i < count; i++) {
		probs[i] *= inv;
	}

	const top5: Array<{ index: number; score: number }> = [];
	for (let i = 0; i < Math.min(5, probs.length); i++) {
		let best = -1;
		let bestScore = -1;
		for (let c = 0; c < probs.length; c++) {
			if (probs[c] > bestScore) {
				bestScore = probs[c];
				best = c;
			}
		}
		if (best < 0) break;
		top5.push({ index: best, score: bestScore });
		probs[best] = -1;
	}

	return {
		top1: top5[0]?.index ?? 0,
		top1Score: top5[0]?.score ?? 0,
		top5,
	};
}

/** Optional per-frame class histogram tensor for ML pipelines: [nc]. */
export function classHistogram(
	detections: readonly { readonly classIndex: number }[],
	nc: number,
): Float32Array {
	const hist = new Float32Array(nc);
	for (const d of detections) {
		if (d.classIndex >= 0 && d.classIndex < nc) {
			hist[d.classIndex] += 1;
		}
	}
	return hist;
}

export type { DetectedObject };
