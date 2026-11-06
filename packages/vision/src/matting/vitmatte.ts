import type { RgbaImage } from "../decode/preprocess.js";
import { TRIMAP_UNKNOWN, type Trimap } from "./trimap.js";

/** ViTMatte's patch grid: both input sides pad to a multiple of 32 (as its image processor does). */
const DIVISOR = 32;

/** Where a matting pass looks: a source rectangle, scaled into a padded model input. */
export interface MatteWindow {
	/** Source rectangle `[x0, y0, x1, y1)`. */
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	/** Source px → model px. */
	readonly scale: number;
	/** Scaled content size, before padding. */
	readonly contentWidth: number;
	readonly contentHeight: number;
	/** Model input size, padded to a multiple of 32. */
	readonly inputWidth: number;
	readonly inputHeight: number;
}

/**
 * The window around a trimap's unknown band, grown by `context` px so the
 * model sees what is on either side, and scaled down when its long side
 * exceeds `resolution`. Null when there is nothing to resolve.
 */
export function matteWindow(
	trimap: Trimap,
	context: number,
	resolution: number,
): MatteWindow | null {
	if (!trimap.unknown) return null;
	const [ux0, uy0, ux1, uy1] = trimap.unknown;
	const x0 = Math.max(0, ux0 - context);
	const y0 = Math.max(0, uy0 - context);
	const x1 = Math.min(trimap.width, ux1 + context);
	const y1 = Math.min(trimap.height, uy1 + context);
	const scale = Math.min(1, resolution / Math.max(x1 - x0, y1 - y0));
	const contentWidth = Math.max(1, Math.round((x1 - x0) * scale));
	const contentHeight = Math.max(1, Math.round((y1 - y0) * scale));
	return {
		x0,
		y0,
		x1,
		y1,
		scale,
		contentWidth,
		contentHeight,
		inputWidth: Math.ceil(contentWidth / DIVISOR) * DIVISOR,
		inputHeight: Math.ceil(contentHeight / DIVISOR) * DIVISOR,
	};
}

/**
 * The model input `[1, 4, H, W]`: RGB as (v / 255 − 0.5) / 0.5, then the
 * trimap on 0…1. The image is sampled bilinearly, the trimap nearest so its
 * three levels stay exact; padding is zero in every channel.
 */
export function vitmatteInput(
	image: RgbaImage,
	trimap: Trimap,
	window: MatteWindow,
	out?: Float32Array,
): Float32Array {
	const { inputWidth: w, inputHeight: h } = window;
	const plane = w * h;
	const tensor =
		out && out.length >= 4 * plane
			? out.subarray(0, 4 * plane)
			: new Float32Array(4 * plane);
	tensor.fill(0);
	const { data, width: sw, height: sh } = image;
	const inv = 1 / window.scale;
	for (let y = 0; y < window.contentHeight; y++) {
		const sy = Math.min(sh - 1, Math.max(0, window.y0 + (y + 0.5) * inv - 0.5));
		const y0 = Math.floor(sy);
		const y1 = Math.min(sh - 1, y0 + 1);
		const fy = sy - y0;
		const ty = Math.min(window.y1 - 1, Math.floor(window.y0 + (y + 0.5) * inv));
		for (let x = 0; x < window.contentWidth; x++) {
			const sx = Math.min(
				sw - 1,
				Math.max(0, window.x0 + (x + 0.5) * inv - 0.5),
			);
			const x0 = Math.floor(sx);
			const x1 = Math.min(sw - 1, x0 + 1);
			const fx = sx - x0;
			const o = y * w + x;
			for (let c = 0; c < 3; c++) {
				const a = data[(y0 * sw + x0) * 4 + c] as number;
				const b = data[(y0 * sw + x1) * 4 + c] as number;
				const d = data[(y1 * sw + x0) * 4 + c] as number;
				const e = data[(y1 * sw + x1) * 4 + c] as number;
				const top = a + (b - a) * fx;
				const v = top + (d + (e - d) * fx - top) * fy;
				tensor[c * plane + o] = v / 127.5 - 1;
			}
			const tx = Math.min(
				window.x1 - 1,
				Math.floor(window.x0 + (x + 0.5) * inv),
			);
			tensor[3 * plane + o] =
				(trimap.data[ty * trimap.width + tx] as number) / 255;
		}
	}
	return tensor;
}

/**
 * The frame's alpha: the trimap's foreground and background as they are,
 * and the model's alpha (sampled back to source px) across the unknown band.
 */
export function composeMatte(
	trimap: Trimap,
	window: MatteWindow | null,
	alphas: ArrayLike<number>,
): Uint8Array {
	const { width } = trimap;
	const out = Uint8Array.from(trimap.data, (v) =>
		v === TRIMAP_UNKNOWN ? 0 : v,
	);
	if (!window) return out;
	const w = window.inputWidth;
	const maxX = window.contentWidth - 1;
	const maxY = window.contentHeight - 1;
	for (let y = window.y0; y < window.y1; y++) {
		const my = Math.min(
			maxY,
			Math.max(0, (y - window.y0 + 0.5) * window.scale - 0.5),
		);
		const my0 = Math.floor(my);
		const my1 = Math.min(maxY, my0 + 1);
		const fy = my - my0;
		for (let x = window.x0; x < window.x1; x++) {
			const i = y * width + x;
			if (trimap.data[i] !== TRIMAP_UNKNOWN) continue;
			const mx = Math.min(
				maxX,
				Math.max(0, (x - window.x0 + 0.5) * window.scale - 0.5),
			);
			const mx0 = Math.floor(mx);
			const mx1 = Math.min(maxX, mx0 + 1);
			const fx = mx - mx0;
			const a = alphas[my0 * w + mx0] as number;
			const b = alphas[my0 * w + mx1] as number;
			const c = alphas[my1 * w + mx0] as number;
			const d = alphas[my1 * w + mx1] as number;
			const top = a + (b - a) * fx;
			const v = top + (c + (d - c) * fx - top) * fy;
			out[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
		}
	}
	return out;
}
