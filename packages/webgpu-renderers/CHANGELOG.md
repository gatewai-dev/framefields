# @framefields/webgpu-renderers

## 2.9.2

## 2.9.0

### Patch Changes

- 7af1f91: Add prompted SAM 2.1 Tiny and SAM 3 video segmentation and semantic text selection to clip vision, decoupled into a dedicated `@framefields/vision-sam` package under the Meta SAM License. Includes temporal memory, point/box corrections, semantic text selection, cached frame seeking, and time-remapped matte reuse. Selected-object masks, geometry, motion, and optional matched pose are exposed through standard vision signals. Model assets download dynamically at runtime to local cache with SHA-256 verification upon explicit license agreement.

## 2.8.1

### Patch Changes

- 7a1bac8: Support variable numbers of direct lights and skin joints, and render independent shadows for multiple directional and spot lights.
- 1da767d: Batch compatible repeated opaque meshes into hardware-instanced draws while preserving individual transforms.

## 2.8.0

### Patch Changes

- b5c6470: Sort blended 3D meshes across the scene and render them without depth writes. Apply glTF base-color alpha once.
- e96a32f: Render model and procedural mesh wireframes as triangle edges, including animated and shadow-casting meshes.
- 9609991: Render all glTF primitive modes, per-map UV sets and transforms, sparse accessors, animated morph targets, Draco or meshopt compressed geometry, and ETC1S/UASTC KTX2 textures. Reject unsupported required glTF extensions explicitly.

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

### Patch Changes

- Speed up audio mixing for long timelines:
  - Decode only the stretch of a source each clip plays, 0.5s early so MP3/AAC decoders warm up; samples match a whole-file decode exactly.
  - Skip subtrees with no source and no sound-producing processor.
  - Pass a lone child's buffer up instead of copying it per level.
  - Read plain value signals once instead of once per sample.
  - Keep up to 8 effect chunks in flight on the GPU before reading back.
  - ffmpeg fallback: drop the 100 MB output cap and decode only the needed range.

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

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

- 6adfd26: Requires mediabunny and @mediabunny/server 1.61.6 or newer. Encoded video now carries correct colour: older versions converted RGB to YUV with BT.601 and left the output untagged, so reds came out dull and blues shifted. 1.61.5, the first release with the colour fix, also slowed RGB encoding about 5×; 1.61.6 fixes that, and the new minimum keeps installs off 1.61.5.
- edfe483: `resetRenderCaches()` also forgets registered font files and deletes fonts downloaded from URLs (`clearHeadlessFonts()`). Before, the first file registered for a family stayed in use for the life of the process. In a long-lived worker, the next project's "Inter" then loaded the previous project's file, and failed once that checkout was evicted. Downloaded fonts now go to a fresh temp folder per session instead of a shared `gatewai-fonts`.

## 2.2.0-beta.4

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

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

### Patch Changes

- Measure variable fonts with optical size (`opsz`) clamped to `fontSize` across `FontManager.measure`, `measureText`, captions, and rich text so layout matches rendered glyph geometry.
- 71d48b4: Fail fast when referenced local media files cannot be opened or decoded during headless rendering, instead of silently resolving with black frames or silent audio.

## 2.1.2

## 2.1.1

### Patch Changes

- rm aws bundle

## 2.1.0

## 2.0.11

### Patch Changes

- Physical 3D look, gradients, mattes, transitions and lint for agents:

  - `Layer.environment(preset)` / `Lighting.studio|soft|sunset|dramatic()`: GGX PBR with a procedural studio environment, emissive, exposure and tone mapping (PBR Neutral, AgX, ACES), soft shadow maps (`castShadow`), HDR bloom and fog. glTF normal, metallic-roughness, occlusion and emissive maps are now used.
  - `Color` helpers (`oklch`, `mix`, `ramp`, `lighten`, `contrast`, `readableOn`, …); `hsl()`, `oklch()` and space-separated `rgb()` accepted everywhere; color keyframes blend in OKLab.
  - CSS `linear-` / `radial-` / `conic-gradient()` with up to 8 stops on any background or shape fill.
  - Track mattes (`withMatte(layer, "alpha" | "alpha-inverted" | "luma" | "luma-inverted")`), on 2D and 3D layers; 3D layers keep their depth.
  - `Layer.sequence([...])` with `Transition.crossfade|push|slide|zoom|whip|wipe|iris|fadeThrough`.
  - `.animate()` merges with existing tracks; `FontManager.measure()` text metrics.
  - `comp.lint()` (also in `renderVideo({ qa })`): unreadable colors/gradients, low-contrast text, off-canvas layers, shadow and environment misuse, static tracks.
  - Fixes: `Layer.shape({ fill })` was ignored; `Layer3D.plane` dropped material options; stale 3D camera buffer reuse between frames.

## 2.0.10

## 2.0.9

## 2.0.8

### Patch Changes

- Fix text padding asymmetry and background badge rendering by eliminating artificial width offsets and fixing word-wrap token width calculation.

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
