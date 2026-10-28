# @framefields/core

## 2.8.0

### Minor Changes

- b1a40b4: Bound frame-grid sample generation before allocation, validate numeric sampling inputs, and keep automatically chosen samples inside the exported frame window. Render hooks and pixels now use one timestamp-selected frame; timestamp labels no longer change frame selection through rounding. Composition rendering rejects mismatching FPS overrides.

  Fix sequence duration with outgoing overlaps and delayed layers that previously outlived their scene. Explicit scene-layer windows must fit their owning scene, and overlaps cannot exceed either adjacent scene. Frame indices and frame-range steps must be safe integers; fractional timestamps and FPS remain supported.

  Add `framefields check <entry> --json` with isolated builder execution, schema/lint/timeline diagnostics, bounded worker lifetime and optional `--render` frame/grid smoke checks. Scaffolds include `check` and `check:render` scripts. Add JSON component/font discovery and an API reference generated from the owning timing/preflight types via `framefields api`.

  Normalize animation-builder inputs to strict program specs at the layer-builder boundary. Ambient light helpers now also accept an options object, consistently with other light helpers, while preserving positional color/intensity calls. These fixes allow the launch example to pass schema preflight.

## 2.7.0

### Minor Changes

- 18aece7: Add forward and reverse media time remapping for video and audio layers, including smooth ramps, video holds, silent audio holds, source range checks and clip vision synchronization. Reverse video decoding uses a bounded frame cache.
- e56c7f5: Drive media `timeRemap` from a signal: `{ kind: "signal", mode: "speed" | "source-time", signal }` accepts a signal instance or a named composition signal. Without frame hooks the signal is sampled up front; with hooks it is recorded live after each frame's hooks, replayed for seeks, audio, vision and the preview, and its source bounds are checked as it records.

### Patch Changes

- e56c7f5: Preserve the supplied frame progress when evaluating programmatic signals, and prevent cached frame-signal values from being reused across different frame rates or frame contexts.

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

## 2.2.0-beta.4

## 2.2.0-beta.3

## 2.2.0-beta.2

## 2.2.0-beta.1

## 2.2.0-beta.0

## 2.1.3

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

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
