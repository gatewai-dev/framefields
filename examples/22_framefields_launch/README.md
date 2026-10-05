# 22 — Framefields Launch

A 60-second launch film cut to a generated drum & bass track with a female rapper who never stops: every
on-screen lyric word appears on the frame it is rapped, and not before. The picture runs at 60 fps on a
180 BPM grid (a beat is exactly 20 frames, a bar 80), and the chapters are read off the take itself.

## Pipeline

```bash
pnpm fonts            # 14 OFL faces from google/fonts → assets/fonts/
pnpm song cost        # estimate (~$0.06), no calls
pnpm song             # song → stems → words → grid → chapters (retries takes that skip a line)
pnpm song measure     # re-run only the free steps on the cached take
pnpm images           # the compositing chapter's four layers (~$0.25)
pnpm precomp          # the finished composite rendered as footage for the chorus → assets/plate.mp4
pnpm render frames 483 2900 3300
pnpm render           # output/framefields-launch.mp4
pnpm test
```

| Step | Model / tool | Writes |
| --- | --- | --- |
| Song | `fal-ai/elevenlabs/music/v2.5`, one chunk per section: its lyric lines and styles; the first chunk carries the song-wide styles | `assets/song.mp3` |
| Stems | `fal-ai/demucs` (`htdemucs_ft`): vocals, drums | `assets/stems/` |
| Words | `fal-ai/elevenlabs/speech-to-text/scribe-v2` on the vocal stem, word timestamps, product names as key terms | `assets/words.json` |
| Take check | a take whose transcript misses most of a written line is set aside (`scratch/rejected-takes/`) and the next seed is generated | — |
| Grid | `music/beat-grid.ts` on the drum stem: the take must already run at 180 BPM (±0.2 %) | `assets/structure.json` |
| Lyrics | `music/align.ts`: written words timed by heard words (splits, merges, numerals spelled out: "120" ↔ "a hundred twenty"); a word nobody heard is placed just before the next heard one | `assets/lyrics.json` |
| Chapters | the first word of each chapter's line (`music/chapters.ts`), the final hit (`music/structure.ts`) | `assets/structure.json` |
| Envelopes | kick / snare from the drum stem, vocal level, per frame | `assets/envelopes.json` |
| Images | `fal-ai/flux-2-pro`: a backdrop, a camera on a green screen, a light leak on black, a paper grain (`images.ts`) | `assets/images/` |

The soundtrack is `assets/song.mp3` exactly as generated: nothing stretches, shifts or re-masters it, so
the film's clock is the take's clock. `FAL_API_KEY` is read from the repo root `.env`. The music model
treats section lengths as guidance, so nothing in the picture assumes the plan held: regenerate the song
and the film re-cuts itself.

Lyrics go on screen through `sungLine` (theme.ts), which gives each word its own start frame and shrinks a
line to fit. The compositor's "track truncated" warnings are worth reading: a keyframe past its clip
window usually means a layer with its own `startFrame` was keyed in scene frames.

## Chapters

| Lyric | Picture |
| --- | --- |
| "What if video was just code? … just type it and let it hit." | the camera leaps phrase to phrase through depth; a commit, a timeline struck out; dives through the logo (`assets/brand/logo.png`) |
| "Framefields!" | the logo and the lowercase name, extruded, whip in on an orbiting camera |
| "No browser, no Chromium, no screenshots, just the GPU." | each word redacted on the beat |
| "A hundred twenty frames a second, every pixel rendered true, watch it move" | the figure counts with the voice; three lanes render the same clip, each bar filling left to right at 12, 30 or 120 frames rendered a second and counting the clips it finishes; framefields laps the others, and on "watch it move" the slow lanes drop out |
| "After Effects, Photoshop, Premiere, Cinema 4D, Blender, Illustrator, all of it in one import" | each tool lands as a monogram tile (not its logo) captioned with what framefields takes from it; the tiles fall into one `import` line |
| "Every letter razor sharp … kinetic on every beat. Step inside the camera" | a font per sixteenth, a 40× Slug zoom, the line built along an arc, split / stagger / spin each set with the animator they name, a face per word; each kinetic word slams into its own row and the rows run against each other, a sliding wall that closes into a viewfinder the lens rushes |
| "fly the third dimension … light it up in depth." | one camera move: flight through hanging cubes, paths drawn in space, a cube burst, an orbit and dolly through a ring of capabilities, lit DEPTH |
| "Drop a mesh and make it bend … every frame a different shape." | procedural meshes deformed on the GPU by the song: harmonic wave, normal extrusion on the bass, ripple, twist; a new shape every beat |
| "It's just code … render true every night." | the comp's source beside its images; ColorKey pulls the green, an iris mask closes, a light leak screens and a paper grain multiplies; the stack explodes in 3D and collapses back |
| "Frame by frame … faster and faster!" | the composite, precomposed, through each named effect; two strips of graded footage accelerating against each other |
| "Framefields. Motion, compiled." | lock-up: logo, lowercase extruded name, the line built word by word, `pnpm add framefields` on the final hit |

## Engine work done for this film

Each has a regression test (`packages/framefields/src/*.test.ts`, `packages/webgpu-renderers/src/**/*.test.ts`).

- `Layer3D.grid` drew a solid plane; it now draws `divisions` line quads, split under the texture limit.
- `Layer3D.carousel` faced its items inward and put item 0 at the back.
- One-sided 3D quads culled the faces turned *toward* the camera (Y-down basis mirrors winding).
- The compositor used the first camera in the tree for the whole film; it now cuts to the camera whose window holds the frame.
- Same-sized 3D leaf layers could share a pooled texture before the 3D pass drew them.
- A canvas-sized media layer with effects inside an `overflow: hidden` box painted its raw frame outside the box.
- `renderVideo` reused one buffer for every 100 ms audio chunk while the encoder could still be reading it, garbling every soundtrack.
- glTF: node hierarchy, rotations and every skin are posed per frame (the skinning path applied translations only); base-colour textures with mipmaps, alpha mask/blend, MToon toon shading; models are parsed once, not every frame.
- Audio mesh deformation gained `twist` and `ripple`.
- Text on a path: SVG arcs (`A`/`a`) were ignored by the path parser; the last margin was read as an absolute position; force alignment dropped spaces.
- `overflow: hidden` ignored `borderRadius` (rounded and animated clips now hold).
- Text `verticalAlign` was ignored: a text block always sat at the top of its box (`text-vertical-align.test.ts`).
- Text antialiasing: each glyph's quad was its exact bounding box, so pixels just outside the outline never got their partial coverage, and the two Slug coverage rays were averaged rather than weighted; a glyph turned in the shader (text on a path) had stair-stepped edges. Quads are now dilated by a pixel, rays weighted by how near they cross an edge, and the pixel footprint measured per glyph axis (`text-antialias.test.ts`).
- `ColorKey` is exposed as an SDK effect (node-colorkey migrated to the generated classes).
