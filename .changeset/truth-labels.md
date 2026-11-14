---
"framefields": minor
---

`truthLabels(scene)` labels a `renderTruth` pass: the camera's intrinsics, view and projection, and per object its visible pixels and 2D box, its oriented 3D box and the 2D box that box projects to. Ground-truth objects now carry their object-to-world matrix and local bounds.
