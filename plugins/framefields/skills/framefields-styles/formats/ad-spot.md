---
id: ad-spot
name: Ad spot
summary: A 15 or 30 second spot with a fixed shape; hook, one message, brand, call to action.
tags: [ads, commercial, broadcast]
width: 1920
height: 1080
fps: 30
durationSec: { min: 15, max: 30 }
safeArea: { top: 54, right: 96, bottom: 54, left: 96 }
clashes: [look/collage]
pairsWell: [genre/product-launch, look/keynote]
---

## Frame

1920×1080 at 30 fps (or the vertical size when the user wants it for social; the timing below still holds).

## Timing

Exactly 15 or 30 seconds; never a frame over. Hook in the first 3 seconds, one message (not three), the brand by the halfway mark, and the last 3 seconds for the end card: logo, line and call to action, held still. On a 30-second spot the middle is two or three proof beats.

## Safe areas

Broadcast title safe: 5 % in from every edge. Legal lines in the bottom safe area, at least 28 px and on screen for 3 seconds or more.

## Build it with

`components/title-card` and `components/logo-reveal` for the end card; check the total with `calculateTimeline().totalFrames`.
