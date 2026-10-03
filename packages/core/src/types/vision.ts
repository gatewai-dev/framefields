/**
 * Shared vision types (engine-agnostic).
 *
 * These were historically declared in `mediapipe.ts`; the MediaPipe engine has been removed
 * (see specs/yolov4plan.ts §Phase F), so the neutral object/landmark shapes now live here and
 * are consumed by @gitframes/yolo and @gitframes/gitframes.
 */

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
