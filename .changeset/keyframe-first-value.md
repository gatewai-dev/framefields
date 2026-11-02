---
"framefields": patch
---

A keyframe track holds its first value until it is reached. Baked tracks showed the layer's own value before their first key, so `keys("opacity", [[40, 0], [48, 1]])` drew the layer fully opaque for 40 frames and then snapped it out to fade in, and `keys("y", [[30, 440], [40, 400]])` sat at 400 before jumping to 440. Draw-time tracks (signals, stepped layers, path morphs) already held the first key, so the same track now plays the same either way. Discrete props (`hidden`, `muted`) still step from the layer's own value, as sets do.
