export * from "@gitframes/core";

import type { DetectedObject, ObjectBoundingBox } from "@gitframes/core";

export type VisionInputSource =
	| string
	| { inputHandleId?: string; id?: string; [key: string]: unknown };

/** RGBA pixel buffer accepted by the runner. */
export interface VisionImageInput {
	readonly data: Uint8ClampedArray | Uint8Array;
	readonly width: number;
	readonly height: number;
}

/** Instance segmentation mask aligned to the ORIGINAL source frame. */
export interface InstanceMask {
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

export interface SegmentationResult {
	readonly detections: readonly DetectedObject[];
	readonly masks: readonly InstanceMask[];
}

/** Person-vs-background alpha (Selfie Segmenter), aligned to the ORIGINAL source frame. */
export interface PersonMatte {
	readonly mask: Uint8Array; // frame-sized, continuous alpha 0..255
	readonly width: number;
	readonly height: number;
	readonly coverage: number; // mean alpha, 0..1
}

export interface PoseKeypoint {
	readonly x: number;
	readonly y: number;
	readonly visibility: number; // 0..1
}

export interface PosePerson {
	readonly score: number;
	readonly boundingBox: ObjectBoundingBox;
	/** 17 keypoints in COCO-17 order (see COCO17_KEYPOINTS). */
	readonly keypoints: readonly PoseKeypoint[];
	readonly trackId?: number;
}

export interface PoseResult {
	readonly people: readonly PosePerson[];
}

/**
 * Deterministic, serializable snapshot of one frame's signals.
 * Built synchronously from the per-frame caches, so it is safe to call inside a frame hook.
 */
export interface VisionSummary {
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

/** Per-track aggregate in an analysis report. */
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
