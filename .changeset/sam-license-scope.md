---
"@framefields/vision-sam": minor
"framefields": patch
---

SAM 2.1 (Apache-2.0 weights) no longer asks for Meta's SAM License; only SAM 3 does (`acceptSamLicense` / `sam3.acceptLicense` / `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`). `sam2.acceptLicense` and `Sam2Tracker`'s `acceptLicense` are removed. `@framefields/vision-sam` is Apache-2.0 like every framefields package (SAM 3's weights stay under Meta's SAM License, accepted at runtime); its sources no longer carry a Meta copyright header, and the model is named SAM 3 throughout.
