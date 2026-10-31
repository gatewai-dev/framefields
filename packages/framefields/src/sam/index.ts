/**
 * Prompted video tracking with SAM 2.1 (Tiny, Small) and SAM 3, for driving the
 * trackers directly; `comp.vision(clip, { sam2 | sam3 })` uses them for you. The
 * code is Apache-2.0; model weights download on first use, and SAM 3's need
 * Meta's SAM License accepted first (see NOTICE.md).
 */
export * from "@framefields/vision-sam";
