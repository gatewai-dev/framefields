---
id: keynote
name: Keynote
summary: A product on black, slow light across it, one line of type at a time.
tags: [product, premium, cinematic, 3d]
palette: ["#000000", "#0B0B0D", "#F5F5F7", "#86868B", "#2997FF"]
fonts: { display: Inter, body: Inter }
pairsWell: [genre/product-launch, medium/3d, medium/ai-generated, format/ad-spot]
clashes: [genre/explainer]
ai:
  direction: "premium product photography, single object on pure black, soft rim light and one slow light sweep, glossy reflections, shallow depth of field, very clean"
  avoid: "busy backgrounds, props, people, harsh flash, text or logos in the image"
  motion: "slow orbit or slow dolly, the light moves more than the camera"
---

## Look

The product is the only thing on screen. Pure black ground, one object lit by a soft key and a rim light, a slow highlight that travels across its surface. Off-white type, a cool gray for secondary lines, and blue only for the call to action. Huge amounts of negative space.

## Type

One sans, light to semibold. Short lines (2–5 words), large (120–200 px), centered, one at a time. Secondary lines in gray at half the size. A number or a spec, when it appears, gets the whole frame.

## Motion

Slow and expensive: the light moves more than the camera. Orbits over 3–6 seconds (`sine.inOut`), type fades and rises 20 px over 18 frames, then holds. Reveals come out of black. Cuts to black between ideas.

## Grade

Deep blacks, a little bloom on highlights from the 3D environment, no grain.

## Build it with

- `Layer3D` primitives or `Layer.model` for the product; `Layer.environment` with a studio preset; `CameraAnimation` orbits.
- `components/logo-reveal` and `components/title-card` for the end; `components/device-frame` for screens.

## Avoid

Fast cuts, more than one line of type at a time, colored backgrounds, busy UI on screens, music that's louder than the room.
