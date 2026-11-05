---
"framefields": minor
---

Sparse morph targets stay sparse from the glTF file to the GPU: the morph pass gathers each vertex's deltas from entries that exist, so meshes with hundreds of corrective shapes fit in memory. Skins take up to eight influences per vertex (glTF `JOINTS_1` / `WEIGHTS_1`), in the forge writer, the loader and the renderer.
