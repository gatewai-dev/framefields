import type {
	YoloPoseKeypoint,
	YoloPosePerson,
	YoloPoseResult,
} from "../types.js";
import type { LetterboxParams } from "./letterbox.js";

/**
 * Pose decode.
 *
 * Head: [1, 4 + nc + 17·3, 8400], nc = 1 ("person"):
 *   rows 0-3 box xywh (input px), row 4 person confidence (sigmoided in graph),
 *   rows 5..  per keypoint triplet (x, y, visibility) — x/y in input px, visibility sigmoided.
 */
export interface PoseDecodeOptions {
	readonly confidence: number;
	readonly params: LetterboxParams;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
}

export function decodePoseOutput(
	output: Float32Array,
	anchors: number,
	opts: PoseDecodeOptions,
): YoloPoseResult {
	const { scale, dw, dh } = opts.params;
	const { sourceWidth: sw, sourceHeight: sh } = opts;

	const people: YoloPosePerson[] = [];

	for (let a = 0; a < anchors; a++) {
		const score = output[4 * anchors + a];
		if (score < opts.confidence) continue;

		const cx = output[a];
		const cy = output[anchors + a];
		const w = output[2 * anchors + a];
		const h = output[3 * anchors + a];
		if (w <= 0 || h <= 0) continue;

		const x0 = Math.max(0, Math.min(sw, (cx - w / 2 - dw) / scale));
		const y0 = Math.max(0, Math.min(sh, (cy - h / 2 - dh) / scale));
		const x1 = Math.max(0, Math.min(sw, (cx + w / 2 - dw) / scale));
		const y1 = Math.max(0, Math.min(sh, (cy + h / 2 - dh) / scale));
		const boxW = Math.max(0, x1 - x0);
		const boxH = Math.max(0, y1 - y0);

		const keypoints: Array<YoloPoseKeypoint> = [];
		for (let k = 0; k < 17; k++) {
			const kx = Math.max(
				0,
				Math.min(sw, (output[(5 + 3 * k) * anchors + a] - dw) / scale),
			);
			const ky = Math.max(
				0,
				Math.min(sh, (output[(6 + 3 * k) * anchors + a] - dh) / scale),
			);
			const vis = output[(7 + 3 * k) * anchors + a];
			keypoints.push({
				x: kx,
				y: ky,
				visibility: Math.max(0, Math.min(1, vis)),
			});
		}

		people.push({
			score,
			boundingBox: {
				originX: x0,
				originY: y0,
				width: boxW,
				height: boxH,
				normalizedX: sw > 0 ? x0 / sw : 0,
				normalizedY: sh > 0 ? y0 / sh : 0,
				normalizedWidth: sw > 0 ? boxW / sw : 0,
				normalizedHeight: sh > 0 ? boxH / sh : 0,
			},
			keypoints,
		});
	}

	// Highest-confidence person first — the bundle's named signals track it as primary
	people.sort((a, b) => b.score - a.score);
	return { people };
}
