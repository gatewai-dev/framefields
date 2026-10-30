---
"@framefields/vision-sam": minor
"framefields": minor
---

`sam3: { text, merge: true }` selects every instance the text matches as one object: one mask and one memory, so a whole crowd costs the same as a single track. `maxObjects` caps the instances merged (default: all).
