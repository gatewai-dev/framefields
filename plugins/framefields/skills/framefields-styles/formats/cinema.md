---
id: cinema
name: Cinema
summary: "2.39:1 widescreen with letterbox bars: trailers, title sequences and film-like pieces."
tags: [film, trailer, cinematic]
width: 1920
height: 1080
fps: 24
durationSec: { min: 30, max: 180 }
safeArea: { top: 138, right: 96, bottom: 138, left: 96 }
pairsWell: [look/keynote, genre/brand-film]
clashes: [look/risograph]
---

## Frame

A 2.39:1 picture inside a 1920×1080 file: black bars of 138 px top and bottom, so it plays anywhere 16:9 does. 24 fps for the film cadence (motion blur on fast moves). Compose for the wide frame: subjects off-center, room to look into.

## Timing

Slower than web video: shots of 2–6 seconds, cuts on action, a title card holds for at least 3 seconds. Builds in acts: a quiet open, rising cuts, a hard stop to black before the title.

## Safe areas

Everything (type included) inside the 2.39 picture, 96 px in from the sides.

## Build it with

Two `Layer.box` bars in black over everything (or the picture area as a clipped box); `Transition.fadeThrough` to black between acts.
