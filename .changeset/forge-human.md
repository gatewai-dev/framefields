---
"framefields": minor
---

`framefields/forge` builds realistic humans: `human({ sex, age, muscle, weight, proportions, ethnicity, height, targets })` shapes MakeHuman's CC0 base mesh with its macro and feature targets, places a Mixamo-named skeleton from the shaped body and skins it with MakeHuman's painted weights. The assets download on first use from a pinned commit, verified by SHA-256, and only the targets a body needs.

The humanoid skeleton preset now places the hip joints at anatomical width (about 9 cm from the midline on a 180 cm figure, was 16).
