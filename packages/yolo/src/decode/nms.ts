/**
 * Class-aware Non-Maximum Suppression over decoded boxes.
 * Pure typed-array implementation — fast enough at 8400 anchors (< 1 ms) that it stays
 * on the CPU; no GPU round-trip needed.
 */

export interface NmsBox {
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	readonly score: number;
	readonly classIndex: number;
	readonly anchorIndex: number;
}

export function computeIoU(a: NmsBox, b: NmsBox): number {
	const interX0 = Math.max(a.x0, b.x0);
	const interY0 = Math.max(a.y0, b.y0);
	const interX1 = Math.min(a.x1, b.x1);
	const interY1 = Math.min(a.y1, b.y1);
	const interW = Math.max(0, interX1 - interX0);
	const interH = Math.max(0, interY1 - interY0);
	const interArea = interW * interH;
	if (interArea <= 0) return 0;
	const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
	const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
	const unionArea = areaA + areaB - interArea;
	return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Greedy class-aware NMS: boxes of different classes never suppress each other
 * (matches ultralytics default behavior).
 */
export function nms(boxes: readonly NmsBox[], iouThreshold = 0.45): NmsBox[] {
	const sorted = [...boxes].sort((a, b) => b.score - a.score);
	const kept: NmsBox[] = [];
	for (const candidate of sorted) {
		let suppressed = false;
		for (const k of kept) {
			if (k.classIndex !== candidate.classIndex) continue;
			if (computeIoU(k, candidate) > iouThreshold) {
				suppressed = true;
				break;
			}
		}
		if (!suppressed) {
			kept.push(candidate);
		}
	}
	return kept;
}
