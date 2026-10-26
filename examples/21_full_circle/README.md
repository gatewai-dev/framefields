# 21 — Full Circle

A 36-second film of match cuts. Eight generated shots — eclipse, iris, porthole, crema, record,
spotlight, tunnel, moon — are each built around one circle, and a single ring carries the eye
from one to the next. The edit is cut to a generated score whose beat grid is measured, not guessed.

## Pipeline

```bash
pnpm assets cost     # print the estimate (~$6.5), no calls
pnpm assets          # fonts, stills, shots, score, beat grid, circle tracks
pnpm render frames 0 154 637
pnpm render          # output/full-circle.mp4
pnpm test
```

| Step | Model / tool | Cost |
| --- | --- | --- |
| Stills, 1920×1080 | `seedream/5.0-pro` | $0.072 / image |
| Shots, 6 s at 720p | `seedance/2.0-mini` (still as first frame, no sound) | $0.121 / s |
| Score, 36 s | `seed-audio/1.0` (one prompt, instrumental) | $0.003125 / s |
| Beat grid → `assets/score.json` | `src/beat-grid.ts` (onset flux, autocorrelation, comb refinement, drop-anchored downbeat) | free |
| Circle tracks → `assets/circles.json` | `src/circles.ts` (ffmpeg grey frames, seeded flood fill per frame) | free |

`FRAMEFIELDS_API_KEY` is read from the repo root `.env`. Every step is idempotent; delete a file to regenerate it.
Generated media is gitignored; the two JSON files are tracked so tests and the edit math run without it.

## How the film is built

- `shots.ts` — prompts for every still, its motion, and how to find its circle.
- `grid.ts` — the clock: `bar(n)` / `beat(n)` from the measured score. Regenerate the music and the edit re-times itself.
- `edit.ts` — the cut list in bars, and the planner that decides where the ring sits at every cut.
  Free cuts *release* from the match into their own framing and *gather* back into the next match;
  held cuts (montages, the hush) pin their circle to one ring; windowed cuts show only the inside of it.
- `plates.ts` — pose math. A plate's circle is mapped onto a target with the smallest scale that still
  covers the frame (`coverScale`); blending in scale/centre space keeps every in-between pose covering too
  (`film.test.ts` checks every frame).
- `reel.ts` — layers from the plan: plates (circular windows are a disc composited with `mask-in` inside
  its own layer group), the ring, the catalogue captions.
- `scenes/` — the words, flashes and fades: open, hush, drop (orbiting title on a circular text path), tunnel, finale.
