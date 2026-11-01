import type { DepthMap } from "../types.js";

/** Model input size for a frame: the short side at `short`, the other kept to the frame's aspect, both multiples of the 14 px ViT patch. */
export function depthInputSize(
	width: number,
	height: number,
	short: number,
): [number, number] {
	const snap = (v: number) => Math.max(14, Math.round(v / 14) * 14);
	return width >= height
		? [snap((short * width) / height), snap(short)]
		: [snap(short), snap((short * height) / width)];
}

/** Share of samples clipped at each end, so a stray hot pixel does not set the range. */
const TAIL = 0.01;

/**
 * Depth Anything decode: `predicted_depth [1, h, w]` relative inverse depth →
 * 0 (farthest) … 1 (nearest), at the model's resolution. The range is the
 * frame's 1st…99th percentile, so it is relative to the frame, not metric.
 */
export function decodeDepth(
	predicted: ArrayLike<number>,
	width: number,
	height: number,
): DepthMap {
	const n = width * height;
	const step = Math.max(1, Math.floor(n / 4096));
	const samples: number[] = [];
	for (let i = 0; i < n; i += step) samples.push(predicted[i] as number);
	samples.sort((a, b) => a - b);
	const lo = samples[Math.floor((samples.length - 1) * TAIL)] as number;
	const hi = samples[Math.ceil((samples.length - 1) * (1 - TAIL))] as number;
	const scale = hi > lo ? 1 / (hi - lo) : 0;
	const data = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		data[i] = Math.min(1, Math.max(0, ((predicted[i] as number) - lo) * scale));
	}
	return { data, width, height };
}
