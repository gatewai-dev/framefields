---
"framefields": patch
"@framefields/vision": patch
---

A `mask` / `matte` / `crop` cutout with `classes` keeps the whole subject again. The class filter ran before the subject was assembled, so the parts COCO labels as other classes were thrown away before they could merge: a flowing dress comes back as a "kite", "umbrella" or "horse", and a `classes: ["person"]` cutout of a dancer kept only head, arms and torso (about 3% of the frame instead of 12%). The text behind the dancer then showed through the dress on most frames, on every platform. `classes` now only decides which instance is the subject; overlapping parts of any class merge into it, and the masks a vision bundle receives are still filtered by `classes`.

`mergeSubjectMask(masks, options)` takes `{ classes, overlap, maxGrowth }` instead of positional `overlap` and `maxGrowth`, and `selectSubjectMask(masks, classes)` takes an optional class list.
