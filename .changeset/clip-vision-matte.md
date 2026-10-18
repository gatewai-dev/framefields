---
"framefields": minor
"@framefields/vision": minor
"@framefields/node-vision": minor
---

`withVision({ mode: "matte" })` (and `mask` / `crop`) on a video layer now reuses `comp.vision(clip)`'s per-frame results when the composition already analyses that clip, instead of segmenting every frame a second time during render. The clip keeps each frame's full-resolution subject mask (merged the same way as the matte), persisted beside its other results in the vision cache, and the cutout uses the mask for the frame being drawn, so it no longer runs one frame behind the plate. Layers whose settings would give a different subject (`classes`, `keyBackground`, `matteSource: "selfie"`, a different `variant` / `confidence` / `maskThreshold` / `featherRadius`, or an attached vision bundle) keep their own segmentation, and so do frames the clip has not analysed.
