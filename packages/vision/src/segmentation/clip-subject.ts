import type { InstanceMask, PoseKeypoint } from "../types.js";

/**
 * Where a render-time Vision effect finds subject masks someone already
 * computed for its clip (`comp.vision(clip)` in framefields), so a matte layer
 * reuses them instead of segmenting the frame again, and a skeleton layer draws
 * the pose matched to that subject instead of the first person it detects. Set
 * on the Vision effect instance under this key; the renderer reads it from the effect.
 */
export const CLIP_SUBJECT: unique symbol = Symbol.for(
	"framefields.vision.clipSubject",
) as never;

export interface ClipSubjectSource {
	/** An explicit selection must not silently fall back to automatic subject detection. */
	readonly exact?: boolean;
	/**
	 * The merged subject mask for a source frame of the clip (`frame` at `fps`),
	 * in source pixels; `null` when the frame was analysed and holds no subject;
	 * `undefined` when it was not analysed, so the caller segments it itself.
	 */
	subject(frame: number, fps: number): InstanceMask | null | undefined;
	/**
	 * The subject's pose for a source frame; `null` when the frame was analysed
	 * and holds no matched pose; `undefined` when it was not analysed (or the
	 * clip tracks no pose).
	 */
	pose?(frame: number, fps: number): ClipPose | null | undefined;
}

export interface ClipPose {
	/** 17 COCO keypoints, normalized to the source size. */
	readonly keypoints: readonly PoseKeypoint[];
	/** Source size in pixels, for fitting the pose to a target. */
	readonly width: number;
	readonly height: number;
}
