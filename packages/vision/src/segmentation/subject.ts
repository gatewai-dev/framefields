import type { InstanceMask } from "../types.js";

/**
 * The frame's primary instance: the largest person when present, else the most confident
 * instance (lowest `detectionIndex` — detections are score-sorted). Size alone is a poor
 * signal without a person: the largest instance is usually a backdrop ("dining table").
 * `classes` (case-insensitive) limits which instances can be the subject.
 */
export function selectSubjectMask(
	masks: readonly InstanceMask[],
	classes?: readonly string[],
): InstanceMask | undefined {
	const allowed = classes && new Set(classes.map((c) => c.toLowerCase()));
	let best: InstanceMask | undefined;
	for (const m of masks) {
		if (allowed && !allowed.has(m.category.toLowerCase())) continue;
		if (!best) {
			best = m;
			continue;
		}
		const mIsPerson = isPerson(m);
		const bestIsPerson = isPerson(best);
		if (mIsPerson !== bestIsPerson) {
			if (mIsPerson) best = m;
		} else if (
			mIsPerson ? m.area > best.area : m.detectionIndex < best.detectionIndex
		) {
			best = m;
		}
	}
	return best;
}

function isPerson(mask: InstanceMask): boolean {
	return mask.category.toLowerCase() === "person";
}

export interface MaskBounds {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
}

/** Tight pixel bounds of a mask's non-zero alpha, or null when empty. */
export function maskBounds(mask: InstanceMask): MaskBounds | null {
	const { mask: data, width, height } = mask;
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			if (data[row + x] === 0) continue;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export interface MergeSubjectOptions {
	/**
	 * Classes the subject may be (case-insensitive; any when omitted). Parts merged into it
	 * may be of any class — pass every instance, not only these classes.
	 */
	readonly classes?: readonly string[];
	/** Minimum intersection / smaller box area for a part. Default 0.5. */
	readonly overlap?: number;
	/** Largest part box area relative to the subject's. Default 2. */
	readonly maxGrowth?: number;
}

/**
 * Builds the full subject silhouette: the primary instance plus every comparably sized
 * instance whose bounds sit mostly inside or across it.
 *
 * COCO has no "clothing" class, so a flowing dress, a held guitar or a ridden bike comes back
 * as its own instance (often mislabeled) — merging them keeps the whole figure in the cutout.
 * That is why `classes` only picks the subject: a dress detected as a "kite" still merges
 * into a "person" subject. The size cap keeps containers out: a small figure inside a tunnel
 * or window detected as a huge "clock" must not drag the whole frame into the subject.
 */
export function mergeSubjectMask(
	masks: readonly InstanceMask[],
	options: MergeSubjectOptions = {},
): InstanceMask | undefined {
	const { classes, overlap = 0.5, maxGrowth = 2 } = options;
	const subject = selectSubjectMask(masks, classes);
	if (!subject) return undefined;
	const sb = maskBounds(subject);
	if (!sb) return subject;

	const subjectArea = boundsArea(sb);
	const parts = masks.filter((m) => {
		if (m === subject) return false;
		const b = maskBounds(m);
		return (
			b !== null &&
			boundsArea(b) <= subjectArea * maxGrowth &&
			boundsOverlap(sb, b) >= overlap
		);
	});
	if (parts.length === 0) return subject;

	const merged = subject.mask.slice();
	for (const part of parts) {
		const data = part.mask;
		for (let i = 0; i < merged.length; i++) {
			if (data[i] > merged[i]) merged[i] = data[i];
		}
	}
	let area = 0;
	for (let i = 0; i < merged.length; i++) area += merged[i];
	area = Math.round(area / 255);
	return {
		...subject,
		mask: merged,
		area,
		coverage: area / (subject.width * subject.height),
	};
}

function boundsArea(b: MaskBounds): number {
	return (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
}

function boundsOverlap(a: MaskBounds, b: MaskBounds): number {
	const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
	const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
	if (iw <= 0 || ih <= 0) return 0;
	return (iw * ih) / Math.min(boundsArea(a), boundsArea(b));
}
