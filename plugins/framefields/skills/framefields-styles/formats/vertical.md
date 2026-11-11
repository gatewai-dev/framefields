---
id: vertical
name: Vertical
summary: 9:16 for Reels, Shorts and TikTok; a hook first, big captions, quick cuts.
tags: [social, mobile, reels, shorts, tiktok]
width: 1080
height: 1920
fps: 30
durationSec: { min: 10, max: 60 }
safeArea: { top: 250, right: 120, bottom: 400, left: 60 }
pairsWell: [look/motion, genre/product-launch, genre/lyric-video]
---

## Frame

1080×1920 at 30 fps. The subject stays in the center column; stack elements top to bottom rather than side by side. Captions are large (64–96 px), high contrast, two short lines at most.

## Timing

The hook comes in the first 2 seconds: the most striking image or line goes first, before any logo. Cut every 1–3 seconds, with punch-in zooms and movement in every shot. 15–45 seconds total; end on a clear payoff, or on a frame that loops back into the first.

## Safe areas

Platform UI covers the top 250 px and the bottom 400 px, and the right 120 px holds the like and share buttons. Keep type and faces out of those.

## Build it with

`new Composition({ width: 1080, height: 1920, fps: 30 })`; `components/captions` for synced captions; `components/focus-zoom` for punch-ins.
