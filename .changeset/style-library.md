---
"framefields": minor
"@framefields/node-compositor": patch
---

`framefields/styles`: the style library (looks, formats, genres, media and the presets that combine them) as data, with `combineStyles(mix)` for one brief in precedence order and `styleClashes(mix)` for pairs to watch. Its source is the new `framefields-styles` agent skill.

Shape strokes are no longer cut at the shape's layout box: the half of a stroke that lies outside the outline now draws.
