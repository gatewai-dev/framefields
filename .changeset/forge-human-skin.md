---
"framefields": minor
---

Skin textures for `human()`: `addHuman` bakes a base color (blush, red lips, mottling) and a roughness map into the body's UVs, plus a tiling normal map of pores and creases (`skinTextures`, `poreNormalMap`). The GLB writer gains texture transforms on texture slots, generated tangents for normal-mapped primitives, and `encodePng`.
