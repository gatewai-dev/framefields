import type { YoloOBBDetection, YoloOBBResult } from "../types.js";
import type { DetectDecodeOptions } from "./detect.js";
import { type NmsBox, nms } from "./nms.js";

/**
 * Oriented-bounding-box decode.
 *
 * Head: `[1, 5 + nc, anchors]` — rows 0..3 are the rotated box (cx, cy, w, h) in INPUT pixel
 * space, rows 4..4+nc-1 are sigmoided class scores, and the final row `4 + nc` is the box
 * angle in radians (the ultralytics ONNX export folds the DFL/dist2rbox/angle transform into
 * the graph, exactly like the detect head folds DFL + sigmoid).
 *
 * The angle row index is overridable (`angleRow`) because third-party exports have shipped
 * both orderings; the default matches ultralytics. Rotated-IoU NMS is deliberately NOT used
 * in v1 — the repository's class-aware axis-aligned NMS runs on the rotated box's extents,
 * which is fast and adequate for HUD/annotation use.
 */

export interface ObbDecodeOptions extends DetectDecodeOptions {
	/** Row index (within the per-anchor column) holding the angle. Defaults to `4 + nc`. */
	readonly angleRow?: number;
}

interface ObbCandidate extends NmsBox {
	readonly angle: number;
}

/** Projects the 4 rotated corners (input px) and the axis-aligned extent back to source px. */
function projectCorners(
	cx: number,
	cy: number,
	w: number,
	h: number,
	angle: number,
	opts: DetectDecodeOptions,
): {
	corners: ReadonlyArray<readonly [number, number]>;
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	const { scale, dw, dh } = opts.params;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const hw = w / 2;
	const hh = h / 2;
	const local: ReadonlyArray<readonly [number, number]> = [
		[-hw, -hh],
		[hw, -hh],
		[hw, hh],
		[-hw, hh],
	];
	const corners: Array<readonly [number, number]> = [];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [lx, ly] of local) {
		const rx = cx + lx * cos - ly * sin;
		const ry = cy + lx * sin + ly * cos;
		const sx = (rx - dw) / scale;
		const sy = (ry - dh) / scale;
		corners.push([sx, sy]);
		if (sx < minX) minX = sx;
		if (sy < minY) minY = sy;
		if (sx > maxX) maxX = sx;
		if (sy > maxY) maxY = sy;
	}
	return { corners, minX, minY, maxX, maxY };
}

export function decodeObbOutput(
	output: Float32Array,
	anchors: number,
	nc: number,
	opts: ObbDecodeOptions,
): YoloOBBResult {
	const angleRow = opts.angleRow ?? 4 + nc;
	const classFilter = opts.classes
		? new Set(opts.classes.map((c) => c.toLowerCase()))
		: null;

	const candidates: ObbCandidate[] = [];
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
		const angle = output[angleRow * anchors + a];
		if (!Number.isFinite(angle)) continue;
		candidates.push({
			x0: cx - w / 2,
			y0: cy - h / 2,
			x1: cx + w / 2,
			y1: cy + h / 2,
			score: bestScore,
			classIndex: bestClass,
			anchorIndex: a,
			angle,
		});
	}

	const kept = nms(candidates, opts.iouThreshold);
	const detections: YoloOBBDetection[] = [];

	for (const box of kept) {
		const cand = box as ObbCandidate;
		const cx = output[cand.anchorIndex];
		const cy = output[anchors + cand.anchorIndex];
		const w = output[2 * anchors + cand.anchorIndex];
		const h = output[3 * anchors + cand.anchorIndex];
		const { corners, minX, minY, maxX, maxY } = projectCorners(
			cx,
			cy,
			w,
			h,
			cand.angle,
			opts,
		);
		const sw = opts.sourceWidth;
		const sh = opts.sourceHeight;
		const originX = Math.max(0, Math.min(sw, minX));
		const originY = Math.max(0, Math.min(sh, minY));
		const width = Math.max(0, Math.min(sw, maxX) - originX);
		const height = Math.max(0, Math.min(sh, maxY) - originY);

		detections.push({
			category: opts.classNames[cand.classIndex] ?? `class_${cand.classIndex}`,
			classIndex: cand.classIndex,
			score: cand.score,
			boundingBox: {
				originX,
				originY,
				width,
				height,
				normalizedX: sw > 0 ? originX / sw : 0,
				normalizedY: sh > 0 ? originY / sh : 0,
				normalizedWidth: sw > 0 ? width / sw : 0,
				normalizedHeight: sh > 0 ? height / sh : 0,
				angle: cand.angle,
			},
			corners,
		});
	}

	return { detections };
}
