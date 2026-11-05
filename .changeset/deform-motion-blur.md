---
"framefields": minor
---

Camera motion blur follows motion below the model matrix: meshes moved by their morph targets or audio deformation streak by their own vertex motion, and text drawn in the 3D scene streaks glyph by glyph (its plane and per-glyph animation). After a seek, layers placed in the 3D scene by `z` alone now blur the same as when rendered in order. The `pbr_without_environment` lint also flags `clearcoat` and `anisotropy` without `Layer.environment()`.
