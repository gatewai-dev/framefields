export * from "@gitframes/core";

import type { DetectedObject } from "@gitframes/core";

export type YoloInputSource =
	| string
	| { inputHandleId?: string; id?: string; [key: string]: unknown };

/** RGBA pixel buffer accepted by the runner (same shape MediaPipe consumed). */
export interface YoloImageInput {
	readonly data: Uint8ClampedArray | Uint8Array;
	readonly width: number;
	readonly height: number;
}

/** A single decoded detection, in ORIGINAL source pixel space (positional), normalized included. */
export interface YoloDetection {
	readonly category: string;
	readonly classIndex: number;
	readonly score: number;
	readonly boundingBox: {
		readonly originX: number;
		readonly originY: number;
		readonly width: number;
		readonly height: number;
		readonly normalizedX: number;
		readonly normalizedY: number;
		readonly normalizedWidth: number;
		readonly normalizedHeight: number;
	};
}

/** Instance segmentation mask aligned to the ORIGINAL source frame. */
export interface YoloInstanceMask {
	readonly category: string;
	readonly mask: Uint8Array; // frame-sized, continuous alpha 0..255
	readonly width: number;
	readonly height: number;
	readonly area: number; // px
	readonly coverage: number; // area / (width * height)
	/** Index of the detection this mask belongs to (see segmentation result detections). */
	readonly detectionIndex: number;
	/** Assigned by the caller (renderer) after temporal tracking — matches TrackedObject.trackId. */
	readonly trackId?: number;
}

export interface YoloSegmentationResult {
	readonly detections: readonly DetectedObject[];
	readonly masks: readonly YoloInstanceMask[];
}

export interface YoloPoseKeypoint {
	readonly x: number;
	readonly y: number;
	readonly visibility: number; // 0..1
}

export interface YoloPosePerson {
	readonly score: number;
	readonly boundingBox: YoloDetection["boundingBox"];
	/** 17 keypoints in COCO-17 order (see POSE_LANDMARKS_YOLO). */
	readonly keypoints: readonly YoloPoseKeypoint[];
	readonly trackId?: number;
}

export interface YoloPoseResult {
	readonly people: readonly YoloPosePerson[];
}

export interface YoloClassifyResult {
	readonly top1: number; // class index (COCO 80)
	readonly top1Score: number;
	readonly top5: ReadonlyArray<{
		readonly index: number;
		readonly score: number;
	}>;
}

export interface YoloConfig {
	readonly enableDetection?: boolean;
	readonly enableSegmentation?: boolean;
	readonly enablePose?: boolean;
	readonly enableClassification?: boolean;
	readonly enableObb?: boolean;
	readonly enableWorld?: boolean;
	readonly prompts?: readonly string[];
	readonly customModel?: import("@gitframes/core").CustomModelConfig;
	readonly classes?: readonly string[]; // COCO names filter (all classes if omitted)
	readonly confidence?: number; // default 0.25
	readonly iouThreshold?: number; // NMS, default 0.45
	readonly variant?: "n" | "s" | "m" | "l" | "x"; // default "n"
	readonly imgsz?: number; // default 640
	readonly delegate?: "cpu" | "webgpu";
	readonly modelsDir?: string;
	readonly baseUrl?: string;
	readonly maskThreshold?: number;
	readonly featherRadius?: number;
	readonly autoDownload?: boolean; // compatibility no-op: models are ALWAYS lazy now
}

/**
 * Deterministic, serializable snapshot of one frame's signals (specs/yolov4plan.ts §Phase A).
 * Built synchronously from the per-frame caches, so it is safe to call inside a frame hook.
 */
export interface YoloSummary {
	readonly frame: number;
	readonly objects: ReadonlyArray<{
		readonly trackId: number;
		readonly category: string;
		readonly score: number;
		/** Source-space pixel center, `[x, y]`. */
		readonly center: readonly [number, number];
		readonly speed: number;
		readonly active: boolean;
	}>;
	readonly classes: readonly string[];
	/** Per-class instance count for the frame (only non-zero classes present). */
	readonly masks: Readonly<Record<string, number>>;
}

/** One rotated detection from the OBB head (specs/yolov4plan.ts §Phase B). */
export interface YoloOBBDetection {
	readonly category: string;
	readonly classIndex: number;
	readonly score: number;
	readonly boundingBox: YoloDetection["boundingBox"] & {
		readonly angle: number;
	};
	/** Four rotated corners in source pixels, ordered TL, TR, BR, BL around the box. */
	readonly corners: ReadonlyArray<readonly [number, number]>;
}

export interface YoloOBBResult {
	readonly detections: readonly YoloOBBDetection[];
}

/** Per-track aggregate in an analysis report (specs/yolov4plan.ts §Phase C). */
export interface VisionAnalysisTrackSummary {
	readonly trackId: number;
	readonly category: string;
	/** Inclusive frame range the track was active over, `[start, end]`. */
	readonly frames: readonly [number, number];
	readonly speedMeanPxS: number;
	/** Center path sampled every `pathStride` frames, `[x, y]` pairs. */
	readonly centerPath: ReadonlyArray<readonly [number, number]>;
}

export interface VisionAnalysisClassSummary {
	readonly framesPresent: number;
	readonly totalFrames: number;
	readonly maxConfidence: number;
	readonly tracks: number;
}

export interface VisionAnalysisReport {
	readonly source: string;
	readonly totalFrames: number;
	readonly fps: number;
	readonly durationSec: number;
	readonly tasks: readonly string[];
	/** What was fetched, and how long it took — surfaced so agents can budget cold starts. */
	readonly modelDownloads: Readonly<
		Record<string, { readonly bytes: number; readonly ms: number }>
	>;
	readonly inferenceMs: number;
	readonly trackCount: number;
	readonly classes: Readonly<Record<string, VisionAnalysisClassSummary>>;
	readonly tracks: readonly VisionAnalysisTrackSummary[];
	readonly masks: Readonly<Record<string, { readonly meanCoverage: number }>>;
}

export interface PinToLandmarkOptions {
	readonly offsetX?: number;
	readonly offsetY?: number;
	readonly offsetZ?: number;
	readonly trackRotation?: boolean;
	readonly scaleWithPerspective?: boolean;
}

export interface LandmarkCoordinateSignals {
	readonly x: import("@gitframes/core").ProgrammaticSignal;
	readonly y: import("@gitframes/core").ProgrammaticSignal;
	readonly z: import("@gitframes/core").ProgrammaticSignal;
	readonly screenX: import("@gitframes/core").ProgrammaticSignal;
	readonly screenY: import("@gitframes/core").ProgrammaticSignal;
}

export type ObjectAnchorName =
	| "center"
	| "topCenter"
	| "bottomCenter"
	| "topLeft"
	| "topRight"
	| "centerLeft"
	| "centerRight"
	| "bottomLeft"
	| "bottomRight";

export interface PinToObjectOptions extends PinToLandmarkOptions {
	readonly anchor?: ObjectAnchorName;
	readonly matchWidth?: boolean;
	readonly matchHeight?: boolean;
	readonly smoothFrames?: number;
	readonly hideWhenLost?: boolean;
}
