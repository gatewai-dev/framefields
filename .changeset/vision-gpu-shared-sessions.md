---
"framefields": minor
"@framefields/vision": minor
"@framefields/node-vision": patch
---

Faster on-device vision, on the GPU by default:

- Vision layers no longer reload their models every frame. Layers whose options differed (e.g. one with `classes: ["person"]` and one without) used to close and recreate their ONNX sessions on each frame; they now share sessions through `VisionRunner.derive()`. This also fixes the `thread constructor failed: Resource temporarily unavailable` crash with `onnxruntime-web` installed.
- Layers that hand vision the same pixels (two panels of one video) share one RTMDet-Ins pass.
- `onnxruntime-web` is now an optional dependency of `framefields`, so inference runs on WebGPU when there is a hardware adapter. Dawn's `GPUSupportedFeatures` gains the `forEach` that onnxruntime-web's WebGPU build needs. Software adapters (lavapipe, SwiftShader) use the CPU instead.
- CPU sessions on Linux size their thread pool from the CPUs the process may use, cgroup quota included, instead of the host's cores. `FRAMEFIELDS_VISION_THREADS` overrides it.
- `FRAMEFIELDS_VISION_PROVIDER` (`auto`, `webgpu`, `cpu`, `cuda`) forces a backend; `cuda` uses onnxruntime-node's CUDA EP on Linux x64.

The smoke project's `vision` export (three vision layers, 60 frames of 1280×720) on an Apple Silicon Mac: 84.9 s before; 41–43 s on the CPU and 26–29 s on the GPU after. In the renderer worker on a RunPod RTX 3070: 58.7 s before, 22–25 s after.
