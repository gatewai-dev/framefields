---
"framefields": patch
---

Vision clips of layers inside a 3D scene analyse on the composition's clock. Layers in a scene run on the scene's own clock, and the clip linking skipped them: a depth layer inside a scene got a clip with no time remap and a start of 0, so preparing frame N analysed its first N frames, far past the clip's end (a depth relief late in a film analysed thousands of frames). `comp.vision(layer)` now finds layers inside scenes too, at their start on the composition's clock.
