---
"framefields": minor
---

SAM ships in `framefields`: `comp.vision(clip, { sam2 | sam3 })` works from a plain `npm install framefields`. The `@framefields/vision-sam` peer it asked for was never published, so prompted tracking failed for every npm user. The SAM code is a lazily loaded chunk, fetched only when a clip uses `sam2` or `sam3`; the trackers are exported as `framefields/sam`. No weights ship: they download on first use, SAM 3's only after you accept Meta's SAM License, as `NOTICE.md` describes.
