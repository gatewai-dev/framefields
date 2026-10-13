---
"framefields": minor
---

Text layers now render Arabic, Hebrew, Persian and other complex scripts. Each run is shaped with the font's OpenType tables (joining forms, lam-alef and other ligatures, kerning, mark placement), paragraphs go through the Unicode Bidirectional Algorithm, and lines wrap and read right to left with embedded Latin words and numbers kept left to right. Glyphs outside the default Latin set are generated on first use instead of rendering as boxes.

New `direction: "auto" | "ltr" | "rtl"` option on text and caption layers (default `"auto"`, taken from the first strong character); `align: "start" | "end"` now follow it instead of always meaning left and right. `FontManager.measure` accepts `direction` and reports right-to-left glyphs and carets. The Slug binary format moves to v2 (`SLUGGIS2`, with glyph ids); v1 files still load.
