import type { DetectedObject } from "@gitframes/core";
import { VISION_MODELS, type VisionTask } from "../model/registry.js";
import type { VisionRunner } from "../runner/vision-runner.js";
import { TemporalObjectTracker } from "../tracking/temporal-object-tracker.js";
import type {
	InstanceMask,
	VisionAnalysisClassSummary,
	VisionAnalysisReport,
	VisionAnalysisTrackSummary,
	VisionImageInput,
} from "../types.js";

/**
 * One-shot, ffmpeg-free sequence analysis.
 *
 * Pure frame-iterable analyzer: it never decodes media itself, so it stays engine-only and
 * offline-testable. Callers (e.g. the gitframes ingestion adapter) supply decoded frames.
 * Model loading remains lazy — the runner downloads each task's model on the first frame
 * that actually runs that task, and only the tasks requested here are ever touched.
 */

export interface AnalyzeSequenceOptions {
	readonly runner: VisionRunner;
	/** Label for the report ("clip.mp4" or similar). Defaults to "frames". */
	readonly source?: string;
	readonly fps?: number;
	/** Tasks to run. Defaults to `["detect"]`. Only these models are ever downloaded. */
	readonly tasks?: readonly VisionTask[];
	/** Restrict class summaries to these categories (all when omitted). */
	readonly categories?: readonly string[];
	/** Tracker box-association IoU. Default 0.25. */
	readonly iouThreshold?: number;
	readonly maxMissedFrames?: number;
	/** Sample the per-track center path every N frames. Default: ~50 points across the clip. */
	readonly pathStride?: number;
	/** Also aggregate instance-mask coverage (requires the `segment` task). Default false. */
	readonly includeMasks?: boolean;
}

interface TrackAccumulator {
	category: string;
	firstFrame: number;
	lastFrame: number;
	speedSum: number;
	speedCount: number;
	centers: Array<{ frame: number; x: number; y: number }>;
}

interface CoverageAccumulator {
	sum: number;
	count: number;
}

const now = (): number =>
	typeof performance !== "undefined" && typeof performance.now === "function"
		? performance.now()
		: Date.now();

export async function analyzeSequence(
	frames: AsyncIterable<VisionImageInput> | Iterable<VisionImageInput>,
	options: AnalyzeSequenceOptions,
): Promise<VisionAnalysisReport> {
	const { runner } = options;
	const fps = options.fps ?? 24;
	const tasks =
		options.tasks && options.tasks.length > 0
			? options.tasks
			: (["detect"] as const);
	const taskSet = new Set<VisionTask>(tasks);
	const categoryFilter = options.categories
		? new Set(options.categories.map((c) => c.toLowerCase()))
		: null;
	const includeMasks = options.includeMasks === true && taskSet.has("segment");
	// detect and segment share one RTMDet-Ins pass, so either yields detections.
	const tracksObjects = taskSet.has("detect") || taskSet.has("segment");

	const perFrameDetections: Array<readonly DetectedObject[]> = [];
	const modelDownloads: Record<string, { bytes: number; ms: number }> = {};
	const maskCoverage = new Map<string, CoverageAccumulator>();
	let inferenceMs = 0;
	let frameIndex = 0;

	const accepts = (category: string): boolean =>
		!categoryFilter || categoryFilter.has(category.toLowerCase());

	const runTask = async <T>(
		task: VisionTask,
		frame: VisionImageInput,
		fn: () => Promise<T>,
	): Promise<T> => {
		const key = runner.modelKeyFor(task, frame.width / frame.height);
		const wasReady = runner.downloadStatus.get(key) === "ready";
		const start = now();
		const result = await fn();
		const elapsed = now() - start;
		inferenceMs += elapsed;
		if (!wasReady && !modelDownloads[key]) {
			modelDownloads[key] = { bytes: VISION_MODELS[key].bytes, ms: elapsed };
		}
		return result;
	};

	const recordMasks = (masks: readonly InstanceMask[]): void => {
		for (const m of masks) {
			if (!accepts(m.category)) continue;
			const entry = maskCoverage.get(m.category) ?? { sum: 0, count: 0 };
			entry.sum += m.coverage;
			entry.count++;
			maskCoverage.set(m.category, entry);
		}
	};

	for await (const frame of frames) {
		let detections: readonly DetectedObject[] = [];

		if (includeMasks) {
			const seg = await runTask("segment", frame, () => runner.segment(frame));
			recordMasks(seg.masks);
			detections = seg.detections;
		} else if (tracksObjects) {
			detections = await runTask("detect", frame, () => runner.detect(frame));
		}
		if (taskSet.has("pose")) {
			await runTask("pose", frame, () => runner.pose(frame));
		}
		if (taskSet.has("matte")) {
			await runTask("matte", frame, () => runner.matte(frame));
		}

		perFrameDetections.push(
			categoryFilter
				? detections.filter((d) => accepts(d.category))
				: detections,
		);
		frameIndex++;
	}

	const totalFrames = frameIndex;

	// Temporal association + gap interpolation over the whole sequence.
	const tracker = new TemporalObjectTracker({
		iouThreshold: options.iouThreshold ?? 0.25,
		maxMissedFrames: options.maxMissedFrames ?? 15,
	});
	const trackedPerFrame = tracker.trackSequence(
		perFrameDetections,
		totalFrames,
		fps,
	);

	const pathStride =
		options.pathStride ?? Math.max(1, Math.ceil(totalFrames / 50));

	const tracks = new Map<number, TrackAccumulator>();
	const classPresentFrames = new Map<string, Set<number>>();
	const classMaxConfidence = new Map<string, number>();
	const classTrackIds = new Map<string, Set<number>>();

	const getOrCreate = <T>(
		map: Map<string, T>,
		key: string,
		make: () => T,
	): T => {
		let value = map.get(key);
		if (value === undefined) {
			value = make();
			map.set(key, value);
		}
		return value;
	};

	for (let f = 0; f < totalFrames; f++) {
		for (const obj of trackedPerFrame[f] ?? []) {
			if (!accepts(obj.category)) continue;

			let acc = tracks.get(obj.trackId);
			if (!acc) {
				acc = {
					category: obj.category,
					firstFrame: f,
					lastFrame: f,
					speedSum: 0,
					speedCount: 0,
					centers: [],
				};
				tracks.set(obj.trackId, acc);
			}
			acc.lastFrame = f;
			if (Number.isFinite(obj.speed)) {
				acc.speedSum += obj.speed;
				acc.speedCount++;
			}
			if ((f - acc.firstFrame) % pathStride === 0) {
				acc.centers.push({ frame: f, x: obj.centerX, y: obj.centerY });
			}

			getOrCreate(
				classPresentFrames,
				obj.category,
				() => new Set<number>(),
			).add(f);
			classMaxConfidence.set(
				obj.category,
				Math.max(classMaxConfidence.get(obj.category) ?? 0, obj.score),
			);
			getOrCreate(classTrackIds, obj.category, () => new Set<number>()).add(
				obj.trackId,
			);
		}
	}

	const trackSummaries: VisionAnalysisTrackSummary[] = Array.from(
		tracks.entries(),
	)
		.map(([trackId, acc]) => ({
			trackId,
			category: acc.category,
			frames: [acc.firstFrame, acc.lastFrame] as [number, number],
			speedMeanPxS: acc.speedCount > 0 ? acc.speedSum / acc.speedCount : 0,
			centerPath: acc.centers.map((c) => [c.x, c.y] as [number, number]),
		}))
		.sort((a, b) => a.trackId - b.trackId);

	const classes: Record<string, VisionAnalysisClassSummary> = {};
	for (const [category, frameSet] of classPresentFrames) {
		classes[category] = {
			framesPresent: frameSet.size,
			totalFrames,
			maxConfidence: classMaxConfidence.get(category) ?? 0,
			tracks: classTrackIds.get(category)?.size ?? 0,
		};
	}

	const masks: Record<string, { meanCoverage: number }> = {};
	for (const [category, entry] of maskCoverage) {
		masks[category] = {
			meanCoverage: entry.count > 0 ? entry.sum / entry.count : 0,
		};
	}

	return {
		source: options.source ?? "frames",
		totalFrames,
		fps,
		durationSec: fps > 0 ? totalFrames / fps : 0,
		tasks: Array.from(taskSet),
		modelDownloads,
		inferenceMs,
		trackCount: trackSummaries.length,
		classes,
		tracks: trackSummaries,
		masks,
	};
}
