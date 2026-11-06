/**
 * Trimaps from hard masks, for alpha matting: pixels well inside the mask are
 * foreground, pixels well outside are background, and a band of `band` pixels
 * either side of the edge is unknown, for the matting model to resolve.
 */

/** Trimap values, as ViTMatte reads them (0, 0.5, 1 on its 0..1 scale). */
export const TRIMAP_BACKGROUND = 0;
export const TRIMAP_UNKNOWN = 128;
export const TRIMAP_FOREGROUND = 255;

const FAR = 1e20;

/**
 * Squared Euclidean distance from every pixel to the nearest pixel where
 * `inside(i)` holds, with that pixel's index (−1 when there is none).
 * Felzenszwalb and Huttenlocher's two-pass lower envelope, O(width × height).
 */
export function distanceTransform(
	width: number,
	height: number,
	inside: (index: number) => boolean,
): { distance: Float32Array; nearest: Int32Array } {
	const n = width * height;
	const columns = new Float32Array(n);
	const columnFrom = new Int32Array(n);
	const scratch = envelopeScratch(Math.max(width, height));
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++)
			scratch.f[y] = inside(y * width + x) ? 0 : FAR;
		envelope(scratch, height);
		for (let y = 0; y < height; y++) {
			columns[y * width + x] = scratch.d[y] as number;
			columnFrom[y * width + x] = scratch.from[y] as number;
		}
	}
	const distance = new Float32Array(n);
	const nearest = new Int32Array(n);
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) scratch.f[x] = columns[row + x] as number;
		envelope(scratch, width);
		for (let x = 0; x < width; x++) {
			const d = scratch.d[x] as number;
			const fromX = scratch.from[x] as number;
			distance[row + x] = d;
			nearest[row + x] =
				d >= FAR ? -1 : (columnFrom[row + fromX] as number) * width + fromX;
		}
	}
	return { distance, nearest };
}

interface EnvelopeScratch {
	/** Input samples. */
	readonly f: Float64Array;
	/** Output: squared distance, and which sample it came from. */
	readonly d: Float64Array;
	readonly from: Int32Array;
	readonly v: Int32Array;
	readonly z: Float64Array;
}

function envelopeScratch(length: number): EnvelopeScratch {
	return {
		f: new Float64Array(length),
		d: new Float64Array(length),
		from: new Int32Array(length),
		v: new Int32Array(length),
		z: new Float64Array(length + 1),
	};
}

/** One dimension: d[q] = min over p of (q − p)² + f[p]. */
function envelope(s: EnvelopeScratch, length: number): void {
	const { f, d, from, v, z } = s;
	let k = -1;
	for (let q = 0; q < length; q++) {
		const fq = f[q] as number;
		if (fq >= FAR) continue;
		let cut = Number.NEGATIVE_INFINITY;
		while (k >= 0) {
			const p = v[k] as number;
			cut = (fq + q * q - ((f[p] as number) + p * p)) / (2 * (q - p));
			if (cut > (z[k] as number)) break;
			k--;
		}
		k++;
		v[k] = q;
		z[k] = k === 0 ? Number.NEGATIVE_INFINITY : cut;
		z[k + 1] = Number.POSITIVE_INFINITY;
	}
	if (k < 0) {
		d.fill(FAR, 0, length);
		from.fill(0, 0, length);
		return;
	}
	let j = 0;
	for (let q = 0; q < length; q++) {
		while ((z[j + 1] as number) < q) j++;
		const p = v[j] as number;
		d[q] = (q - p) * (q - p) + (f[p] as number);
		from[q] = p;
	}
}

export interface Trimap {
	/** Per pixel: {@link TRIMAP_BACKGROUND}, {@link TRIMAP_UNKNOWN} or {@link TRIMAP_FOREGROUND}. */
	readonly data: Uint8Array;
	readonly width: number;
	readonly height: number;
	/** Bounds of the unknown band, `[x0, y0, x1, y1)`; null when the band is empty. */
	readonly unknown: readonly [number, number, number, number] | null;
	/** Per pixel, the index of the nearest mask pixel (itself inside the mask; −1 when the mask is empty). */
	readonly nearest: Int32Array;
}

/**
 * The trimap of a mask (`mask[i] >= 128` is inside): an unknown band of
 * `band` px either side of the edge, foreground inside it, background outside.
 */
export function trimapFromMask(
	mask: ArrayLike<number>,
	width: number,
	height: number,
	band: number,
): Trimap {
	const outside = distanceTransform(
		width,
		height,
		(i) => (mask[i] as number) >= 128,
	);
	const inside = distanceTransform(
		width,
		height,
		(i) => (mask[i] as number) < 128,
	);
	const r2 = band * band;
	const data = new Uint8Array(width * height);
	let x0 = width;
	let y0 = height;
	let x1 = 0;
	let y1 = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const isIn = (mask[i] as number) >= 128;
			const d = isIn
				? (inside.distance[i] as number)
				: (outside.distance[i] as number);
			if (d > r2) {
				data[i] = isIn ? TRIMAP_FOREGROUND : TRIMAP_BACKGROUND;
				continue;
			}
			data[i] = TRIMAP_UNKNOWN;
			if (x < x0) x0 = x;
			if (y < y0) y0 = y;
			if (x >= x1) x1 = x + 1;
			if (y >= y1) y1 = y + 1;
		}
	}
	return {
		data,
		width,
		height,
		unknown: x1 > x0 ? [x0, y0, x1, y1] : null,
		nearest: outside.nearest,
	};
}

/** Default band for a frame: about 1.2% of its short side, 3…40 px (13 px at 1080p). */
export function defaultMatteBand(width: number, height: number): number {
	return Math.min(40, Math.max(3, Math.round(Math.min(width, height) * 0.012)));
}
