---
id: footage
name: Footage
summary: The user's own clips and photos, cut, graded and annotated, with on-device vision.
tags: [video, photos, vision]
credit: false
---

## Pipeline

1. Pin the files (`npx framefields assets add`), then watch them: pick the moments before writing any scene.
2. Cut on movement and on the music; trim with `trimStartSec`, retime with `timeRemap`.
3. Vision for anything that follows a subject: mattes to put type behind people, tracking for labels and blurs.
4. The look's grade over everything with `comp.apply`, so clips shot on different days match.

## Consistency

Grade first, style second: match exposure and white balance across clips (`Curves`) before the look's grade goes on top.

## Verify

Frames at every cut; audio levels across clips; check mattes on frames with fast movement.

## Build it with

`Layer.video`, `Layer.image`, `comp.vision`, `Curves`, `ApplyLUT`.
