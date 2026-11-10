---
id: collage
name: Collage
summary: Paper collage, highlighted documents and slow pushes on archival images.
tags: [editorial, texture, documentary]
palette: ["#D9CCB4", "#F4EEE2", "#3B3A36", "#F5E300", "#B5452F"]
fonts: { display: Libre Franklin, body: Libre Franklin, mono: JetBrains Mono }
pairsWell: [genre/explainer, format/widescreen, medium/ai-generated]
clashes: [format/ad-spot]
ai:
  direction: "black-and-white archival press photograph, period-accurate, printed on matte newsprint, coarse grain and slight ink bleed, soft overcast daylight, documentary framing"
  avoid: "glossy CGI, neon, lens flare, modern UI, text in the image"
  motion: "slow push-in or gentle pan, almost still; no fast camera moves"
---

## Look

A documentary told through layered paper and archival material, in the video-essay tradition. Textured paper grounds, cut-out photos with soft drop shadows and slightly rough edges, layered so the collage builds over time. Muted warm palette with one bright accent: the highlighter yellow. A rust red for marks and arrows.

## Type

A clean grotesque for labels and source captions (small, set in the margin), and the same face, bold, for the one headline per scene. Quotes sit on paper cards, set like a newspaper clipping. Monospace only for dates and sources.

## Motion

Slow and steady: every still pushes in or pans (scale 1.0 → 1.06 over the shot, `sine.inOut`); nothing is ever static. Pieces of paper land with a small settle and a 1–2° rotation. The highlighter sweeps across the key words exactly as the narration says them. Pacing follows the voiceover, one idea per beat.

## Grade

Warm, slightly lifted blacks, light film grain (`FilmGrain`) and a soft vignette (`Vignette`), applied over everything with `comp.apply`, so generated stills and drawn paper share one surface.

## Build it with

- `Layer.box` paper cards with `LayerStyle` drop shadows; torn edges as `Layer.shape` paths.
- `HalftoneScreen` on photos for the printed look; `components/annotate` and `components/callout` for marks.
- `components/lower-third` for sources; `Layer.chart` for simple charts that draw themselves.

## Avoid

Glossy surfaces, neon, perfect vector edges on photos, fast cuts, more than one highlight color.
