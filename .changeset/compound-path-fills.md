---
"framefields": patch
---

Paths with several subpaths fill as drawn. A `path` shape's fill joined every subpath into one polygon, so a map's states and islands, a ring or a letter with a counter came out as wedges bridging them. Each subpath is now a contour; contours nest, holes follow SVG's nonzero rule, and each filled contour is triangulated with its holes (earcut). Fills are cached by path data, so a large path is triangulated once rather than every frame. Animating `d` (path morphs) also passes schema validation now: its keyframes are path data, not numbers, which `Annotate`'s hand-drawn boil relies on.
