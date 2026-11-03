---
"@framefields/webgpu-renderers": patch
"framefields": patch
---

Text with glyph animators keeps its stroke and shadow colours. The animator colour used to start from the base fill and override every pass, so outlined or shadowed text turned into a solid fill-coloured blob; colour animators now start from each glyph's own fill (spans and highlights included) and tint only the fill pass.
