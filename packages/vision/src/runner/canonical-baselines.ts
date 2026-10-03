import type {
	DetectedObject,
	Landmark3D,
	TrackedObject,
} from "@gitframes/core";
import type { PoseResult } from "../types.js";

/** Neutral fallbacks so signal evaluators always have a well-formed frame to read. */

export function createNeutralObjectResult(): {
	readonly objects: readonly TrackedObject[];
	readonly rawDetections: readonly DetectedObject[];
} {
	return { objects: [], rawDetections: [] };
}

export function createNeutralPoseResult(): PoseResult {
	return { people: [] };
}

/** 17 neutral COCO keypoints at frame center — used by pose signals when nobody is detected. */
export function createNeutralLandmarks(): readonly Landmark3D[] {
	const landmarks: Landmark3D[] = [];
	for (let i = 0; i < 17; i++) {
		landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0 });
	}
	return landmarks;
}
