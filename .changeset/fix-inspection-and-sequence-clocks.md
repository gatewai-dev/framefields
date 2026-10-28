---
"framefields": minor
"@framefields/core": minor
"@framefields/compositions": patch
"@framefields/renderer": patch
"@framefields/components": patch
---

Bound frame-grid sample generation before allocation, validate numeric sampling inputs, and keep automatically chosen samples inside the exported frame window. Render hooks and pixels now use one timestamp-selected frame; timestamp labels no longer change frame selection through rounding. Composition rendering rejects mismatching FPS overrides.

Fix sequence duration with outgoing overlaps and delayed layers that previously outlived their scene. Explicit scene-layer windows must fit their owning scene, and overlaps cannot exceed either adjacent scene. Frame indices and frame-range steps must be safe integers; fractional timestamps and FPS remain supported.

Add `framefields check <entry> --json` with isolated builder execution, schema/lint/timeline diagnostics, bounded worker lifetime and optional `--render` frame/grid smoke checks. Scaffolds include `check` and `check:render` scripts. Add JSON component/font discovery and an API reference generated from the owning timing/preflight types via `framefields api`.
