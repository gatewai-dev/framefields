---
"framefields": minor
---

Depth and relief: footage as a 3D surface.

- `comp.vision(clip, { depth: true })` analyses each frame's relative depth with Depth Anything V2 Small (Apache-2.0, pinned by revision and SHA-256), ahead of render and cached one file per frame. Read it with `clip.depthMap(frame)`; `runner.depth(image)` runs it on one image.
- `withVision({ mode: "depth" })` draws a clip's depth as gray (white = near), always for the frame on screen; it makes its depth clip when there is none.
- `layer.withRelief(heightLayer, { amount })` lifts a 3D layer into a surface by another layer's brightness, along the default camera's rays: from that lens it is the flat layer, pixel for pixel; a moving camera sees it in 3D, lit by the scene and hiding what passes behind it. With a depth layer, footage joins the 3D scene.
- Layers inside a `matte` or `relief` now link to their `comp.vision` clips too.
- The render GPU device now requests the adapter's full buffer limits. Vision models share that device, and one whose intermediates exceed the 128 MiB default binding (Depth Anything's attention) computed on truncated data instead of failing.
