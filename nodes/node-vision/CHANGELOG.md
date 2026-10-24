# @framefields/node-vision

## 2.5.1

## 2.5.0

## 2.4.3

## 2.4.2

## 2.4.1

## 2.4.0

## 2.3.2

## 2.3.1

## 2.3.0

### Minor Changes

- 303c410: `withVision({ mode: "matte" })` (and `mask` / `crop`) on a video layer now reuses `comp.vision(clip)`'s per-frame results when the composition already analyses that clip, instead of segmenting every frame a second time during render. The clip keeps each frame's full-resolution subject mask (merged the same way as the matte), persisted beside its other results in the vision cache, and the cutout uses the mask for the frame being drawn, so it no longer runs one frame behind the plate. Layers whose settings would give a different subject (`classes`, `keyBackground`, `matteSource: "selfie"`, a different `variant` / `confidence` / `maskThreshold` / `featherRadius`, or an attached vision bundle) keep their own segmentation, and so do frames the clip has not analysed.

## 2.2.0

### Patch Changes

- 5c55a7b: Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

  `VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.

- 60c35a0: Faster on-device vision, on the GPU by default:

  - Vision layers no longer reload their models every frame. Layers whose options differed (e.g. one with `classes: ["person"]` and one without) used to close and recreate their ONNX sessions on each frame; they now share sessions through `VisionRunner.derive()`. This also fixes the `thread constructor failed: Resource temporarily unavailable` crash with `onnxruntime-web` installed.
  - Layers that hand vision the same pixels (two panels of one video) share one RTMDet-Ins pass.
  - `onnxruntime-web` is now an optional dependency of `framefields`, so inference runs on WebGPU when there is a hardware adapter. Dawn's `GPUSupportedFeatures` gains the `forEach` that onnxruntime-web's WebGPU build needs. Software adapters (lavapipe, SwiftShader) use the CPU instead.
  - CPU sessions on Linux size their thread pool from the CPUs the process may use, cgroup quota included, instead of the host's cores. `FRAMEFIELDS_VISION_THREADS` overrides it.
  - `FRAMEFIELDS_VISION_PROVIDER` (`auto`, `webgpu`, `cpu`, `cuda`) forces a backend; `cuda` uses onnxruntime-node's CUDA EP on Linux x64.

  The smoke project's `vision` export (three vision layers, 60 frames of 1280×720) on an Apple Silicon Mac: 84.9 s before; 41–43 s on the CPU and 26–29 s on the GPU after. In the renderer worker on a RunPod RTX 3070: 58.7 s before, 22–25 s after.

## 2.2.0-beta.4

## 2.2.0-beta.3

## 2.2.0-beta.2

### Patch Changes

- 5c55a7b: Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

  `VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.

## 2.2.0-beta.1

### Patch Changes

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
