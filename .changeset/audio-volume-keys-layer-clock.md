---
"@framefields/compositions": patch
---

An audio layer's `volume` and `muted` keyframes count from the layer's own first frame, as a picture layer's do. They were read on the composition's clock, so any audio layer that didn't start at frame 0 was past its last key from its first sample: a fade-in `[[0, 0], [6, 1], [len - 6, 1], [len, 0]]` left every later clip silent, and keys had to be offset by `startFrame` to play. Render QA already read the keys as layer-local and flagged that workaround as `animation_truncated`; the mix and QA now agree.
