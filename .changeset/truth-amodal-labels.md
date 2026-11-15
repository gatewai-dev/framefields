---
"framefields": minor
---

Any layer takes a `label` (what it is); ground-truth objects and `truthLabels` carry it, and `Physics.steel` shapes are labeled with their body's name. `renderTruth({ amodal: true })` also draws each object alone, so `truthLabels` gives each object's `visibleFraction`, `amodalPixels` and `amodalBox2d`. Fully transparent draws are no longer ground-truth objects.
