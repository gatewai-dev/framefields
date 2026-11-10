---
id: widescreen
name: Widescreen
summary: 16:9 for YouTube, sites and presentations; room for a story to breathe.
tags: [youtube, web, presentation]
width: 1920
height: 1080
fps: 30
durationSec: { min: 30, max: 600 }
safeArea: { top: 54, right: 96, bottom: 54, left: 96 }
pairsWell: [genre/explainer, genre/brand-film]
---

## Frame

1920×1080 at 30 fps (24 for a film feel, 60 for UI and screen recordings). Compose on thirds; the wide frame can hold a subject and its label side by side.

## Timing

Scenes of 3–8 seconds; a new visual idea every 5–10 seconds keeps attention without rushing. An open of under 10 seconds before the first real content. End with 2–4 seconds of hold (logo, title or call to action).

## Safe areas

Keep type and key detail 5 % in from each edge (96 px left and right, 54 px top and bottom). Player controls cover the bottom 10 % when paused: no captions there.

## Build it with

`new Composition({ width: 1920, height: 1080, fps: 30 })`; scenes in `Layer.sequence` with `Transition`s.
