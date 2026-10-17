/**
 * RTMDet-Ins post-processing, done here instead of inside the ONNX graph.
 *
 * The mmdeploy end2end export runs top-k, per-class NMS and mask assembly in
 * the graph and returns a full input-sized mask for each of up to 100
 * detections (40 on a typical frame: ~65 MB of floats). The runner instead
 * cuts the graph before its first data-dependent op (see `RTMDET_INS_HEAD`)
 * and reproduces the tail exactly:
 *
 *   1. top 5000 anchors by their best class score;
 *   2. ONNX NonMaxSuppression per class (IoU > 0.6 suppresses, scores > 0.05,
 *      at most 200 per class);
 *   3. the 100 best (class, box) pairs;
 *   4. masks on demand: a 3-layer dynamic 1×1 conv over the 8 mask features
 *      plus each pixel's offset from the anchor, at 1/8 of the input size.
 *      The logits are upsampled (bilinear) and squashed by the decoder.
 *
 * Constants and layer layout match the export's graph; `models.e2e.test.ts`
 * checks the result against the end2end outputs.
 */

/** Head tensors of the mmdeploy RTMDet-Ins exports (all variants). */
export const RTMDET_INS_HEAD = {
	/** [1, A, 80] class probabilities (sigmoided). */
	scores: "/Sigmoid_output_0",
	/** [1, A, 4] x0, y0, x1, y1 in input pixels. */
	boxes: "/Concat_7_output_0",
	/** [1, A, 169] dynamic conv parameters per anchor. */
	kernels: "/Concat_5_output_0",
	/** [1, 8, H/8, W/8] mask features. */
	maskFeatures: "/bbox_head/mask_head/projection/Conv_output_0",
} as const;

const PRE_NMS = 5000;
// float32, as the graph compares them: a float32 score of 0.05 does not pass.
const IOU_THRESHOLD = Math.fround(0.6);
const SCORE_FLOOR = Math.fround(0.05);
const MAX_PER_CLASS = 200;
const MAX_DETECTIONS = 100;
const STRIDES = [8, 16, 32] as const;
/** Mask features are at stride 8; relative offsets are divided by stride × 8. */
const MASK_STRIDE = 8;
const MASK_CHANNELS = 8;
const KERNEL_SIZE = 169;

export interface RtmdetInsHeadOutputs {
	readonly scores: Float32Array;
	readonly boxes: Float32Array;
	readonly kernels: Float32Array;
	readonly maskFeatures: Float32Array;
	readonly anchors: number;
	readonly classes: number;
	readonly maskWidth: number;
	readonly maskHeight: number;
	/** Model input size; anchor positions derive from it. */
	readonly inputWidth: number;
	readonly inputHeight: number;
}

export interface RtmdetInsInstance {
	readonly anchor: number;
	readonly classIndex: number;
	readonly score: number;
}

/** Steps 1–3: the detections the end2end graph would return, best first. */
export function selectInstances(
	head: RtmdetInsHeadOutputs,
): RtmdetInsInstance[] {
	const { scores, boxes, anchors, classes } = head;

	// 1. Best class score per anchor, then the top PRE_NMS anchors.
	const best = new Float32Array(anchors);
	for (let a = 0; a < anchors; a++) {
		let max = 0;
		const row = a * classes;
		for (let c = 0; c < classes; c++) {
			const s = scores[row + c] as number;
			if (s > max) max = s;
		}
		best[a] = max;
	}
	// Anchors that can't pass the score floor in any class are never selected.
	const order: number[] = [];
	for (let a = 0; a < anchors; a++) {
		if ((best[a] as number) > SCORE_FLOOR) order.push(a);
	}
	order.sort((x, y) => (best[y] as number) - (best[x] as number) || x - y);
	if (order.length > PRE_NMS) order.length = PRE_NMS;

	// 2. Per-class NMS over those anchors.
	const picked: RtmdetInsInstance[] = [];
	const candidates: number[] = [];
	const kept: number[] = [];
	for (let c = 0; c < classes; c++) {
		candidates.length = 0;
		for (const a of order) {
			if ((scores[a * classes + c] as number) > SCORE_FLOOR) candidates.push(a);
		}
		if (candidates.length === 0) continue;
		candidates.sort(
			(x, y) =>
				(scores[y * classes + c] as number) -
					(scores[x * classes + c] as number) || x - y,
		);
		kept.length = 0;
		for (const a of candidates) {
			if (kept.length >= MAX_PER_CLASS) break;
			let suppressed = false;
			for (const k of kept) {
				if (iou(boxes, a, k) > IOU_THRESHOLD) {
					suppressed = true;
					break;
				}
			}
			if (!suppressed) {
				kept.push(a);
				picked.push({
					anchor: a,
					classIndex: c,
					score: scores[a * classes + c] as number,
				});
			}
		}
	}

	// 3. The best MAX_DETECTIONS pairs.
	picked.sort((x, y) => y.score - x.score);
	if (picked.length > MAX_DETECTIONS) picked.length = MAX_DETECTIONS;
	return picked;
}

function iou(boxes: Float32Array, a: number, b: number): number {
	const a0 = boxes[a * 4] as number;
	const a1 = boxes[a * 4 + 1] as number;
	const a2 = boxes[a * 4 + 2] as number;
	const a3 = boxes[a * 4 + 3] as number;
	const b0 = boxes[b * 4] as number;
	const b1 = boxes[b * 4 + 1] as number;
	const b2 = boxes[b * 4 + 2] as number;
	const b3 = boxes[b * 4 + 3] as number;
	const w = Math.min(a2, b2) - Math.max(a0, b0);
	const h = Math.min(a3, b3) - Math.max(a1, b1);
	if (w <= 0 || h <= 0) return 0;
	const inter = w * h;
	const union = (a2 - a0) * (a3 - a1) + (b2 - b0) * (b3 - b1) - inter;
	return union > 0 ? inter / union : 0;
}

/** Anchor position and stride, in input pixels (mmdet point priors, offset 0). */
export function anchorPrior(
	anchor: number,
	inputWidth: number,
	inputHeight: number,
): { x: number; y: number; stride: number } {
	let base = 0;
	for (const stride of STRIDES) {
		const cols = Math.ceil(inputWidth / stride);
		const count = cols * Math.ceil(inputHeight / stride);
		if (anchor < base + count) {
			const i = anchor - base;
			return {
				x: (i % cols) * stride,
				y: Math.floor(i / cols) * stride,
				stride,
			};
		}
		base += count;
	}
	throw new RangeError(`anchor ${anchor} is out of range`);
}

/**
 * Step 4: mask logits for one anchor, `maskHeight × maskWidth`, row-major.
 * Writes into `out` when it is large enough.
 */
export function maskLogits(
	head: RtmdetInsHeadOutputs,
	anchor: number,
	out?: Float32Array,
): Float32Array {
	const { kernels, maskFeatures, maskWidth: mw, maskHeight: mh } = head;
	const plane = mw * mh;
	const logits = out && out.length >= plane ? out : new Float32Array(plane);
	const prior = anchorPrior(anchor, head.inputWidth, head.inputHeight);
	const k = kernels.subarray(anchor * KERNEL_SIZE, (anchor + 1) * KERNEL_SIZE);
	// Layout: w1 [8×10], w2 [8×8], w3 [1×8], b1 [8], b2 [8], b3 [1].
	const w1 = 0;
	const w2 = 80;
	const w3 = 144;
	const b1 = 152;
	const b2 = 160;
	const b3 = 168;
	const scale = 1 / (prior.stride * MASK_STRIDE);
	const input = new Float32Array(2 + MASK_CHANNELS);
	const hidden1 = new Float32Array(8);
	const hidden2 = new Float32Array(8);

	for (let y = 0; y < mh; y++) {
		const relY = (prior.y - y * MASK_STRIDE) * scale;
		for (let x = 0; x < mw; x++) {
			const p = y * mw + x;
			input[0] = (prior.x - x * MASK_STRIDE) * scale;
			input[1] = relY;
			for (let c = 0; c < MASK_CHANNELS; c++) {
				input[2 + c] = maskFeatures[c * plane + p] as number;
			}
			for (let o = 0; o < 8; o++) {
				let sum = k[b1 + o] as number;
				const row = w1 + o * 10;
				for (let i = 0; i < 10; i++) {
					sum += (k[row + i] as number) * (input[i] as number);
				}
				hidden1[o] = sum > 0 ? sum : 0;
			}
			for (let o = 0; o < 8; o++) {
				let sum = k[b2 + o] as number;
				const row = w2 + o * 8;
				for (let i = 0; i < 8; i++) {
					sum += (k[row + i] as number) * (hidden1[i] as number);
				}
				hidden2[o] = sum > 0 ? sum : 0;
			}
			let sum = k[b3] as number;
			for (let i = 0; i < 8; i++) {
				sum += (k[w3 + i] as number) * (hidden2[i] as number);
			}
			logits[p] = sum;
		}
	}
	return logits;
}
