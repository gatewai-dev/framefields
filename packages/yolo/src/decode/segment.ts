import type { YoloInstanceMask, YoloSegmentationResult } from "../types.js";
import {
	type DetectDecodeOptions,
	decodeYoloBoxes,
	toDetectedObject,
} from "./detect.js";

/**
 * Instance segmentation decode.
 *
 * Head:  [1, 4 + nc + 32, 8400]  — the 32 trailing rows are per-detect mask coefficients.
 * Proto: [1, 32, protoDim, protoDim] (protoDim = imgsz / 4, e.g. 160 at 640).
 *
 * Per kept detection:  mask = sigmoid(Σ coeff_c · proto_c) → threshold 0.5, then bilinear
 * upscaled from the 160-grid directly into the ORIGINAL source frame (letterbox-inverse),
 * restricted to the detection box so masks stay tight and cheap.
 */

export function decodeSegmentOutput(
	output: Float32Array,
	proto: Float32Array,
	anchors: number,
	nc: number,
	protoDim: number,
	opts: DetectDecodeOptions,
): YoloSegmentationResult {
	const kept = decodeYoloBoxes(output, anchors, nc, opts);

	const detections = kept.map((box) => toDetectedObject(box, opts));
	const masks: YoloInstanceMask[] = [];

	const { scale, dw, dh, size } = opts.params;
	const { sourceWidth: sw, sourceHeight: sh } = opts;
	const maskThreshold = opts.maskThreshold ?? 0.5;
	const feather = opts.featherRadius !== undefined ? opts.featherRadius : 0.05;
	const maskLogit = Math.log(maskThreshold / (1 - maskThreshold));
	const tMin = maskThreshold - feather;
	const tMax = maskThreshold + feather;
	const invTwoFeather = feather > 0 ? 1 / (2 * feather) : 0;

	for (let i = 0; i < kept.length; i++) {
		const box = kept[i];
		const det = detections[i];

		// Mask coefficients for this detection: rows (4 + nc) .. (4 + nc + 31)
		const coeffBase = (4 + nc) * anchors + box.anchorIndex;
		const step = anchors;

		// Source-space box (clamped, expanded slightly so the silhouette isn't clipped)
		const padPx = 8;
		const sx0 = Math.max(0, Math.floor((box.x0 - dw) / scale) - padPx);
		const sy0 = Math.max(0, Math.floor((box.y0 - dh) / scale) - padPx);
		const sx1 = Math.min(sw - 1, Math.ceil((box.x1 - dw) / scale) + padPx);
		const sy1 = Math.min(sh - 1, Math.ceil((box.y1 - dh) / scale) + padPx);
		if (sx1 < sx0 || sy1 < sy0) continue;

		// Single accumulation pass over the box region, bilinear from the proto grid:
		//   source (sx, sy) → input (dw + sx·scale, dh + sy·scale) → grid (… / size · protoDim)
		const mask = new Uint8Array(sw * sh);
		const inv = protoDim / size;
		let area = 0;

		for (let sy = sy0; sy <= sy1; sy++) {
			const gyy = (dh + sy * scale) * inv;
			const gy0 = Math.floor(gyy);
			const fy = gyy - gy0;
			const gy1 = Math.min(protoDim - 1, gy0 + 1);
			const maskRow = sy * sw;

			for (let sx = sx0; sx <= sx1; sx++) {
				const gxx = (dw + sx * scale) * inv;
				const gx0 = Math.floor(gxx);
				const fx = gxx - gx0;
				const gx1 = Math.min(protoDim - 1, gx0 + 1);

				// Bilinear over proto grid
				let acc = 0;
				for (let c = 0; c < 32; c++) {
					const coeff = output[coeffBase + c * step];
					if (coeff === 0) continue;
					const rowBase = c * protoDim * protoDim;
					const v00 = proto[rowBase + gy0 * protoDim + gx0];
					const v10 = proto[rowBase + gy0 * protoDim + gx1];
					const v01 = proto[rowBase + gy1 * protoDim + gx0];
					const v11 = proto[rowBase + gy1 * protoDim + gx1];
					const interp =
						v00 * (1 - fx) * (1 - fy) +
						v10 * fx * (1 - fy) +
						v01 * (1 - fx) * fy +
						v11 * fx * fy;
					acc += coeff * interp;
				}

				if (feather <= 0) {
					if (acc > maskLogit) {
						mask[maskRow + sx] = 255;
						area++;
					}
				} else {
					const alpha = acc > 16 ? 1 : acc < -16 ? 0 : 1 / (1 + Math.exp(-acc));
					let alphaNorm = 0;
					if (alpha >= tMax) {
						alphaNorm = 1;
					} else if (alpha > tMin) {
						alphaNorm = (alpha - tMin) * invTwoFeather;
					}
					const alphaOut = Math.round(alphaNorm * 255);
					if (alphaOut > 0) {
						mask[maskRow + sx] = alphaOut;
						area += alphaNorm;
					}
				}
			}
		}

		area = Math.round(area);
		if (area === 0) continue;

		masks.push({
			category: det.category,
			mask,
			width: sw,
			height: sh,
			area,
			coverage: sw * sh > 0 ? area / (sw * sh) : 0,
			detectionIndex: i,
		});
	}

	return { detections, masks };
}
