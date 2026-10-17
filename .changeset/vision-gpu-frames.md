---
"framefields": patch
"@framefields/vision": minor
"@framefields/node-vision": patch
---

Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

`VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.
