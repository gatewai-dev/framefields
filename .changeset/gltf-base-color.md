---
"framefields": patch
---

glTF base colors load in the right color space: `baseColorFactor` is linear in glTF and was used as a display color, so tinted glTF materials rendered darker than authored.
