# @framefields/compositions

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

### Patch Changes

- 5c71a34: An audio layer's `volume` and `muted` keyframes count from the layer's own first frame, as a picture layer's do. They were read on the composition's clock, so any audio layer that didn't start at frame 0 was past its last key from its first sample: a fade-in `[[0, 0], [6, 1], [len - 6, 1], [len, 0]]` left every later clip silent, and keys had to be offset by `startFrame` to play. Render QA already read the keys as layer-local and flagged that workaround as `animation_truncated`; the mix and QA now agree.

## 2.2.0

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

## 2.2.0-beta.4

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

## 2.2.0-beta.3

## 2.2.0-beta.2

## 2.2.0-beta.1

## 2.2.0-beta.0

## 2.1.3

### Patch Changes

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

## 2.0.7

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

## 2.0.2

## 2.0.1

## 2.0.0

### Patch Changes

- 985e6be: `LayerAnimation.signal()` and `.colorSignal()` now accept a signal object (`Signal.fromArray`, `Signal.builder`, …) as well as a name registered with `comp.addSignal`. Before, passing the object produced a meaningless handle id and the track silently did nothing (or picked up an unrelated signal). The object is carried on its track and registered with the program under a generated `inline_signal_N` id, so specs stay plain JSON. Values that are neither a signal nor a name now throw.

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
