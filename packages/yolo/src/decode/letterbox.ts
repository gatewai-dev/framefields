/**
 * Letterbox preprocessing + inverse mapping.
 *
 * The YOLO ONNX export consumes a square RGB float tensor (imgsz × imgsz), values / 255,
 * gray (114) padding on the short dimension — the "letterbox". Box/keypoint outputs are
 * in input-pixel space; this module owns the resize and the mapping back to source pixels.
 */

export const YOLO_LETTERBOX_PAD_VALUE = 114;

export interface LetterboxParams {
	readonly scale: number;
	readonly dw: number; // horizontal padding (input px)
	readonly dh: number; // vertical padding (input px)
	readonly inputWidth: number; // scaled (unpadded) content size
	readonly inputHeight: number;
	readonly size: number; // imgsz
}

export interface RgbaImage {
	readonly data: Uint8ClampedArray | Uint8Array;
	readonly width: number;
	readonly height: number;
}

export function computeLetterbox(
	srcW: number,
	srcH: number,
	imgsz: number,
): LetterboxParams {
	const scale = Math.min(imgsz / srcW, imgsz / srcH);
	const inputWidth = Math.round(srcW * scale);
	const inputHeight = Math.round(srcH * scale);
	return {
		scale,
		dw: (imgsz - inputWidth) / 2,
		dh: (imgsz - inputHeight) / 2,
		inputWidth,
		inputHeight,
		size: imgsz,
	};
}

/** Map decoded input-space coordinates back to source pixel space. */
export function unletterboxPoint(
	x: number,
	y: number,
	params: LetterboxParams,
): { x: number; y: number } {
	return {
		x: (x - params.dw) / params.scale,
		y: (y - params.dh) / params.scale,
	};
}

/**
 * Resizes RGBA -> NCHW float32 tensor with bilinear sampling + gray padding.
 * Layout: [1, 3, imgsz, imgsz], channel stride = imgsz * imgsz.
 * Reuses `out` / `outData` when provided (hot-path frame loop).
 */
export function letterboxToTensor(
	image: RgbaImage,
	imgsz = 640,
	out?: Float32Array,
): { tensor: Float32Array; params: LetterboxParams } {
	const { width: srcW, height: srcH } = image;
	const params = computeLetterbox(srcW, srcH, imgsz);
	const { scale, dw, dh, inputWidth, inputHeight } = params;

	const channelStride = imgsz * imgsz;
	if (!out || out.length < 3 * channelStride) {
		out = new Float32Array(3 * channelStride);
	} else {
		out.fill(0, 0, 3 * channelStride);
	}

	const src = image.data;
	const pad = YOLO_LETTERBOX_PAD_VALUE / 255;

	const x0 = Math.ceil(dw);
	const y0 = Math.ceil(dh);
	const x1 = Math.floor(dw + inputWidth) - 1;
	const y1 = Math.floor(dh + inputHeight) - 1;

	const rPlane = out.subarray(0, channelStride);
	const gPlane = out.subarray(channelStride, 2 * channelStride);
	const bPlane = out.subarray(2 * channelStride, 3 * channelStride);

	for (let y = 0; y < imgsz; y++) {
		const rowBase = y * imgsz;
		const paddedRow = y < y0 || y > y1;
		for (let x = 0; x < imgsz; x++) {
			let r = pad;
			let g = pad;
			let b = pad;
			if (!paddedRow && x >= x0 && x <= x1) {
				// Bilinear sample from the source at (sx, sy) in source pixels
				const sx = (x - dw) / scale;
				const sy = (y - dh) / scale;
				const x0s = Math.floor(sx);
				const y0s = Math.floor(sy);
				const fx = sx - x0s;
				const fy = sy - y0s;
				const x1s = Math.min(srcW - 1, x0s + 1);
				const y1s = Math.min(srcH - 1, y0s + 1);
				const i00 = (y0s * srcW + x0s) * 4;
				const i10 = (y0s * srcW + x1s) * 4;
				const i01 = (y1s * srcW + x0s) * 4;
				const i11 = (y1s * srcW + x1s) * 4;
				const w00 = (1 - fx) * (1 - fy);
				const w10 = fx * (1 - fy);
				const w01 = (1 - fx) * fy;
				const w11 = fx * fy;
				r =
					(src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11) /
					255;
				g =
					(src[i00 + 1] * w00 +
						src[i10 + 1] * w10 +
						src[i01 + 1] * w01 +
						src[i11 + 1] * w11) /
					255;
				b =
					(src[i00 + 2] * w00 +
						src[i10 + 2] * w10 +
						src[i01 + 2] * w01 +
						src[i11 + 2] * w11) /
					255;
			}
			rPlane[rowBase + x] = r;
			gPlane[rowBase + x] = g;
			bPlane[rowBase + x] = b;
		}
	}

	return { tensor: out, params };
}
