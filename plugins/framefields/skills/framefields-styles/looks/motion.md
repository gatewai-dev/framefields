---
id: motion
name: Motion
summary: Kinetic type, bold flat shapes and snappy easing, cut to the beat.
tags: [type, graphic, music]
palette: ["#0E0D0C", "#F2EFE8", "#FF4D1F", "#2B2A28"]
fonts: { display: Archivo, body: Inter }
pairsWell: [genre/brand-film, genre/product-launch, genre/lyric-video, format/vertical]
clashes: []
ai:
  direction: "bold flat graphic shapes, high contrast, clean studio light, saturated orange accent on near-black, minimal composition with strong negative space"
  avoid: "clutter, busy textures, soft pastel tones, text rendered in the image"
  motion: "fast, decisive moves that settle; locked camera or one clean push"
---

## Look

Type and graphic shapes carry the piece. Two neutrals and one accent, used the same way throughout: near-black ground, warm off-white for type, the orange accent for the one thing that matters in each shot. Flat shapes, rules and grids as the supporting cast. No gradients, except a very slight vignette.

## Type

One family in one or two weights, large and set tight: display at 160–280 px on 1080p, with negative tracking (-2 to -4 %). Condensed widths (`wdth` 68–80) when it has to fit. Words arrive and leave with purpose: staggered per word or letter, masks and wipes rather than plain fades. One idea per screen.

## Motion

Fast in, soft settle (`expo.out`, `power3.out`) over 8–14 frames. Hold each idea long enough to read it twice, then move. Nothing drifts linearly, except a deliberate background loop. With music, entrances and cuts land on beats or onsets. Transitions are part of the motion (a shape sweeps across, type scales into the next scene), not crossfades.

## Build it with

- `TextAnimator.wordPop`, `TextAnimator.waveRise` with `LayerAnimation` sweeps for the type; `components/text-reveal` and `components/word-cycle` for ready-made beats.
- `Layer.shape` rects and rules for wipes. `Transition.wipe`, `Transition.push` between scenes.
- A beat grid in `theme.ts` (`BEAT`), and `AudioSignal` onsets to place hits.

## Avoid

Drop shadows, bevels, more than one accent, centered body text in paragraphs, and anything that moves without a reason.
