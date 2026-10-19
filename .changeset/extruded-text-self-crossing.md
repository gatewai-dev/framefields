---
"framefields": patch
---

Fix 3D extruded text in the browser preview filling the notches of letters such as V and M. Without skia's outline merge, glyph contours that cross themselves (common in variable fonts) were triangulated as-is; they are now split at their self-crossings and filled with the nonzero rule, matching rendered output.
