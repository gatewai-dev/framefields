# Style guide: which look for which request

Use this guide to turn what someone asks for ("make it look like a VHS tape", "8-bit", "liquid logo") into the framefields features that produce it. Start from a `Styles.*` preset when one fits, then tune it or add layers. Every preset returns an effect stack: `layer.withEffects(Styles.vhs())`. Effects attach to media layers (video, image, SVG, particles, VFX). To stylize a whole scene, apply the effects to the composition's master pass (see SKILL.md "Whole-Composition Master Emulsion").

## Visual styles

| They ask for… | Use | Notes |
|---|---|---|
| 8-bit, pixel art, retro game | `Styles.pixelArt()` | `palette: "c64" \| "cga"`; add `LayerAnimation.stepped(2)` on sprites. |
| Game Boy | `Styles.gameBoy()` | Four greens. |
| Teletext, Ceefax, blocky TV text | `Styles.teletext()` | Pair with a monospace font in a grid layout. |
| LED wall, stadium screen, dot matrix | `Styles.ledWall()` | `Pixelate` `shape: "circle"`. |
| 1-bit, Mac Paint, dithered, Obra Dinn | `Styles.oneBit()` | `Dither` `mode: "bayer" \| "noise" \| "halftone"`. |
| ASCII, text art, terminal, hacker, Matrix | `Styles.ascii({ matrix: true })` | `colorMode: "source"` keeps the clip's colors. |
| Risograph, zine, print, duotone | `Styles.risograph({ inkA, inkB })` | Two inks plus paper. |
| Comic book, pop art | `Styles.comic()` | `Toon` + `HalftoneScreen`; add speech bubbles as boxes. |
| Cartoon, cel-shaded, anime outline | `Styles.cartoon()` | `Toon`. |
| VHS, camcorder, 90s home video | `Styles.vhs()` | Add a timestamp text layer and `FilmGrain`. |
| CRT, old monitor, arcade screen | `Styles.crt()` | |
| Glitch, corrupted, error | `Styles.glitch()` + `Datamosh` | Drive `RGBSplit.amount` from audio or keyframes for hits. |
| Datamosh, pixel bleed | `Datamosh({ keyframes })` | Clean picture on the keyframes, smears between. |
| Oil painting | `Styles.oilPainting()` | |
| Watercolor, painted | `Styles.watercolor()` | Add a paper-texture image with `blendMode: "multiply"`. |
| Topographic, contour map | `Styles.topographic()` | `Contour` `fill: "source"` keeps the footage under the lines. |
| Kaleidoscope, psychedelic, trippy | `Styles.kaleidoscope()` | Animate `rotation`; add `Modulate` hue cycling and `Trails`. |
| Op art, line portrait, Bridget Riley | `Styles.opArt()` | `pattern: "rings" \| "checker" \| "waves"`. |
| Holographic, foil, iridescent, chrome sheen | `Styles.holographic()` | Animate `shift`; on 3D text use `material: "glass"` or a metallic PBR material. |
| Thermal, heat vision, predator | `Styles.thermal()` | |
| Film noir, black and white | `Styles.noir()` | |
| Film, analog, cinematic | `Styles.film()` | Add `ApplyLUT`, `Curves`, `DepthOfField` as needed. |
| Neon, glow, synthwave | `LayerStyle` outer glow + `blendMode: "screen"` | Dark background, saturated pinks and cyans, bloom on 3D. |
| Y2K chrome, metallic 3D type | `Layer3D.extrudedText` metallic + `Layer.environment` | |
| Glass, glassmorphism, frosted | `Layer3D` `material: "glass"` (refracts what is behind it) | 2D: `PBRGlass`. |
| Clay, plasticine, claymation | `Layer3D` rough materials + soft lighting + `LayerAnimation.stepped(2)` | Stepped timing gives the stop-motion feel. |
| Paper cut-out, origami, papercraft | Shapes with drop shadows + `stepped(2)` + paper texture (`multiply`) | |
| Hand-drawn, doodle, line boil | Stroke `trimEnd` draw-on + `wiggle` on `d`/position + `stepped(2)` | |
| Isometric | `perspective: 0` + `rotateX`/`rotateZ` | |
| Blueprint, technical drawing | Grid boxes + stroke draw-on (`trimEnd`) on a blue background | |
| Aurora, northern lights | `Layer.vfx({ effectType: "Aurora" })` | `colorStart` (base) and `colorEnd` (top). |
| Smoke, fire, rain, snow, dust, sparks, embers, magic, lightning, lens flare | `Layer.vfx({ effectType })` for a backdrop, `Layer.particles` when particles must react to something | |
| Particles, flow field, swarm | `Layer.particles` with `noise`, `attractors` | |
| Light painting, light trails | `Layer.particles` `blend: "add"` following a tracked wrist, or `Trails` on bright footage | |
| Dancer moving through particles | `Layer.particles({ push: { person } })` + a vision cutout above | |
| Liquid, blob, metaballs, morphing logo | Animate a shape's `d` (morph) and/or `Gooey` on an SVG or particle layer | |
| Collage, sticker, cut-out people | `withVision({ mode: "matte" })` cutouts with stroke and shadow (`LayerStyle`) | |
| Text behind subject | Subject sandwich (SKILL.md) | |
| Bauhaus, Memphis, Art deco, neo-brutalism, Web 1.0, retro desktop, skeuomorphic, neumorphism, Word Art | Layout, shapes, gradients, `LayerStyle` (bevel, inner/drop shadow), fonts | Composition work, not effects. |

## Motion templates

| They ask for… | Use |
|---|---|
| Things falling, dropping, piling up, gravity, bouncing | `Physics.world2d` / `world3d` bodies; a ground and walls |
| Objects hitting a person / dancer | `comp.vision(clip)`, then kinematic limb colliders following `person.point(...)` |
| Jiggle, wobble, jelly | `spring` eases, `wiggle` tracks, or physics joints |
| Kinetic typography, hook text | `TextAnimator`, keyframes with `back` / `expo` eases |
| Stop-motion feel, "on twos" | `LayerAnimation.stepped(2)` |
| Reveal, wipe, text through a shape | `withMatte` |
| Scene changes | Transitions (compose SKILL.md "Scenes & Transitions") |
| Beat-synced cuts and pulses | Audio signals driving props or effect strengths |
| UI mockups (prompt bar, NLE timeline, comment drop, notifications) | Boxes, text, `flex` layout, `spring` keyframes |

## Combining

- One stylize look per layer is usually enough. Stacking more than two strong looks (e.g. ASCII then CRT) works, but keep the strongest one last.
- Stylize the footage and keep text and UI clean on top. Readable text sells the video.
- Pair a look with matching motion: pixel art and paper styles use `stepped(2)`; VHS and glitch work with hard cuts; watercolor and aurora suit slow eases.
