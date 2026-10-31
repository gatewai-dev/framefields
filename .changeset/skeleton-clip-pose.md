---
"@framefields/vision": minor
"@framefields/node-vision": minor
"framefields": minor
---

A `withVision({ mode: "skeleton" })` layer of a clip that `comp.vision` analyses now draws the pose that clip matched to its subject, for the frame on screen, instead of running its own pass and drawing the first person detected. A skeleton layer of a SAM clip needs `pose: true` on the clip and fails clearly without it. Skeleton mode draws only the skeleton: a frame without a pose is empty rather than showing the footage. SAM clip caches written before this change claimed pose they did not track; they are invalidated, so SAM clips re-analyse once.
