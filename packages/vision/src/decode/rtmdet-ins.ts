import type { DetectedObject } from "@framefields/core";
import type { InstanceMask, SegmentationResult } from "../types.js";
import { type InputTransform, toSourcePoint } from "./preprocess.js";

/**
 * RTMDet-Ins decode (mmdeploy end2end export — NMS and mask assembly are baked into the graph).
 *
 * Outputs:
 *   dets   [1, N, 5]        x0, y0, x1, y1 (input px), score
 *   labels [1, N]           COCO-80 class index (int64)
 *   masks  [1, N, Hm, Wm]   per-instance probabilities (already sigmoided), input-aligned
 */
export interface RtmdetInsOutputs {
	readonly dets: ArrayLike<number>;
	readonly labels: ArrayLike<number | bigint>;
	/** Omit to decode boxes only (detection without masks). */
	readonly masks?: ArrayLike<number>;
	readonly count: number;
	readonly maskWidth: number;
	readonly maskHeight: number;
}

export interface RtmdetInsDecodeOptions {
	readonly confidence: number;
	/** Class-name filter, case-insensitive (all classes when omitted). */
	readonly classes?: readonly string[];
	readonly classNames: readonly string[];
	readonly transform: InputTransform;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	/** Mask probability threshold. Default 0.5. */
	readonly maskThreshold?: number;
	/** Soft-edge band around the threshold. Default 0.05. */
	readonly featherRadius?: number;
}

/** Source pixels a mask may extend past its box (instance masks are not box-clipped). */
const MASK_BOX_PAD_PX = 8;

export function decodeRtmdetIns(
	out: RtmdetInsOutputs,
	opts: RtmdetInsDecodeOptions,
): SegmentationResult {
	const { sourceWidth: sw, sourceHeight: sh, transform } = opts;
	const classFilter = opts.classes
		? new Set(opts.classes.map((c) => c.toLowerCase()))
		: null;

	const kept: Array<{ index: number; detection: DetectedObject }> = [];
	for (let i = 0; i < out.count; i++) {
		const score = out.dets[i * 5 + 4];
		if (!(score >= opts.confidence)) continue;
		const classIndex = Number(out.labels[i]);
		const category = opts.classNames[classIndex] ?? `class_${classIndex}`;
		if (classFilter && !classFilter.has(category.toLowerCase())) continue;

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

		kept.push({
			index: i,
			detection: {
				category,
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
			},
		});
	}
	kept.sort((a, b) => b.detection.score - a.detection.score);

	const detections = kept.map((k) => k.detection);
	const masks: InstanceMask[] = [];
	if (!out.masks) return { detections, masks };

	const alphaOf = probabilityToAlpha(
		opts.maskThreshold ?? 0.5,
		opts.featherRadius ?? 0.05,
	);
	const { maskWidth: mw, maskHeight: mh } = out;
	const plane = mw * mh;
	// Mask grid px per input px (exports may emit masks below input resolution).
	const gx = mw / transform.inputWidth;
	const gy = mh / transform.inputHeight;

	for (let d = 0; d < kept.length; d++) {
		const { index, detection } = kept[d];
		const box = detection.boundingBox;
		const base = index * plane;
		const bx0 = Math.max(0, Math.floor(box.originX) - MASK_BOX_PAD_PX);
		const by0 = Math.max(0, Math.floor(box.originY) - MASK_BOX_PAD_PX);
		const bx1 = Math.min(
			sw - 1,
			Math.ceil(box.originX + box.width) + MASK_BOX_PAD_PX,
		);
		const by1 = Math.min(
			sh - 1,
			Math.ceil(box.originY + box.height) + MASK_BOX_PAD_PX,
		);

		const mask = new Uint8Array(sw * sh);
		let area = 0;
		for (let sy = by0; sy <= by1; sy++) {
			// source pixel center → input px → mask grid (pixel-center aligned)
			const my = ((sy + 0.5) * transform.scaleY + transform.offsetY) * gy - 0.5;
			const my0 = clamp(Math.floor(my), 0, mh - 1);
			const my1 = Math.min(mh - 1, my0 + 1);
			const fy = clamp(my - my0, 0, 1);
			const row = sy * sw;
			for (let sx = bx0; sx <= bx1; sx++) {
				const mx =
					((sx + 0.5) * transform.scaleX + transform.offsetX) * gx - 0.5;
				const mx0 = clamp(Math.floor(mx), 0, mw - 1);
				const mx1 = Math.min(mw - 1, mx0 + 1);
				const fx = clamp(mx - mx0, 0, 1);
				const p =
					out.masks[base + my0 * mw + mx0] * (1 - fx) * (1 - fy) +
					out.masks[base + my0 * mw + mx1] * fx * (1 - fy) +
					out.masks[base + my1 * mw + mx0] * (1 - fx) * fy +
					out.masks[base + my1 * mw + mx1] * fx * fy;
				const alpha = alphaOf(p);
				if (alpha > 0) {
					mask[row + sx] = alpha;
					area += alpha / 255;
				}
			}
		}

		area = Math.round(area);
		if (area === 0) continue;
		masks.push({
			category: detection.category,
			mask,
			width: sw,
			height: sh,
			area,
			coverage: area / (sw * sh),
			detectionIndex: d,
		});
	}

	return { detections, masks };
}

/**
 * Probability → 0..255 alpha. A hard threshold when `feather` is 0, otherwise a linear ramp
 * across `[threshold − feather, threshold + feather]` for anti-aliased edges.
 */
export function probabilityToAlpha(
	threshold: number,
	feather: number,
): (p: number) => number {
	if (feather <= 0) {
		return (p) => (p > threshold ? 255 : 0);
	}
	const lo = threshold - feather;
	const inv = 255 / (2 * feather);
	return (p) => (p <= lo ? 0 : p >= threshold + feather ? 255 : (p - lo) * inv);
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}
