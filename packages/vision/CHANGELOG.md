# @framefields/vision

## 2.9.2

### Minor Changes

- a1e37b8: A `withVision({ mode: "skeleton" })` layer of a clip that `comp.vision` analyses now draws the pose that clip matched to its subject, for the frame on screen, instead of running its own pass and drawing the first person detected. A skeleton layer of a SAM clip needs `pose: true` on the clip and fails clearly without it. Skeleton mode draws only the skeleton: a frame without a pose is empty rather than showing the footage. SAM clip caches written before this change claimed pose they did not track; they are invalidated, so SAM clips re-analyse once.

## 2.9.0

### Minor Changes

- dac3694: `@framefields/vision-sam` is now an optional peer of `framefields`, loaded only when a clip uses `sam2` or `sam3`, so the SDK no longer installs or imports SAM-licensed code by default. Install it next to `framefields` to use prompted tracking, and import `Sam2Tracker`/`Sam3Tracker` from `@framefields/vision-sam`. Mask-derived object geometry moved to `@framefields/vision` as `maskObject` (formerly `sam2Object`).
- 7af1f91: Add prompted SAM 2.1 Tiny and SAM 3 video segmentation and semantic text selection to clip vision, decoupled into a dedicated `@framefields/vision-sam` package under the Meta SAM License. Includes temporal memory, point/box corrections, semantic text selection, cached frame seeking, and time-remapped matte reuse. Selected-object masks, geometry, motion, and optional matched pose are exposed through standard vision signals. Model assets download dynamically at runtime to local cache with SHA-256 verification upon explicit license agreement.
- 72f6aaa: SAM 3 downloads the image encoder its backend runs fastest: fp16 on WebGPU and CUDA, q4 on the CPU (`SAM3_ENCODER`, override with `sam3.precision`). Providers report their backend before any download (`SessionProvider.backend()`, `sessionCompute`); the auto provider decides with a one-node probe graph and, on Linux with the NVIDIA driver, tries CUDA first. All SAM 3 trackers in a process share one encoder session and reuse its features per frame. Text-seeded objects now output and remember their seed mask on the prompt frame, as SAM does, instead of a speckled re-decode.

### Patch Changes

- f1623c0: SAM 3 tracks several objects at once: `sam3.maxObjects` lets a text prompt select up to N instances (tracks 1…N by score) through one encoder pass per frame, and points prompts take `object` to seed or correct one track. `comp.vision` publishes every track in `signals.objects` and `signals.masks`; the clip matte is their union. Fixes concurrent `comp.vision` clips of one source dropping decoded frames (each clip now owns its decoder) and concurrent ORT WebGPU session creation falling back to the CPU (creation is serialized; SAM trackers share the process provider).

## 2.8.1

## 2.8.0

## 2.7.0

## 2.6.2

## 2.6.1

## 2.6.0

## 2.5.5

### Patch Changes

- demos

## 2.5.4

## 2.5.3

### Patch Changes

- docs-fixes

## 2.5.2

## 2.5.1

## 2.5.0

## 2.4.3

### Patch Changes

- Strict compile-time type safety across the engine harness:
  - Branded types for coordinate and unit spaces (`Pixels`, `Normalized01`, `Degrees`, `Radians`, `Frames`, `Seconds`, `Hertz`, `Decibels`).
  - Discriminated union types and capability-safe layer ports on `NodeEffect`, `Layer` nodes, and effect classes.
  - Compile-time exhaustiveness checking with `assertNever` and type-narrowed animation property targeting.
  - Schema and pipeline unification with generic node operations.

## 2.4.2

## 2.4.1

## 2.4.0

## 2.3.2

## 2.3.1

## 2.3.0

### Minor Changes

- 303c410: `withVision({ mode: "matte" })` (and `mask` / `crop`) on a video layer now reuses `comp.vision(clip)`'s per-frame results when the composition already analyses that clip, instead of segmenting every frame a second time during render. The clip keeps each frame's full-resolution subject mask (merged the same way as the matte), persisted beside its other results in the vision cache, and the cutout uses the mask for the frame being drawn, so it no longer runs one frame behind the plate. Layers whose settings would give a different subject (`classes`, `keyBackground`, `matteSource: "selfie"`, a different `variant` / `confidence` / `maskThreshold` / `featherRadius`, or an attached vision bundle) keep their own segmentation, and so do frames the clip has not analysed.

## 2.2.0

### Minor Changes

- 5c55a7b: Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

  `VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.

- 60c35a0: Faster on-device vision, on the GPU by default:

  - Vision layers no longer reload their models every frame. Layers whose options differed (e.g. one with `classes: ["person"]` and one without) used to close and recreate their ONNX sessions on each frame; they now share sessions through `VisionRunner.derive()`. This also fixes the `thread constructor failed: Resource temporarily unavailable` crash with `onnxruntime-web` installed.
  - Layers that hand vision the same pixels (two panels of one video) share one RTMDet-Ins pass.
  - `onnxruntime-web` is now an optional dependency of `framefields`, so inference runs on WebGPU when there is a hardware adapter. Dawn's `GPUSupportedFeatures` gains the `forEach` that onnxruntime-web's WebGPU build needs. Software adapters (lavapipe, SwiftShader) use the CPU instead.
  - CPU sessions on Linux size their thread pool from the CPUs the process may use, cgroup quota included, instead of the host's cores. `FRAMEFIELDS_VISION_THREADS` overrides it.
  - `FRAMEFIELDS_VISION_PROVIDER` (`auto`, `webgpu`, `cpu`, `cuda`) forces a backend; `cuda` uses onnxruntime-node's CUDA EP on Linux x64.

  The smoke project's `vision` export (three vision layers, 60 frames of 1280×720) on an Apple Silicon Mac: 84.9 s before; 41–43 s on the CPU and 26–29 s on the GPU after. In the renderer worker on a RunPod RTX 3070: 58.7 s before, 22–25 s after.

### Patch Changes

- 25edbba: A `mask` / `matte` / `crop` cutout with `classes` keeps the whole subject again. The class filter ran before the subject was assembled, so the parts COCO labels as other classes were thrown away before they could merge: a flowing dress comes back as a "kite", "umbrella" or "horse", and a `classes: ["person"]` cutout of a dancer kept only head, arms and torso (about 3% of the frame instead of 12%). The text behind the dancer then showed through the dress on most frames, on every platform. `classes` now only decides which instance is the subject; overlapping parts of any class merge into it, and the masks a vision bundle receives are still filtered by `classes`.

  `mergeSubjectMask(masks, options)` takes `{ classes, overlap, maxGrowth }` instead of positional `overlap` and `maxGrowth`, and `selectSubjectMask(masks, classes)` takes an optional class list.

- 931435f: Instance segmentation does far less work per frame. The RTMDet-Ins export ran NMS on the CPU in the middle of its graph and returned a full 640×640 mask for every detection: about 40 per frame, 65 MB of floats, computed on the GPU and copied back. The runner now cuts the graph at load time before its first data-dependent step and does the rest itself: top-k, per-class NMS with the export's thresholds, and each mask's three dynamic 1×1 layers at 80×80, only for the detections a layer keeps. `detect()` computes no masks at all.

  Results match the end2end graph: the same detections, scores and boxes, and masks with IoU above 0.98 on the reference frames (edges differ by one interpolation step). The model file and its SHA-256 check are unchanged; a model without the expected head tensors still runs end to end.

  The smoke project's `vision` export on an Apple Silicon Mac: 22.3 s → 15 s.

- 34f497a: Fix duplicate pose skeletons on the GPU path. In its default NHWC layout, onnxruntime-web (1.30)'s WebGPU execution provider computes grouped convolutions wrong when a group has more than one channel and the count isn't a multiple of 4. That corrupts RTMO's head (18 channels per group) and turned one person into several detections. Models with such a convolution (RTMO) now run in NCHW layout; the others (RTMDet-Ins, Selfie, whose grouped convolutions are depthwise) keep NHWC, which is about 30% faster. Outputs match the CPU provider on every pinned model.

  Vision now reports its inference backend once per process, and the renderer logs it: `[vision] Inference on the GPU (WebGPU)` with `sharedDevice`, or `[vision] Inference on the CPU` with the reason.

## 2.2.0-beta.4

## 2.2.0-beta.3

### Patch Changes

- 25edbba: A `mask` / `matte` / `crop` cutout with `classes` keeps the whole subject again. The class filter ran before the subject was assembled, so the parts COCO labels as other classes were thrown away before they could merge: a flowing dress comes back as a "kite", "umbrella" or "horse", and a `classes: ["person"]` cutout of a dancer kept only head, arms and torso (about 3% of the frame instead of 12%). The text behind the dancer then showed through the dress on most frames, on every platform. `classes` now only decides which instance is the subject; overlapping parts of any class merge into it, and the masks a vision bundle receives are still filtered by `classes`.

  `mergeSubjectMask(masks, options)` takes `{ classes, overlap, maxGrowth }` instead of positional `overlap` and `maxGrowth`, and `selectSubjectMask(masks, classes)` takes an optional class list.

## 2.2.0-beta.2

### Minor Changes

- 5c55a7b: Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

  `VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.

### Patch Changes

- 931435f: Instance segmentation does far less work per frame. The RTMDet-Ins export ran NMS on the CPU in the middle of its graph and returned a full 640×640 mask for every detection: about 40 per frame, 65 MB of floats, computed on the GPU and copied back. The runner now cuts the graph at load time before its first data-dependent step and does the rest itself: top-k, per-class NMS with the export's thresholds, and each mask's three dynamic 1×1 layers at 80×80, only for the detections a layer keeps. `detect()` computes no masks at all.

  Results match the end2end graph: the same detections, scores and boxes, and masks with IoU above 0.98 on the reference frames (edges differ by one interpolation step). The model file and its SHA-256 check are unchanged; a model without the expected head tensors still runs end to end.

  The smoke project's `vision` export on an Apple Silicon Mac: 22.3 s → 15 s.

- 34f497a: Fix duplicate pose skeletons on the GPU path. In its default NHWC layout, onnxruntime-web (1.30)'s WebGPU execution provider computes grouped convolutions wrong when a group has more than one channel and the count isn't a multiple of 4. That corrupts RTMO's head (18 channels per group) and turned one person into several detections. Models with such a convolution (RTMO) now run in NCHW layout; the others (RTMDet-Ins, Selfie, whose grouped convolutions are depthwise) keep NHWC, which is about 30% faster. Outputs match the CPU provider on every pinned model.

  Vision now reports its inference backend once per process, and the renderer logs it: `[vision] Inference on the GPU (WebGPU)` with `sharedDevice`, or `[vision] Inference on the CPU` with the reason.

## 2.2.0-beta.1

### Minor Changes

- 60c35a0: Faster on-device vision, on the GPU by default:

  - Vision layers no longer reload their models every frame. Layers whose options differed (e.g. one with `classes: ["person"]` and one without) used to close and recreate their ONNX sessions on each frame; they now share sessions through `VisionRunner.derive()`. This also fixes the `thread constructor failed: Resource temporarily unavailable` crash with `onnxruntime-web` installed.
  - Layers that hand vision the same pixels (two panels of one video) share one RTMDet-Ins pass.
  - `onnxruntime-web` is now an optional dependency of `framefields`, so inference runs on WebGPU when there is a hardware adapter. Dawn's `GPUSupportedFeatures` gains the `forEach` that onnxruntime-web's WebGPU build needs. Software adapters (lavapipe, SwiftShader) use the CPU instead.
  - CPU sessions on Linux size their thread pool from the CPUs the process may use, cgroup quota included, instead of the host's cores. `FRAMEFIELDS_VISION_THREADS` overrides it.
  - `FRAMEFIELDS_VISION_PROVIDER` (`auto`, `webgpu`, `cpu`, `cuda`) forces a backend; `cuda` uses onnxruntime-node's CUDA EP on Linux x64.

  The smoke project's `vision` export (three vision layers, 60 frames of 1280×720) on an Apple Silicon Mac: 84.9 s before; 41–43 s on the CPU and 26–29 s on the GPU after. In the renderer worker on a RunPod RTX 3070: 58.7 s before, 22–25 s after.

## 2.2.0-beta.0

## 2.1.3

## 2.1.2

## 2.1.1

### Patch Changes

- rm aws bundle

## 2.1.0

## 2.0.11

## 2.0.10

## 2.0.9

## 2.0.8

## 2.0.7

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

### Patch Changes

- 124f92e: Headless (Node) vision now prefers the GPU: when no provider is passed, runners try onnxruntime-web's WebGPU execution provider on the process's WebGPU device (the Dawn device the renderer already creates) and fall back to the CPU `onnxruntime-node` provider when a WebGPU session can't be created. The new `AutoSessionProvider` makes that choice, and `NodeWebGPUProvider` exposes the WebGPU-only path. On example 19's track scene this lifts the render from 2.37 to 3.49 fps with pixel-identical output (PSNR ≈ 103 dB vs CPU).

## 2.0.2

## 2.0.1

## 2.0.0

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
