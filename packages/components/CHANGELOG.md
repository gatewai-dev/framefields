# @framefields/components

## 2.8.1

## 2.8.0

### Patch Changes

- b1a40b4: Bound frame-grid sample generation before allocation, validate numeric sampling inputs, and keep automatically chosen samples inside the exported frame window. Render hooks and pixels now use one timestamp-selected frame; timestamp labels no longer change frame selection through rounding. Composition rendering rejects mismatching FPS overrides.

  Fix sequence duration with outgoing overlaps and delayed layers that previously outlived their scene. Explicit scene-layer windows must fit their owning scene, and overlaps cannot exceed either adjacent scene. Frame indices and frame-range steps must be safe integers; fractional timestamps and FPS remain supported.

  Add `framefields check <entry> --json` with isolated builder execution, schema/lint/timeline diagnostics, bounded worker lifetime and optional `--render` frame/grid smoke checks. Scaffolds include `check` and `check:render` scripts. Add JSON component/font discovery and an API reference generated from the owning timing/preflight types via `framefields api`.

  Normalize animation-builder inputs to strict program specs at the layer-builder boundary. Ambient light helpers now also accept an options object, consistently with other light helpers, while preserving positional color/intensity calls. These fixes allow the launch example to pass schema preflight.

## 2.7.0

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

### Minor Changes

- 0695665: Initialize components
