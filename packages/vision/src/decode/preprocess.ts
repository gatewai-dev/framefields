/**
 * Image → NCHW float tensor preprocessing, plus the inverse mapping back to source pixels.
 *
 * Each model family was exported with its own preprocessing contract:
 *
 * | Model       | Resize                       | Pad  | Channels | Values                     |
 * | ----------- | ---------------------------- | ---- | -------- | -------------------------- |
 * | RTMDet-Ins  | keep ratio, content top-left | 114  | BGR      | (v − mean) / std (ImageNet) |
 * | RTMO        | keep ratio, content centered | 114  | BGR      | raw 0..255                 |
 * | Selfie      | stretch to input             | —    | RGB      | v / 255                    |
 *
 * Getting any of these wrong does not crash — it silently degrades accuracy — so the specs
 * live here and every runner path goes through `imageToTensor`. Input sizes differ per model
 * (RTMO-t is 416², the rest of RTMO 640²), so they come from the registry, never from here.
 */

export interface RgbaImage {
	readonly data: Uint8ClampedArray | Uint8Array;
	readonly width: number;
	readonly height: number;
}

export interface PreprocessSpec {
	/** Model input size in pixels. */
	readonly width: number;
	readonly height: number;
	/** `topLeft` / `center` keep aspect ratio and pad; `stretch` fills the input. */
	readonly fit: "topLeft" | "center" | "stretch";
	readonly channels: "rgb" | "bgr";
	/** Per-channel mean, in output channel order, on the 0..255 scale. */
	readonly mean: readonly [number, number, number];
	/** Per-channel std, in output channel order, on the 0..255 scale. */
	readonly std: readonly [number, number, number];
	/** Padding value on the 0..255 scale (normalized like any other pixel). */
	readonly padValue: number;
}

/** Maps model-input pixels back to source pixels: `src = (input − offset) / scale`. */
export interface InputTransform {
	readonly scaleX: number;
	readonly scaleY: number;
	readonly offsetX: number;
	readonly offsetY: number;
	readonly inputWidth: number;
	readonly inputHeight: number;
}

const IMAGENET_BGR_MEAN = [103.53, 116.28, 123.675] as const;
const IMAGENET_BGR_STD = [57.375, 57.12, 58.395] as const;

type Normalization = Omit<PreprocessSpec, "width" | "height">;

/** Per-family normalization; the input size always comes from the model's registry entry. */
export const PREPROCESS_BY_FAMILY: Readonly<
	Record<"rtmdet-ins" | "rtmo" | "selfie", Normalization>
> = {
	"rtmdet-ins": {
		fit: "topLeft",
		channels: "bgr",
		mean: IMAGENET_BGR_MEAN,
		std: IMAGENET_BGR_STD,
		padValue: 114,
	},
	rtmo: {
		fit: "center",
		channels: "bgr",
		mean: [0, 0, 0],
		std: [1, 1, 1],
		padValue: 114,
	},
	selfie: {
		fit: "stretch",
		channels: "rgb",
		mean: [0, 0, 0],
		std: [255, 255, 255],
		padValue: 0,
	},
};

export function preprocessSpec(
	family: keyof typeof PREPROCESS_BY_FAMILY,
	input: readonly [number, number],
): PreprocessSpec {
	return { ...PREPROCESS_BY_FAMILY[family], width: input[0], height: input[1] };
}

export function computeInputTransform(
	srcW: number,
	srcH: number,
	spec: Pick<PreprocessSpec, "width" | "height" | "fit">,
): InputTransform {
	if (spec.fit === "stretch") {
		return {
			scaleX: spec.width / srcW,
			scaleY: spec.height / srcH,
			offsetX: 0,
			offsetY: 0,
			inputWidth: spec.width,
			inputHeight: spec.height,
		};
	}
	const scale = Math.min(spec.width / srcW, spec.height / srcH);
	const contentW = Math.round(srcW * scale);
	const contentH = Math.round(srcH * scale);
	const center = spec.fit === "center";
	return {
		scaleX: scale,
		scaleY: scale,
		offsetX: center ? (spec.width - contentW) / 2 : 0,
		offsetY: center ? (spec.height - contentH) / 2 : 0,
		inputWidth: spec.width,
		inputHeight: spec.height,
	};
}

/** Model-input point → source pixel point. */
export function toSourcePoint(
	x: number,
	y: number,
	t: InputTransform,
): { x: number; y: number } {
	return { x: (x - t.offsetX) / t.scaleX, y: (y - t.offsetY) / t.scaleY };
}

/**
 * Resizes RGBA → NCHW float32 `[1, 3, height, width]` with bilinear sampling, padding,
 * channel reordering and normalization per `spec`. Reuses `out` when large enough
 * (hot-path frame loop).
 */
export function imageToTensor(
	image: RgbaImage,
	spec: PreprocessSpec,
	out?: Float32Array,
): { tensor: Float32Array; transform: InputTransform } {
	const { width: srcW, height: srcH, data: src } = image;
	const { width: W, height: H } = spec;
	const transform = computeInputTransform(srcW, srcH, spec);
	const { scaleX, scaleY, offsetX, offsetY } = transform;

	const plane = W * H;
	if (!out || out.length < 3 * plane) {
		out = new Float32Array(3 * plane);
	}

	// Source channel feeding each output plane (RGBA byte offsets).
	const order = spec.channels === "bgr" ? [2, 1, 0] : [0, 1, 2];
	const [m0, m1, m2] = spec.mean;
	const inv0 = 1 / spec.std[0];
	const inv1 = 1 / spec.std[1];
	const inv2 = 1 / spec.std[2];
	const pad0 = (spec.padValue - m0) * inv0;
	const pad1 = (spec.padValue - m1) * inv1;
	const pad2 = (spec.padValue - m2) * inv2;
	const [c0, c1, c2] = order;

	const x0 = Math.ceil(offsetX);
	const y0 = Math.ceil(offsetY);
	const x1 = Math.min(W, Math.floor(offsetX + srcW * scaleX)) - 1;
	const y1 = Math.min(H, Math.floor(offsetY + srcH * scaleY)) - 1;

	for (let y = 0; y < H; y++) {
		const rowBase = y * W;
		const paddedRow = y < y0 || y > y1;
		// Pixel-center sampling keeps stretch/letterbox resizes unbiased.
		const sy = Math.max(0, (y + 0.5 - offsetY) / scaleY - 0.5);
		const iy0 = Math.min(srcH - 1, Math.floor(sy));
		const iy1 = Math.min(srcH - 1, iy0 + 1);
		const fy = sy - iy0;
		for (let x = 0; x < W; x++) {
			const o = rowBase + x;
			if (paddedRow || x < x0 || x > x1) {
				out[o] = pad0;
				out[plane + o] = pad1;
				out[2 * plane + o] = pad2;
				continue;
			}
			const sx = Math.max(0, (x + 0.5 - offsetX) / scaleX - 0.5);
			const ix0 = Math.min(srcW - 1, Math.floor(sx));
			const ix1 = Math.min(srcW - 1, ix0 + 1);
			const fx = sx - ix0;
			const i00 = (iy0 * srcW + ix0) * 4;
			const i10 = (iy0 * srcW + ix1) * 4;
			const i01 = (iy1 * srcW + ix0) * 4;
			const i11 = (iy1 * srcW + ix1) * 4;
			const w00 = (1 - fx) * (1 - fy);
			const w10 = fx * (1 - fy);
			const w01 = (1 - fx) * fy;
			const w11 = fx * fy;
			out[o] =
				(src[i00 + c0] * w00 +
					src[i10 + c0] * w10 +
					src[i01 + c0] * w01 +
					src[i11 + c0] * w11 -
					m0) *
				inv0;
			out[plane + o] =
				(src[i00 + c1] * w00 +
					src[i10 + c1] * w10 +
					src[i01 + c1] * w01 +
					src[i11 + c1] * w11 -
					m1) *
				inv1;
			out[2 * plane + o] =
				(src[i00 + c2] * w00 +
					src[i10 + c2] * w10 +
					src[i01 + c2] * w01 +
					src[i11 + c2] * w11 -
					m2) *
				inv2;
		}
	}

	return { tensor: out, transform };
}
