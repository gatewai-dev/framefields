import { computeIoU } from "../tracking/temporal-object-tracker.js";
import type { PoseKeypoint, PosePerson, PoseResult } from "../types.js";
import { type InputTransform, toSourcePoint } from "./preprocess.js";

/**
 * RTMO decode (one-stage multi-person pose; NMS is baked into the export).
 *
 * Outputs:
 *   dets      [1, N, 5]        x0, y0, x1, y1 (input px), person score
 *   keypoints [1, N, 17, 3]    x, y (input px), keypoint score — COCO-17 order
 */
export interface RtmoOutputs {
	readonly dets: ArrayLike<number>;
	readonly keypoints: ArrayLike<number>;
	readonly count: number;
	/** Values per keypoint (3 for x, y, score). */
	readonly keypointStride: number;
}

export interface RtmoDecodeOptions {
	readonly confidence: number;
	readonly transform: InputTransform;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	/** Drop people with fewer keypoints at visibility ≥ 0.3. Default 3. */
	readonly minVisibleKeypoints?: number;
	/** Suppress a person whose box overlaps a higher-scored one above this IoU. Default 0.6. */
	readonly iouThreshold?: number;
}

export const COCO17_KEYPOINT_COUNT = 17;

/** Keypoint visibility at which a joint counts as seen. */
const VISIBLE = 0.3;

export function decodeRtmo(
	out: RtmoOutputs,
	opts: RtmoDecodeOptions,
): PoseResult {
	const { sourceWidth: sw, sourceHeight: sh, transform } = opts;
	const stride = out.keypointStride;
	const people: PosePerson[] = [];

	for (let i = 0; i < out.count; i++) {
		const score = out.dets[i * 5 + 4];
		if (!(score >= opts.confidence)) continue;

		const p0 = toSourcePoint(out.dets[i * 5], out.dets[i * 5 + 1], transform);
		const p1 = toSourcePoint(
			out.dets[i * 5 + 2],
			out.dets[i * 5 + 3],
			transform,
		);
		const x0 = clamp(p0.x, 0, sw);
		const y0 = clamp(p0.y, 0, sh);
		const width = clamp(p1.x, 0, sw) - x0;
		const height = clamp(p1.y, 0, sh) - y0;
		if (width <= 0 || height <= 0) continue;

		const keypoints: PoseKeypoint[] = [];
		const base = i * COCO17_KEYPOINT_COUNT * stride;
		for (let k = 0; k < COCO17_KEYPOINT_COUNT; k++) {
			const o = base + k * stride;
			const p = toSourcePoint(
				out.keypoints[o],
				out.keypoints[o + 1],
				transform,
			);
			keypoints.push({
				x: clamp(p.x, 0, sw),
				y: clamp(p.y, 0, sh),
				visibility: clamp(out.keypoints[o + 2], 0, 1),
			});
		}

		let visible = 0;
		for (const k of keypoints) if (k.visibility >= VISIBLE) visible++;
		if (visible < (opts.minVisibleKeypoints ?? 3)) continue;

		people.push({
			score,
			boundingBox: {
				originX: x0,
				originY: y0,
				width,
				height,
				normalizedX: x0 / sw,
				normalizedY: y0 / sh,
				normalizedWidth: width / sw,
				normalizedHeight: height / sh,
			},
			keypoints,
		});
	}

	// Highest-confidence person first — the bundle's named signals track it as primary.
	// The export's built-in NMS lets near-identical low-score duplicates through; drop them.
	people.sort((a, b) => b.score - a.score);
	const iou = opts.iouThreshold ?? 0.6;
	const kept: PosePerson[] = [];
	for (const p of people) {
		if (!kept.some((k) => isDuplicate(k, p, iou))) kept.push(p);
	}
	return { people: kept };
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Same person twice: boxes overlap above `iou`, or the joints both detections can see sit
 * within 10% of the stronger detection's box size of each other (boxes may differ when one
 * of them also covers a flowing garment or a shadow).
 */
function isDuplicate(a: PosePerson, b: PosePerson, iou: number): boolean {
	if (computeIoU(a.boundingBox, b.boundingBox) > iou) return true;
	const scale = Math.sqrt(a.boundingBox.width * a.boundingBox.height);
	let sum = 0;
	let n = 0;
	for (let k = 0; k < a.keypoints.length; k++) {
		const ka = a.keypoints[k];
		const kb = b.keypoints[k];
		if (ka.visibility < VISIBLE || kb.visibility < VISIBLE) continue;
		sum += Math.hypot(ka.x - kb.x, ka.y - kb.y);
		n++;
	}
	return n >= 3 && sum / n < 0.1 * scale;
}
