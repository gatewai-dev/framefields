---
"framefields": patch
---

A layer keyed up from `volume: 0`, or keyed out of `muted: true`, plays. The mix baked a layer's resting volume and mute into its sources (skipping a source at 0 altogether) and the layer's keys only rescaled what was left, so a fade in from a resting volume of 0 stayed silent for good. Props a layer keys are now applied by its keys alone; resting values it does not key are applied as before. A ducked music bed written `Layer.audio(music, { volume: 0 }).animate(LayerAnimation.keys("volume", …))` is heard.
