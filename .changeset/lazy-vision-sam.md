---
"framefields": minor
"@framefields/vision": minor
"@framefields/vision-sam": minor
---

`@framefields/vision-sam` is now an optional peer of `framefields`, loaded only when a clip uses `sam2` or `sam3`, so the SDK no longer installs or imports SAM-licensed code by default. Install it next to `framefields` to use prompted tracking, and import `Sam2Tracker`/`Sam3Tracker` from `@framefields/vision-sam`. Mask-derived object geometry moved to `@framefields/vision` as `maskObject` (formerly `sam2Object`).
