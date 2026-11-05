---
"framefields": patch
---

Layers that share one mesh with `deformWithAudio` keep their own deformation: each dispatch writes its own output, where every layer used to draw whichever was deformed last. Audio deformation also streaks under camera motion blur.
