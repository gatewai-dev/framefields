import type { PersonMatte } from "../types.js";
import { probabilityToAlpha } from "./rtmdet-ins.js";

/**
 * Selfie Segmenter decode: `alphas [1, 1, h, w]` person probability (stretched input) →
 * frame-sized 0..255 alpha, bilinear-upsampled to the source resolution.
 */
export interface SelfieDecodeOptions {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	/** Probability threshold. Default 0.5. */
	readonly maskThreshold?: number;
	/** Soft-edge band; the low-res matte reads best with a wide one. Default 0.2. */
	readonly featherRadius?: number;
}

export function decodeSelfie(
	alphas: ArrayLike<number>,
	matteWidth: number,
	matteHeight: number,
	opts: SelfieDecodeOptions,
): PersonMatte {
	const { sourceWidth: sw, sourceHeight: sh } = opts;
	const alphaOf = probabilityToAlpha(
		opts.maskThreshold ?? 0.5,
		opts.featherRadius ?? 0.2,
	);
	const mask = new Uint8Array(sw * sh);
	const kx = matteWidth / sw;
	const ky = matteHeight / sh;
	let sum = 0;

	for (let y = 0; y < sh; y++) {
		const my = Math.max(0, (y + 0.5) * ky - 0.5);
		const my0 = Math.min(matteHeight - 1, Math.floor(my));
		const my1 = Math.min(matteHeight - 1, my0 + 1);
		const fy = my - my0;
		for (let x = 0; x < sw; x++) {
			const mx = Math.max(0, (x + 0.5) * kx - 0.5);
			const mx0 = Math.min(matteWidth - 1, Math.floor(mx));
			const mx1 = Math.min(matteWidth - 1, mx0 + 1);
			const fx = mx - mx0;
			const p =
				alphas[my0 * matteWidth + mx0] * (1 - fx) * (1 - fy) +
				alphas[my0 * matteWidth + mx1] * fx * (1 - fy) +
				alphas[my1 * matteWidth + mx0] * (1 - fx) * fy +
				alphas[my1 * matteWidth + mx1] * fx * fy;
			const a = alphaOf(p);
			mask[y * sw + x] = a;
			sum += a;
		}
	}

	return {
		mask,
		width: sw,
		height: sh,
		coverage: sw * sh > 0 ? sum / (255 * sw * sh) : 0,
	};
}
