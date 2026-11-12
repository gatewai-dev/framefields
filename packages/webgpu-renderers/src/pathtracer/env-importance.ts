/**
 * A piecewise-constant 2D distribution over an equirectangular panorama, so
 * the path tracer can aim light-sampling rays at an HDRI's bright regions
 * (the sun, windows) instead of finding them by chance.
 *
 * Layout (one float array, uploaded as a storage buffer):
 *   [0] width, [1] height, [2] integral of f over [0,1]², [3] unused
 *   marginal CDF over rows:        height + 1 floats
 *   conditional CDF of each row:   height * (width + 1) floats
 *   f per texel (luminance·sinθ):  width * height floats
 *
 * The panorama uses the same mapping as the prefiltered cube (y down,
 * u = 0.5 looks down -z): θ = v·π from the top, φ = (u - 0.5)·2π.
 */
import {
	type DecodedHdrImage,
	downsampleEquirect,
} from "../loaders/hdr-loader.js";

/** Widest table: finer than this samples the same lobes at more cost. */
const MAX_WIDTH = 512;
export const ENV_TABLE_HEADER = 4;

function luminance(data: Float32Array, i: number): number {
	return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/** The importance table of a panorama (see the module comment for the layout). */
export function buildEnvImportance(image: DecodedHdrImage): Float32Array {
	let img = image;
	while (img.width > MAX_WIDTH) img = downsampleEquirect(img);
	const { width: w, height: h, data } = img;
	const marginalOffset = ENV_TABLE_HEADER;
	const conditionalOffset = marginalOffset + h + 1;
	const valueOffset = conditionalOffset + h * (w + 1);
	const table = new Float32Array(valueOffset + w * h);
	table[0] = w;
	table[1] = h;
	const rowSums = new Float64Array(h);
	for (let y = 0; y < h; y++) {
		const sinTheta = Math.sin(((y + 0.5) / h) * Math.PI);
		const row = conditionalOffset + y * (w + 1);
		let sum = 0;
		table[row] = 0;
		for (let x = 0; x < w; x++) {
			// A floor keeps every direction reachable, so the estimator stays unbiased.
			const f = Math.max(luminance(data, (y * w + x) * 4), 1e-6) * sinTheta;
			table[valueOffset + y * w + x] = f;
			sum += f / w;
			table[row + x + 1] = sum;
		}
		for (let x = 1; x <= w; x++) table[row + x] /= sum || 1;
		rowSums[y] = sum;
	}
	let total = 0;
	table[marginalOffset] = 0;
	for (let y = 0; y < h; y++) {
		total += rowSums[y] / h;
		table[marginalOffset + y + 1] = total;
	}
	for (let y = 1; y <= h; y++) table[marginalOffset + y] /= total || 1;
	table[2] = total;
	return table;
}

/** A uniform table: what the shader binds when the scene has no HDRI. */
export function emptyEnvImportance(): Float32Array {
	const table = new Float32Array(ENV_TABLE_HEADER + 2 + 2 + 1);
	table[0] = 1;
	table[1] = 1;
	table[2] = 0;
	return table;
}

/** The procedural studio sky `envRadiance` draws, before rotation. */
export interface ProceduralSky {
	top: [number, number, number];
	horizon: [number, number, number];
	bottom: [number, number, number];
	/** Softbox strength (0 = none). */
	softboxes: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
}

function normalize3(v: [number, number, number]): [number, number, number] {
	const l = Math.hypot(v[0], v[1], v[2]);
	return [v[0] / l, v[1] / l, v[2] / l];
}

/** The key, rim and fill softboxes of `envRadiance`: axis, angular radius, weight. */
const SOFTBOXES: [[number, number, number], number, number][] = [
	[normalize3([-0.35, -0.85, -0.4]), 0.32, 1],
	[normalize3([0.75, -0.35, 0.55]), 0.2, 0.7],
	[normalize3([-0.92, -0.15, -0.2]), 0.16, 0.35],
];

/**
 * The procedural sky as a panorama, mirroring `envRadiance(d, 0)` in
 * lighting3d.ts, so light sampling can aim at its softboxes. It only steers
 * sampling: the kernel still shades with the shader's own radiance, so a
 * small mismatch costs noise, never correctness.
 */
export function proceduralSkyImage(
	sky: ProceduralSky,
	width = 256,
): DecodedHdrImage {
	const height = width / 2;
	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const theta = ((y + 0.5) / height) * Math.PI;
		for (let x = 0; x < width; x++) {
			const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
			const d: [number, number, number] = [
				Math.sin(theta) * Math.sin(phi),
				-Math.cos(theta),
				-Math.sin(theta) * Math.cos(phi),
			];
			const up = -d[1];
			const tUp = smoothstep(-0.05, 0.35, up);
			const tDown = smoothstep(-0.05, 0.35, -up);
			let box = 0;
			if (sky.softboxes > 0) {
				for (const [axis, radius, weight] of SOFTBOXES) {
					const c = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
					const edge = Math.cos(radius);
					box += weight * smoothstep(edge - 0.004, edge + 0.001, c);
				}
			}
			for (let k = 0; k < 3; k++) {
				const mid = sky.horizon[k] + (sky.top[k] - sky.horizon[k]) * tUp;
				data[(y * width + x) * 4 + k] =
					mid + (sky.bottom[k] - mid) * tDown + sky.softboxes * box;
			}
			data[(y * width + x) * 4 + 3] = 1;
		}
	}
	return { width, height, data };
}
