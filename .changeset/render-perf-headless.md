---
"framefields": patch
"@framefields/renderer": patch
"@framefields/webgpu-renderers": patch
---

Rendering performance for the headless / server-GPU path:

- VRAM telemetry no longer blocks the event loop. The renderer's 5-second stats probe ran `nvidia-smi` with `execSync`; it is now sampled asynchronously and cached, so it can no longer stall the frame loop and DMA callbacks on NVIDIA hosts.
- `renderVideo` accepts `ringCapacity` (also `FRAMEFIELDS_RING_CAPACITY`, clamped 2–8) to tune the DMA staging ring depth. The default stays at 2.
- `renderImage` reuses render surfaces across stills instead of allocating and destroying the native render target and readback staging buffer on every call.
- Headless video decode reuses a single RGBA staging buffer per decoder instead of allocating a full-frame buffer for every decoded frame.
