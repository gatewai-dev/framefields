---
"framefields": minor
---

Text takes `fontVariations`: a variable font's axes by tag, as CSS `font-variation-settings` (`{ wdth: 68 }` for a condensed cut, `{ opsz: 72 }`, `{ GRAD: 50 }`). Layout measures the text at those axes, 2D and native 3D glyphs draw at them, spans inherit them, and `FontManager.measure` takes them. Text layers used to ignore every axis but weight and the automatic optical size, so a width axis could not be set at all.
