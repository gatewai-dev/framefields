---
"framefields": minor
---

Add a stylize effect pack: `Pixelate` (square, circle/LED and diamond cells), `Posterize` (levels or retro palettes: GameBoy, teletext, CGA, PICO-8, C64, grayscale, sepia, custom; with Bayer dithering and big pixels), `Dither` (Bayer, noise and halftone; 1-bit duotone or per channel), `Ascii`, `Toon` (cel bands and ink outlines), `RGBSplit`, `CRT` (curvature, scanlines, aperture mask, plus VHS tracking and colour bleed), `Painterly` (Kuwahara oil and watercolour), `Contour` (topographic lines), `Kaleidoscope`, `OpArt`, `Iridescence` (holographic foil) and `Gooey` (metaballs).

`Styles.*` presets return ready-made effect stacks for common looks (`pixelArt`, `gameBoy`, `teletext`, `ledWall`, `ascii`, `oneBit`, `risograph`, `comic`, `cartoon`, `thermal`, `vhs`, `crt`, `glitch`, `oilPainting`, `watercolor`, `topographic`, `kaleidoscope`, `opArt`, `holographic`, `noir`, `film`): `layer.withEffects(Styles.vhs())`.

`LayerAnimation.stepped(n)` gives a layer stepped timing ("on twos"): every animated value is held for `n` frames, eases kept. A shape's `d` is now animatable: keyframed SVG paths morph into each other, resampled and aligned so paths with different point counts, curves and subpaths morph cleanly.

`Layer.vfx()` draws `ProceduralVFX` looks as their own layer (the node was not registered before), and adds an `Aurora` effect type.
