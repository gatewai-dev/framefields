---
"framefields": minor
---

`Layer3D.clay`: Clayfield, a sculpture kept as a field and drawn per pixel, with no polygon count to choose. `ops` run in order: solids and brush strokes add, carve or intersect material (hard or smooth joins, per-op colors); `grab`, `twist` and `bulge` move what is already sculpted as an elastic solid would; `inflate` swells a region; `detail` adds procedural relief that fades below a pixel. `symmetry` mirrors the sculpture. It takes materials, lights and shadows like any mesh; glass, blended, textured and instanced draws, path tracing, physics and scatter use a mesh of the field.
