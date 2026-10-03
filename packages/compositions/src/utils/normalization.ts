import { getActiveMediaMetadata, type VirtualMediaData } from "@gitframes/core";
import { secondsToFrames } from "./timing.js";

/**
 * NormalizationContext carries the accumulated offsets and limits
 * as we traverse down the virtual media tree.
 */
interface NormalizationContext {
	timeOffsetSec: number;
	durationLimitMs?: number;
}

/**
 * normalizeTimeline recurses through the virtual media tree and "absorbs"
 * generic timeline-shifting operations into standard properties
 * of their children.
 */
export function normalizeTimeline(
	vv: VirtualMediaData,
	fps: number,
	context: NormalizationContext = { timeOffsetSec: 0 },
): VirtualMediaData {
	if (!vv) return vv;
	const { operation, metadata = {}, children = [] } = vv;
	const { timeOffsetSec, durationLimitMs } = context;

	if (!operation) {
		return {
			...vv,
			children: (children || []).map((child) =>
				normalizeTimeline(child, fps, context),
			),
		};
	}

	const timeline = operation.timeline;
	const segments = timeline?.segments || [];

	// 1. Calculate Total Duration based on segments
	let totalDurationMs = getActiveMediaMetadata(vv)?.durationMs ?? 0;
	if (segments.length > 0) {
		const totalSegmentsFrames = segments.reduce(
			(acc: number, seg: { startSec: number; endSec?: number }) => {
				const durSec = seg.endSec != null ? seg.endSec - seg.startSec : 0;
				const durFrames = Math.max(1, Math.round(durSec * fps));
				return acc + durFrames;
			},
			0,
		);
		if (totalSegmentsFrames > 0) {
			totalDurationMs = (totalSegmentsFrames / fps) * 1000;
		}
	}

	// 2. Prepare Coordinate System (Shifted startFrame)
	const newOperation = { ...operation };
	const rawStartFrame = timeline?.startFrame ?? newOperation.startFrame;

	if (typeof rawStartFrame === "number") {
		const offsetFrames = secondsToFrames(timeOffsetSec, fps);
		newOperation.startFrame = rawStartFrame - offsetFrames;
	}

	// 3. Metadata Standardization
	const newMetadata = {
		...metadata,
		durationMs: totalDurationMs,
	};

	// 4. Recurse into children
	// A node resets the coordinate system for its children if it has a startFrame or is a compose op.
	const isTimelineProvider =
		typeof rawStartFrame === "number" || newOperation.op === "compose";

	const childContext: NormalizationContext = isTimelineProvider
		? { timeOffsetSec: 0, durationLimitMs: undefined }
		: { timeOffsetSec: timeOffsetSec, durationLimitMs: durationLimitMs };

	const newChildren = (children || []).map((child) =>
		normalizeTimeline(child, fps, childContext),
	);

	return {
		metadata: newMetadata,
		operation: newOperation,
		children: newChildren,
	};
}
