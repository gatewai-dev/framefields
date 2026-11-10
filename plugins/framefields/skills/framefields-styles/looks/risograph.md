---
id: risograph
name: Risograph
summary: Two-ink zine printing; misregistered blue and pink, grain and big cut-out shapes.
tags: [print, texture, graphic, playful]
palette: ["#F4EFE4", "#1D3FBB", "#FF5FA2", "#2A2A2A"]
fonts: { display: Archivo, body: Archivo, mono: JetBrains Mono }
pairsWell: [format/square, format/vertical, genre/brand-film, genre/lyric-video]
clashes: [look/keynote, format/cinema]
ai:
  direction: "risograph print, two spot inks (blue and fluorescent pink) on cream paper, visible grain and slight misregistration, flat shapes, halftone shading"
  avoid: "photorealism, gradients, glossy surfaces, more than two inks, text in the image"
  motion: "stepped, two frames per drawing; shapes jump rather than glide"
---

## Look

A zine printed in two spot inks: federal blue and fluorescent pink on cream paper, with their overlap making a deep purple. Big flat cut-out shapes, halftone shading, slightly misregistered layers (the pink a few pixels off the blue), and paper grain over everything. Loud, handmade and a little imperfect.

## Type

A heavy grotesque (Archivo, wide or condensed) set big and tightly, often overlapping shapes, in one ink at a time. Small text in a monospace, like a stamp. Words can tilt a few degrees.

## Motion

Stepped: everything animates on twos (`LayerAnimation.stepped(2)`), so shapes jump between poses like a flip book. Quick pops on the beat, the misregistration jittering a pixel or two between frames.

## Grade

`Styles.risograph` over the whole frame with the look's inks and paper, plus `FilmGrain`, applied with `comp.apply`.

## Build it with

- `Styles.risograph` and `HalftoneScreen` for the print; `Layer.shape` for cut-outs, duplicated in the second ink and offset for misregistration.
- `TextAnimator.wordPop` on twos for type hits.

## Avoid

Smooth tweens, photorealism, gradients, a third ink, perfectly aligned layers.
