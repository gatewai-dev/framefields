---
id: blueprint
name: Blueprint
summary: Diagrams that build step by step on a quiet grid, with labels, arrows and code.
tags: [technical, diagram, clean]
palette: ["#0F1B2D", "#16263D", "#E8EEF6", "#5AA9FF", "#FFB547"]
fonts: { display: Inter, body: Inter, mono: JetBrains Mono }
pairsWell: [genre/explainer, medium/code-drawn, format/widescreen]
clashes: [genre/lyric-video]
ai:
  direction: "clean technical illustration, flat blueprint style, thin white linework on deep navy, isometric or orthographic view, precise and uncluttered"
  avoid: "photographic textures, dramatic lighting, people, decorative flourishes, text in the image"
  motion: "precise, mechanical, constant speed; camera moves only to focus a detail"
---

## Look

Clarity first: every element earns its place. A deep navy ground with a faint grid (24 px minor, 120 px major), thin off-white linework, and two functional accents: blue for "this" or data flow, amber for the part being discussed. What isn't being discussed dims to 35 %.

## Type

A neutral sans for labels and callouts (28–40 px), weight changes rather than size changes for hierarchy. Numbers, code and units in a monospace. Labels sit on the grid, aligned to its lines, with short leader lines to what they name.

## Motion

Calm and precise: `power2.inOut` over 12–20 frames. Diagrams build in the order the explanation needs them: boxes appear, then the connectors draw on (`trimEnd`), then the arrowheads. Highlight moves rather than cuts. A running step marker (1 / 4) so the viewer always knows where they are.

## Build it with

- `Layer.shape` with `trimEnd` for lines that draw on; `Layer.flex` for aligned boxes.
- `components/code-block` and `components/terminal` revealed line by line; `components/callout` for labels; `components/focus-zoom` and `components/spotlight` to direct attention.
- `Layer.chart` for numbers.

## Avoid

Gradients, glow, drop shadows, decorative 3D, more than two accents, motion that doesn't explain anything.
