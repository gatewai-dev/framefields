---
"framefields": patch
---

`Styles.*` presets are typed as visual effects, so `layer.withEffects(Styles.vhs())` typechecks without a cast. The effects catalog in the agent skill lists every effect class again (FilmGrain, Curves, Levels, ApplyLUT, Crop and others had dropped out), and the skills use the right scales for `FilmGrain` and `Vignette` `strength` (0–100) and the right `renderVideo` quality and codec values.
