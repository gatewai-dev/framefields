---
"@framefields/vision": minor
---

Headless (Node) vision now prefers the GPU: when no provider is passed, runners try onnxruntime-web's WebGPU execution provider on the process's WebGPU device (the Dawn device the renderer already creates) and fall back to the CPU `onnxruntime-node` provider when a WebGPU session can't be created. The new `AutoSessionProvider` makes that choice, and `NodeWebGPUProvider` exposes the WebGPU-only path. On example 19's track scene this lifts the render from 2.37 to 3.49 fps with pixel-identical output (PSNR ≈ 103 dB vs CPU).
