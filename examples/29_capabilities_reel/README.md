# 29 — Capabilities reel

A 74-second, 120 BPM reel that puts every corner of framefields on screen, one chapter a few bars
long, cut together with every transition the sequencer has. The pictures are made from downloaded
Lotties, animated emoji and SVGs, run through the effect nodes in [`nodes/`](../../nodes); the
score is synthesized here and mixed through the audio nodes during the render.

```bash
pnpm assets            # Lotties, Noto animated emoji, Fluent/Twemoji/Lucide SVGs, fonts → assets/
pnpm score             # synthesizes the four stems → assets/stems/
pnpm render grid emoji # contact sheet of one chapter
pnpm render frames 0 400 1990
pnpm render seq vision 0 20   # vision chapters need frames in order
pnpm render            # output/capabilities-reel.mp4: one renderVideo with QA (~3 min on an M-series Mac)
pnpm render:segments   # the same, in fresh processes split at hard cuts (for constrained machines)
pnpm render preview    # live player
pnpm probe             # every downloaded asset on one sheet (output/probe-*.png)
pnpm probe:nodes       # the montage looks on one still
```

The vision chapter uses example 19's `assets/dancer.mp4`, `portrait.mp4` and stills; generate them there
with `pnpm assets`.

## Chapters

Bars are 2 s (60 frames at 30 fps). Each chapter starts on a downbeat; its transition plays over the tail of
the one before.

| # | Bars | Chapter | On screen | API |
| --- | --- | --- | --- | --- |
| 01 | 0–2 | Open | Noto fire Lottie throwing GPU sparks, embers, an aurora that wakes on the drop, kick shockwaves, emoji pops, the name wave-rising, RGB split into the whip | `Layer.lottie`, `Layer.particles`, `Layer.vfx`, `TextAnimator.waveRise/blurIn`, `LayerStyle`, `RGBSplit` |
| 02 | 3–5 | Lottie | Eight Lotties on cards flipping in, an abstract Lottie blurred as the backdrop, the wall tilting in perspective | `Layer.lottie`, `rotateY`/`perspective`, `LayerStyle.dropShadow`, `Blur` |
| 03 | 6–8 | Emoji + physics | 30 Noto animated emoji raining onto glowing bars and piling up; the loudest hit shakes the stage | `Physics.world2d`, `world.body(lottie, { shape: "circle" })`, `world.impact` |
| 04 | 9–11 | SVG + shapes | Lucide icons drawn on stroke by stroke, a gradient path morphing blob → star → heart → circle → burst, Fluent SVG emoji orbiting | `Layer.svg`, `Layer.shape("path")`, `trimEnd`, `d` keyframes |
| 05 | 12–15 | Stylize | 12 tiles × 12 `Styles.*` looks on stills and Lotties; then the dancer clip full frame, a new look on every beat | `withEffects(Styles.*)`: Posterize, Ascii, Pixelate, Toon, Halftone, CRT, RGBSplit, Painterly, Contour, Kaleidoscope, OpArt, Iridescence, GradientMap, Dither |
| 06 | 16–18 | Warp + fluid (breakdown) | Gooey metaballs from big particles, a Trails light pen, a Liquify twirl over a poster TileOffset scrolls under it; the live low-pass EQ curve | `Gooey`, `Trails`, `Liquify`, `TileOffset`, `AudioParametricEq({ frequency: signal })` |
| 07 | 19–21 | Vision (drop) | The dancer analysed on device: a word behind her (matte cutout), embers parting round her silhouette, sparkle Lotties on her wrists | `comp.vision`, `person.place/point`, `withVision({ mode: "matte" })`, particles `push: { person }` |
| 08 | 22–24 | Typography | Text on a rotating circular path, per-glyph 3D flips, a Lottie inside giant letters, Hello / مرحبا / שלום, a typed code line | `TextAnimator.flip3D`, `withMatte(text)`, `direction: "auto"`, `typewriter`, `TextPathBuilder` |
| 09 | 25–27 | 3D | Orbiting camera, extruded name, chrome and glass spheres, a cube with Lottie faces, a carousel of Lottie cards, emissive orbs blooming on the kick | `CameraAnimation.orbit`, `Lighting.dramatic`, `Layer3D.*`, `material: "glass"`, `Layer.cube`, `Layer.carousel3d` |
| 10 | 28–30 | Data + color | The 74 nodes as an animated bar chart and donut; then a before/after wipe across a full grade | `Layer.chart`, Curves, SelectiveColor, ColorBalance, ShadowsHighlights, Vignette, FilmGrain, `withMatte` |
| 11 | 31–32 | Node montage | Sixteen cuts on the eighth notes, one more node each: ColorKey, CornerPin, MeshWarp, Pixelate, Flip (symmetry), Rotate, Modulate, Levels, HighPass, UnsharpMask, Relight3D, CameraParallax3D, RefractionCaustics3D, HalftoneScreen (CMYK), ApplyLUT (a `.cube` written by the scene), Datamosh | `withEffects([...])` on video |
| 12 | 33–36 | Finale | Particle vortex surging on the kick, Lottie fireworks, every emoji SVG orbiting the mark, the install line, the last hit and a TV power-off | everything above |

Over all of it: a whole-composition ColorBalance, Vignette and FilmGrain (`comp.apply`), and the four stems
through AudioCompressor, AudioParametricEq (low shelf; the low-pass sweep), AudioDelay (ping-pong),
AudioReverb, StereoPanning (risers) and AudioFade.

## How it is put together

- `timeline.ts` — chapters on the bar grid; `music.ts` — the arrangement as data. The synthesizer
  (`score.ts`) and every beat-reactive signal in the picture read the same note list, so nothing is detected
  and nothing drifts.
- `precomp.ts` — type that needs a glow or a split is rendered once to a transparent PNG and used as an image:
  layer effects run on media layers (video, image, SVG, Lottie, particles, VFX), not on boxes or text.
- `film.ts` — `Layer.sequence` with one transition per cut; each chapter runs on under the next one's
  transition so the next starts on its downbeat.

## Assets and licences

`src/fetch-assets.ts` is the record. Noto Animated Emoji (CC BY 4.0, Google) · Fluent Emoji (MIT, Microsoft) ·
Twemoji 15.1 (CC BY 4.0) · Lucide (ISC) · lottie-ios samples (Apache-2.0, Airbnb) and their LottieFiles samples
(Lottie Simple License) · lottie-web demos (MIT, Airbnb) · fonts from the repo (OFL) and Noto Sans
Arabic/Hebrew (OFL). The credits are on the end card.
