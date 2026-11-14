---
"framefields": patch
---

`Layer3D` primitives now throw on a negative or non-finite size (`width`, `height`, `depth`, radii, `length`, `tube`), naming the option. A negative size used to build the solid inside out: it showed its far side, and where that face lay on another surface the two z-fought, so shadows and colors flickered as the camera moved. Place a solid with `x`/`y`/`z` instead.
