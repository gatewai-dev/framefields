---
"framefields": minor
---

`exportModel({ animation })` and `render --model --animation` export the 3D scene's motion as glTF animation: every frame of the composition (or a `{ startFrame, durationFrames }` range) is sampled, and layer, instance, camera and light motion become translation, rotation and scale channels with redundant keys dropped. A layer that appears part-way or changes shape gets one child per shape with stepped visibility, and the clip lasts as long as the frames play. Exports skip the pixel readback, so they run about as fast as the frames render.
