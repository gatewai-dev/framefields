---
"framefields": minor
"@framefields/renderer": minor
"@framefields/webgpu-renderers": minor
---

Headless rendering for long-lived workers and any Linux machine:

- Video encoding uses a hardware encoder (NVENC, VideoToolbox) only after testing that it works, and software encoders (libx264, libx265, libvpx, SVT-AV1) otherwise. This fixes H.264/HEVC renders on linux-arm64, where `h264_rkmpp` was picked without Rockchip hardware, and on NVIDIA GPUs without NVENC (A100, H100). Set `FRAMEFIELDS_HW_CODECS=off` to always encode in software.
- WebGPU falls back to a software adapter (e.g. lavapipe) when no GPU adapter is available. The new `describeGpu()` reports the adapter in use and whether it is a CPU one.
- `renderVideo` accepts `signal` (AbortSignal) and `onProgress`; `resetRenderCaches()` clears per-render caches between jobs in one process.
