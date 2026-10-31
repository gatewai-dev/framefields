# @framefields/vision-sam

## 2.9.3

## 2.9.2

### Minor Changes

- c785aa1: `sam3: { redetect: N }` runs the last text prompt again every N frames and adds the instances no tracked object covers yet: people who walk in, step out from behind someone, or were lost. With `merge` they join the one object (what it already tracks stays at full resolution); otherwise they become new track IDs up to `maxObjects`. The text features are encoded once per prompt.

## 2.9.0

### Minor Changes

- dac3694: `@framefields/vision-sam` is now an optional peer of `framefields`, loaded only when a clip uses `sam2` or `sam3`, so the SDK no longer installs or imports SAM-licensed code by default. Install it next to `framefields` to use prompted tracking, and import `Sam2Tracker`/`Sam3Tracker` from `@framefields/vision-sam`. Mask-derived object geometry moved to `@framefields/vision` as `maskObject` (formerly `sam2Object`).
- 7af1f91: Add prompted SAM 2.1 Tiny and SAM 3 video segmentation and semantic text selection to clip vision, decoupled into a dedicated `@framefields/vision-sam` package under the Meta SAM License. Includes temporal memory, point/box corrections, semantic text selection, cached frame seeking, and time-remapped matte reuse. Selected-object masks, geometry, motion, and optional matched pose are exposed through standard vision signals. Model assets download dynamically at runtime to local cache with SHA-256 verification upon explicit license agreement.
- 645dd13: SAM 2.1 (Apache-2.0 weights) no longer asks for Meta's SAM License; only SAM 3 does (`acceptSamLicense` / `sam3.acceptLicense` / `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`). `sam2.acceptLicense` and `Sam2Tracker`'s `acceptLicense` are removed. `@framefields/vision-sam` is Apache-2.0 like every framefields package (SAM 3's weights stay under Meta's SAM License, accepted at runtime); its sources no longer carry a Meta copyright header, and the model is named SAM 3 throughout.
- 9a82bdb: SAM 2.1 Small: `sam2: { model: "small" }` tracks at SAM 2's native 1024² from Diffusion Studio's pinned fp16 export (~112 MB, ~1.1 s/frame on an M1 Pro against Tiny's ~0.27 s), for small, thin or detailed subjects and identity after cuts. `Sam2Tracker` derives every size from the model's constants; `sam2Revision(model)` replaces `SAM2_TINY_REVISION`. The framefields-vision skill says when to choose Tiny, Small or SAM 3.
- 72f6aaa: SAM 3 downloads the image encoder its backend runs fastest: fp16 on WebGPU and CUDA, q4 on the CPU (`SAM3_ENCODER`, override with `sam3.precision`). Providers report their backend before any download (`SessionProvider.backend()`, `sessionCompute`); the auto provider decides with a one-node probe graph and, on Linux with the NVIDIA driver, tries CUDA first. All SAM 3 trackers in a process share one encoder session and reuse its features per frame. Text-seeded objects now output and remember their seed mask on the prompt frame, as SAM does, instead of a speckled re-decode.
- aec869b: `sam3: { text, merge: true }` selects every instance the text matches as one object: one mask and one memory, so a whole crowd costs the same as a single track. `maxObjects` caps the instances merged (default: all).
- f1623c0: SAM 3 tracks several objects at once: `sam3.maxObjects` lets a text prompt select up to N instances (tracks 1…N by score) through one encoder pass per frame, and points prompts take `object` to seed or correct one track. `comp.vision` publishes every track in `signals.objects` and `signals.masks`; the clip matte is their union. Fixes concurrent `comp.vision` clips of one source dropping decoded frames (each clip now owns its decoder) and concurrent ORT WebGPU session creation falling back to the CPU (creation is serialized; SAM trackers share the process provider).
