import type { DetectedObject } from "@gitframes/core";
import type { LetterboxParams } from "./letterbox.js";
import { type NmsBox, nms } from "./nms.js";

/**
 * Shared YOLO head decode core.
 *
 * The ultralytics ONNX export bakes the decode into the graph:
 *  - box rows are in INPUT pixel space (0..imgsz, letterboxed), xywh format
 *  - class rows are already sigmoided (probabilities, 0..1)
 *  - layout per anchor: [cx, cy, w, h, cls_0..cls_{nc-1}], column-major over anchors
 */
export interface DetectDecodeOptions {
	readonly confidence: number; // default 0.25
	readonly iouThreshold: number; // default 0.45
	readonly classes?: readonly DetectedObject["category"][]; // COCO name filter
	readonly classNames: readonly string[];
	readonly params: LetterboxParams;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	/** Sigmoid threshold for instance-mask pixels. Lower → fuller, blobbier masks. Default 0.5. */
	readonly maskThreshold?: number;
	/** Transition band radius around maskThreshold for anti-aliased soft alpha. Default 0.05. */
	readonly featherRadius?: number;
}

export function decodeYoloBoxes(
	output: Float32Array,
	anchors: number,
	nc: number,
	opts: DetectDecodeOptions,
): NmsBox[] {
	const candidates: NmsBox[] = [];
	const classFilter = opts.classes
		? new Set(opts.classes.map((c) => c.toLowerCase()))
		: null;

	for (let a = 0; a < anchors; a++) {
		let bestScore = -1;
		let bestClass = -1;
		for (let c = 0; c < nc; c++) {
			const score = output[(4 + c) * anchors + a];
			if (score > bestScore) {
				bestScore = score;
				bestClass = c;
			}
		}
		if (bestScore < opts.confidence) continue;
		if (
			classFilter &&
			!classFilter.has((opts.classNames[bestClass] ?? "").toLowerCase())
		) {
			continue;
		}
		const cx = output[a];
		const cy = output[anchors + a];
		const w = output[2 * anchors + a];
		const h = output[3 * anchors + a];
		if (w <= 0 || h <= 0) continue;
		const halfW = w / 2;
		const halfH = h / 2;
		candidates.push({
			x0: cx - halfW,
			y0: cy - halfH,
			x1: cx + halfW,
			y1: cy + halfH,
			score: bestScore,
			classIndex: bestClass,
			anchorIndex: a,
		});
	}

	return nms(candidates, opts.iouThreshold);
}

/** Maps an NMS-kept box from input space to a core `DetectedObject` in source pixel space. */
export function toDetectedObject(
	box: NmsBox,
	opts: DetectDecodeOptions,
): DetectedObject {
	const { scale, dw, dh } = opts.params;
	const { sourceWidth: sw, sourceHeight: sh } = opts;

	const x0 = Math.max(0, Math.min(sw, (box.x0 - dw) / scale));
	const y0 = Math.max(0, Math.min(sh, (box.y0 - dh) / scale));
	const x1 = Math.max(0, Math.min(sw, (box.x1 - dw) / scale));
	const y1 = Math.max(0, Math.min(sh, (box.y1 - dh) / scale));
	const width = Math.max(0, x1 - x0);
	const height = Math.max(0, y1 - y0);

	return {
		category: opts.classNames[box.classIndex] ?? `class_${box.classIndex}`,
		score: box.score,
		boundingBox: {
			originX: x0,
			originY: y0,
			width,
			height,
			normalizedX: sw > 0 ? x0 / sw : 0,
			normalizedY: sh > 0 ? y0 / sh : 0,
			normalizedWidth: sw > 0 ? width / sw : 0,
			normalizedHeight: sh > 0 ? height / sh : 0,
		},
	};
}

/** Full detect-head decode: hidden state → DetectedObject[] (already NMS'd, source pixels). */
export function decodeDetectOutput(
	output: Float32Array,
	anchors: number,
	nc: number,
	opts: DetectDecodeOptions,
): DetectedObject[] {
	const kept = decodeYoloBoxes(output, anchors, nc, opts);
	return kept.map((box) => toDetectedObject(box, opts));
}
