# 44 · First Light (framefields desktop)

The launch film for framefields desktop: 28 seconds, one world, one camera move, no cuts, cut to 120 BPM.

A field of about 18,000 small frames sleeps on a dark mirror. The app rises out of the floor as the one lit window. A line is typed into its composer, *a field of frames at first light*, and the field wakes in a ring that spreads from the window: every frame stands up, turns to face it and starts playing a small film. The field flips in a checkerboard on four beats, the playhead in the window's timeline crosses and the same playhead crosses the field. The camera dives through the preview (it is an opening in the window, so what the preview shows is the field behind it) and corkscrews up to find a few hundred frames landing along the strokes of the mark.

```bash
pnpm assets                 # writes the score (synthesized in code)
pnpm render                 # output/first-light.mp4
pnpm render frames 190 600  # single frames into output/frames/
pnpm render grid            # a contact sheet, output/grid.png
```

`pnpm render:src` runs against the workspace sources instead of the built packages.

## How it is made

- `src/theme.ts`: the beat grid; every cue in the film is a bar or a beat (`BEAT`).
- `src/field.ts`: the field is `Layer3D.instances` with an `instanceAt` that places every frame every frame (sleep, the wake ring, the flips, the playhead's wave, the flight into the mark). Six layers share one pose: the metal rims, four layers of screens (each with its own `texture`, a small animated layout from `src/screens.ts`) and the plain blue lights the mark's frames turn into.
- `src/mark.ts`: the brand mark's strokes sampled into places for frames, rows of one frame size across each stroke.
- `src/window.ts`: the app as a slab with an opening for the preview, its UI on unlit planes in front, arriving in a stagger, the line typed a key at a time.
- `src/camera.ts`: the take as stations on a smooth curve, slow at each and fast between, with roll, a lens kick and shake on the hits, baked to a key per frame. No depth of field; motion blur only.
- `src/film.ts`: the world, the rings and flashes on the two hits, and the viewfinder corners that frame the picture and close in on the mark.
- `src/score.ts`, `src/sound.ts`: the only sound is a score synthesized in code on the same beat grid, with the picture's accents written into it. No effects, no generated or licensed audio.
