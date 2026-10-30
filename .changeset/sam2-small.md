---
"@framefields/vision-sam": minor
"framefields": minor
---

SAM 2.1 Small: `sam2: { model: "small" }` tracks at SAM 2's native 1024² from Diffusion Studio's pinned fp16 export (~112 MB, ~1.1 s/frame on an M1 Pro against Tiny's ~0.27 s), for small, thin or detailed subjects and identity after cuts. `Sam2Tracker` derives every size from the model's constants; `sam2Revision(model)` replaces `SAM2_TINY_REVISION`. The framefields-vision skill says when to choose Tiny, Small or SAM 3.
