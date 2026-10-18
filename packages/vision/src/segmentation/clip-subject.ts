import type { InstanceMask } from "../types.js";

/**
 * Where a render-time Vision effect finds subject masks someone already
 * computed for its clip (`comp.vision(clip)` in framefields), so a matte layer
 * reuses them instead of segmenting the frame again. Set on the Vision effect
 * instance under this key; the renderer reads it from the effect.
 */
export const CLIP_SUBJECT: unique symbol = Symbol.for(
	"framefields.vision.clipSubject",
) as never;

export interface ClipSubjectSource {
	/**
	 * The merged subject mask for a source frame of the clip (`frame` at `fps`),
	 * in source pixels; `null` when the frame was analysed and holds no subject;
	 * `undefined` when it was not analysed, so the caller segments it itself.
	 */
	subject(frame: number, fps: number): InstanceMask | null | undefined;
}
