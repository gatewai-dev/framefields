---
"framefields": patch
---

A 3D scene box with no window of its own lasts its parent's whole window. It ended early inside a parent that starts after frame 0: its length was taken from its nested composition's end as if that were an absolute frame, so a scene placed in an act starting at frame 282 drew for only its first few frames and then went black.
