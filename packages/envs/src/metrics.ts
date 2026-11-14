/**
 * Image and state metrics the tasks score with: PSNR and SSIM between
 * frames, mask IoU and depth error between ground truths, and position /
 * rotation error between poses.
 */
import type { Scene3DTruth } from "framefields";

/** RGB PSNR of two RGBA frames of the same size, dB (99 when identical). */
export function psnr(a: Uint8Array, b: Uint8Array): number {
	if (a.length !== b.length) throw new Error("psnr: frames differ in size");
	let se = 0;
	for (let i = 0; i < a.length; i += 4)
		for (let k = 0; k < 3; k++) se += (a[i + k] - b[i + k]) ** 2;
	const mse = se / ((a.length / 4) * 3);
	return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}

/** Rec. 601 luma of an RGBA frame, 0..255. */
function luma(rgba: Uint8Array): Float64Array {
	const out = new Float64Array(rgba.length / 4);
	for (let p = 0; p < out.length; p++)
		out[p] =
			0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2];
	return out;
}

/** Summed-area table, (w + 1) × (h + 1). */
function integral(v: Float64Array, w: number, h: number): Float64Array {
	const out = new Float64Array((w + 1) * (h + 1));
	for (let y = 0; y < h; y++) {
		let row = 0;
		for (let x = 0; x < w; x++) {
			row += v[y * w + x];
			out[(y + 1) * (w + 1) + x + 1] = out[y * (w + 1) + x + 1] + row;
		}
	}
	return out;
}

/**
 * Mean SSIM (Wang et al. 2004) of two RGBA frames on their luma, over
 * every 8×8 window (stride 1, uniform weights; K1 0.01, K2 0.03): 1 when
 * identical, lower as structure, contrast or brightness differ.
 */
export function ssim(
	a: Uint8Array,
	b: Uint8Array,
	width: number,
	height: number,
	window = 8,
): number {
	if (a.length !== b.length || a.length !== width * height * 4)
		throw new Error("ssim: frames must both be width × height RGBA");
	const x = luma(a);
	const y = luma(b);
	const xx = x.map((v) => v * v);
	const yy = y.map((v) => v * v);
	const xy = x.map((v, i) => v * y[i]);
	const [sx, sy, sxx, syy, sxy] = [x, y, xx, yy, xy].map((v) =>
		integral(v, width, height),
	);
	const w1 = width + 1;
	const box = (t: Float64Array, x0: number, y0: number) => {
		const x1 = x0 + window;
		const y1 = y0 + window;
		return (
			t[y1 * w1 + x1] - t[y0 * w1 + x1] - t[y1 * w1 + x0] + t[y0 * w1 + x0]
		);
	};
	const n = window * window;
	const c1 = (0.01 * 255) ** 2;
	const c2 = (0.03 * 255) ** 2;
	let sum = 0;
	let count = 0;
	for (let y0 = 0; y0 + window <= height; y0++) {
		for (let x0 = 0; x0 + window <= width; x0++) {
			const mx = box(sx, x0, y0) / n;
			const my = box(sy, x0, y0) / n;
			const vx = box(sxx, x0, y0) / n - mx * mx;
			const vy = box(syy, x0, y0) / n - my * my;
			const cov = box(sxy, x0, y0) / n - mx * my;
			sum +=
				((2 * mx * my + c1) * (2 * cov + c2)) /
				((mx * mx + my * my + c1) * (vx + vy + c2));
			count++;
		}
	}
	return count ? sum / count : 1;
}

/** Pixels showing an object other than the floor. */
export function objectMask(s: Scene3DTruth): Uint8Array {
	const floor = s.objects.find((o) => o.layer === "floor")?.id;
	return Uint8Array.from(s.object, (id) => (id !== 0 && id !== floor ? 1 : 0));
}

/**
 * IoU of the two scenes' object masks (1 when neither shows one), and the
 * mean |depth difference| where both do (scene px).
 */
export function maskAndDepth(
	a: Scene3DTruth,
	b: Scene3DTruth,
): { iou: number; depthError: number } {
	const ma = objectMask(a);
	const mb = objectMask(b);
	let inter = 0;
	let union = 0;
	let depthSum = 0;
	for (let i = 0; i < ma.length; i++) {
		if (ma[i] || mb[i]) union++;
		if (ma[i] && mb[i]) {
			inter++;
			depthSum += Math.abs(a.depth[i] - b.depth[i]);
		}
	}
	return {
		iou: union ? inter / union : 1,
		depthError: inter ? depthSum / inter : 0,
	};
}

/** A pose: position px, and optionally Euler degrees (R = Rz · Ry · Rx). */
export interface Pose {
	position: readonly number[];
	rotation?: readonly number[];
}

/** The unit quaternion [x, y, z, w] of Euler degrees, R = Rz · Ry · Rx. */
export function quatFromEuler([rx, ry, rz]: readonly number[]): [
	number,
	number,
	number,
	number,
] {
	const h = Math.PI / 360;
	const [cx, sx] = [Math.cos(rx * h), Math.sin(rx * h)];
	const [cy, sy] = [Math.cos(ry * h), Math.sin(ry * h)];
	const [cz, sz] = [Math.cos(rz * h), Math.sin(rz * h)];
	return [
		sx * cy * cz - cx * sy * sz,
		cx * sy * cz + sx * cy * sz,
		cx * cy * sz - sx * sy * cz,
		cx * cy * cz + sx * sy * sz,
	];
}

/** The angle between two orientations, degrees (0..180). */
export function rotationError(
	a: readonly number[],
	b: readonly number[],
): number {
	const qa = quatFromEuler(a);
	const qb = quatFromEuler(b);
	const dot = Math.abs(
		qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3],
	);
	return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/**
 * Position error (px) and, when both give one, rotation error (degrees)
 * between a predicted and a true pose.
 */
export function poseError(
	predicted: Pose,
	truth: Pose,
): { position: number; rotation?: number } {
	const [px, py, pz] = predicted.position;
	const [tx, ty, tz] = truth.position;
	return {
		position: Math.hypot(px - tx, py - ty, pz - tz),
		...(predicted.rotation &&
			truth.rotation && {
				rotation: rotationError(predicted.rotation, truth.rotation),
			}),
	};
}
