/**
 * Shared vision types (engine-agnostic — no ONNX imports here).
 *
 * Consumed by @framefields/vision (the inference engine) and @framefields/framefields (the SDK).
 */

/**
 * Vision tasks and the model that serves each:
 *  - `detect` / `segment` — RTMDet-Ins (COCO 80 boxes + instance masks, one forward pass)
 *  - `pose` — RTMO (COCO-17 keypoints, multi-person)
 *  - `matte` — MediaPipe Selfie Segmenter (fast person-vs-background alpha)
 */
export type VisionTask = "detect" | "segment" | "pose" | "matte";

/** Model size: `t` (tiny, fastest) · `s` (default) · `m` (most accurate). */
export type VisionVariant = "t" | "s" | "m";

export interface VisionConfig {
	readonly enableDetection?: boolean;
	readonly enableSegmentation?: boolean;
	readonly enablePose?: boolean;
	/** Fast person matte (Selfie Segmenter) alongside or instead of instance masks. */
	readonly enableMatte?: boolean;
	/** COCO class-name filter (all classes when omitted). */
	readonly classes?: readonly string[];
	/** Minimum detection score, 0..1. Default 0.3. */
	readonly confidence?: number;
	/** Model size. Default "s". */
	readonly variant?: VisionVariant;
	/** Model cache directory. Default `$FRAMEFIELDS_MODELS_DIR` or `~/.cache/framefields/models`. */
	readonly modelsDir?: string;
	/** Mirror origin for model downloads (`<baseUrl>/<filename>`). Default: pinned Hugging Face revisions. */
	readonly baseUrl?: string;
	/** Mask probability threshold (lower → fuller masks). Default 0.5. */
	readonly maskThreshold?: number;
	/** Soft-edge band around `maskThreshold`, 0..1. Default 0.05. */
	readonly featherRadius?: number;
	/** Vertical FOV (degrees) used to project landmarks into camera space. */
	readonly cameraFov?: number;
}

export interface VisionNodeSpec {
	readonly id: string;
	readonly kind: "vision";
	readonly source?: unknown;
	readonly config: VisionConfig;
}

export interface Landmark3D {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly visibility?: number;
}

export type NormalizedLandmarkList = readonly Landmark3D[];

export interface ObjectBoundingBox {
	readonly originX: number;
	readonly originY: number;
	readonly width: number;
	readonly height: number;
	readonly normalizedX: number;
	readonly normalizedY: number;
	readonly normalizedWidth: number;
	readonly normalizedHeight: number;
	readonly angle?: number;
}

export interface DetectedObject {
	readonly category: string;
	readonly score: number;
	readonly boundingBox: ObjectBoundingBox;
	readonly keypoints?: NormalizedLandmarkList;
}

export interface TrackedObject {
	readonly trackId: number;
	readonly category: string;
	readonly score: number;
	readonly boundingBox: ObjectBoundingBox;
	readonly centerX: number;
	readonly centerY: number;
	readonly normalizedCenterX: number;
	readonly normalizedCenterY: number;
	readonly velocity: { readonly vx: number; readonly vy: number };
	readonly speed: number;
	readonly age: number;
	readonly hits: number;
	readonly active: boolean;
	readonly isCoasting: boolean;
}
