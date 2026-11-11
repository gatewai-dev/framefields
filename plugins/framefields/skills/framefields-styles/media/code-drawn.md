---
id: code-drawn
name: Code-drawn
summary: "Everything drawn by the engine: type, shapes, charts, components. Free, exact and editable."
tags: [vector, type, components]
credit: false
---

## Pipeline

1. `theme.ts` first: the look's palette, fonts and eases as constants, and the format's size and beat grid.
2. One file per scene; each returns a full-frame box with its own window.
3. Reach for registry components (`npx framefields add`) before building a beat from scratch, and theme them from the look.
4. Fonts pinned and registered before any text is built.

## Verify

`npm run check`, then frames at each beat (`npm run frames -- …`) and a grid for motion. Look at type sizes on the real frame size, not a scaled preview.

## Build it with

`Layer.text`, `Layer.shape`, `Layer.flex`, `Layer.chart`, `LayerAnimation`, `TextAnimator`.
