---
id: swiss
name: Swiss
summary: The International Typographic Style; a strict grid, flush-left type and one red.
tags: [type, graphic, grid, clean]
palette: ["#F2F0EB", "#111111", "#E3241B", "#BDB8AE"]
fonts: { display: Inter, body: Inter }
pairsWell: [genre/data-story, genre/explainer, format/widescreen, format/square]
clashes: [genre/lyric-video]
ai:
  direction: "modernist graphic photograph, strong geometry, hard daylight, high contrast black and white with one red element, generous negative space, objective and calm"
  avoid: "ornament, soft focus, gradients, busy texture, text in the image"
  motion: "straight lines only: slide on the grid axes, never on a curve; holds between moves"
---

## Look

Objective and ordered. A twelve-column grid with a visible baseline, everything flush left on it, generous white margins. Off-white ground, near-black type, one red used sparingly for the single thing that matters, and a warm gray for rules and secondary marks. Photography, when used, is black and white and cropped hard to the grid.

## Type

One neo-grotesque (Inter) in two weights: regular for text, bold for the headline. Flush left, ragged right, tight leading for display (0.95), never centered. Size contrast does the work: a huge number or word against small captions. Numbers in tabular figures.

## Motion

Moves along the grid axes only: elements slide in horizontally or vertically by whole columns, with `power3.inOut` over 10–16 frames, and hold. Rules draw on. No rotation, no scale bounce, no fades without movement.

## Build it with

- `Layer.flex` and fixed column math in `theme.ts` (column width, gutter, baseline) for the grid.
- `Layer.shape` rects and rules with `trimEnd`; `Layer.chart` with the red as the only series color that matters.
- `components/counter` for big numbers; `TextAnimator.wordPop` sparingly.

## Avoid

Centered layouts, more than one accent, drop shadows, rounded corners, script or display faces, decoration that carries no information.
