---
"framefields": minor
---

`framefields/forge` sculpts skinned bodies: `sculpt({ parts, skeleton, cell, triangles })` combines SDF parts (ellipsoid, round cone, tube, lathe and more, with smooth joins, cuts, twist, bend and noise detail) into a closed, manifold mesh at hero resolution, simplifies it to a triangle budget, cuts material borders on smooth curves, and skins it from the parts themselves, so blended joints bend without collapsing. `limb` and `mirrorParts` build limbs along bones and the right side from the left.
