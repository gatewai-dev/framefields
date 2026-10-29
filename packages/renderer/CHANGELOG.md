# @framefields/renderer

## 2.8.1

## 2.8.0

### Patch Changes

- b1a40b4: Bound frame-grid sample generation before allocation, validate numeric sampling inputs, and keep automatically chosen samples inside the exported frame window. Render hooks and pixels now use one timestamp-selected frame; timestamp labels no longer change frame selection through rounding. Composition rendering rejects mismatching FPS overrides.

  Fix sequence duration with outgoing overlaps and delayed layers that previously outlived their scene. Explicit scene-layer windows must fit their owning scene, and overlaps cannot exceed either adjacent scene. Frame indices and frame-range steps must be safe integers; fractional timestamps and FPS remain supported.

  Add `framefields check <entry> --json` with isolated builder execution, schema/lint/timeline diagnostics, bounded worker lifetime and optional `--render` frame/grid smoke checks. Scaffolds include `check` and `check:render` scripts. Add JSON component/font discovery and an API reference generated from the owning timing/preflight types via `framefields api`.

  Normalize animation-builder inputs to strict program specs at the layer-builder boundary. Ambient light helpers now also accept an options object, consistently with other light helpers, while preserving positional color/intensity calls. These fixes allow the launch example to pass schema preflight.

## 2.7.0

### Minor Changes

- 18aece7: Add forward and reverse media time remapping for video and audio layers, including smooth ramps, video holds, silent audio holds, source range checks and clip vision synchronization. Reverse video decoding uses a bounded frame cache.

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

## 2.4.2

## 2.4.1

## 2.4.0

## 2.3.2

## 2.3.1

## 2.3.0

## 2.2.0

### Minor Changes

- cf65727: Headless rendering for long-lived workers and any Linux machine:

  - Video encoding uses a hardware encoder (NVENC, VideoToolbox) only after testing that it works, and software encoders (libx264, libx265, libvpx, SVT-AV1) otherwise. This fixes H.264/HEVC renders on linux-arm64, where `h264_rkmpp` was picked without Rockchip hardware, and on NVIDIA GPUs without NVENC (A100, H100). Set `FRAMEFIELDS_HW_CODECS=off` to always encode in software.
  - WebGPU falls back to a software adapter (e.g. lavapipe) when no GPU adapter is available. The new `describeGpu()` reports the adapter in use and whether it is a CPU one.
  - `renderVideo` accepts `signal` (AbortSignal) and `onProgress`; `resetRenderCaches()` clears per-render caches between jobs in one process.

### Patch Changes

- 6adfd26: Requires mediabunny and @mediabunny/server 1.61.6 or newer. Encoded video now carries correct colour: older versions converted RGB to YUV with BT.601 and left the output untagged, so reds came out dull and blues shifted. 1.61.5, the first release with the colour fix, also slowed RGB encoding about 5×; 1.61.6 fixes that, and the new minimum keeps installs off 1.61.5.
- edfe483: `resetRenderCaches()` also forgets registered font files and deletes fonts downloaded from URLs (`clearHeadlessFonts()`). Before, the first file registered for a family stayed in use for the life of the process. In a long-lived worker, the next project's "Inter" then loaded the previous project's file, and failed once that checkout was evicted. Downloaded fonts now go to a fresh temp folder per session instead of a shared `gatewai-fonts`.

## 2.2.0-beta.4

### Patch Changes

- 6adfd26: Requires mediabunny and @mediabunny/server 1.61.6 or newer. Encoded video now carries correct colour: older versions converted RGB to YUV with BT.601 and left the output untagged, so reds came out dull and blues shifted. 1.61.5, the first release with the colour fix, also slowed RGB encoding about 5×; 1.61.6 fixes that, and the new minimum keeps installs off 1.61.5.
- edfe483: `resetRenderCaches()` also forgets registered font files and deletes fonts downloaded from URLs (`clearHeadlessFonts()`). Before, the first file registered for a family stayed in use for the life of the process. In a long-lived worker, the next project's "Inter" then loaded the previous project's file, and failed once that checkout was evicted. Downloaded fonts now go to a fresh temp folder per session instead of a shared `gatewai-fonts`.

## 2.2.0-beta.3

## 2.2.0-beta.2

## 2.2.0-beta.1

## 2.2.0-beta.0

### Minor Changes

- cf65727: Headless rendering for long-lived workers and any Linux machine:

  - Video encoding uses a hardware encoder (NVENC, VideoToolbox) only after testing that it works, and software encoders (libx264, libx265, libvpx, SVT-AV1) otherwise. This fixes H.264/HEVC renders on linux-arm64, where `h264_rkmpp` was picked without Rockchip hardware, and on NVIDIA GPUs without NVENC (A100, H100). Set `FRAMEFIELDS_HW_CODECS=off` to always encode in software.
  - WebGPU falls back to a software adapter (e.g. lavapipe) when no GPU adapter is available. The new `describeGpu()` reports the adapter in use and whether it is a CPU one.
  - `renderVideo` accepts `signal` (AbortSignal) and `onProgress`; `resetRenderCaches()` clears per-render caches between jobs in one process.

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

- 51b0daf: Rendering performance for the headless / server-GPU path:

  - VRAM telemetry no longer blocks the event loop. The renderer's 5-second stats probe ran `nvidia-smi` with `execSync`; it is now sampled asynchronously and cached, so it can no longer stall the frame loop and DMA callbacks on NVIDIA hosts.
  - `renderVideo` accepts `ringCapacity` (also `FRAMEFIELDS_RING_CAPACITY`, clamped 2–8) to tune the DMA staging ring depth. The default stays at 2.
  - `renderImage` reuses render surfaces across stills instead of allocating and destroying the native render target and readback staging buffer on every call.
  - Headless video decode reuses a single RGBA staging buffer per decoder instead of allocating a full-frame buffer for every decoded frame.

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
