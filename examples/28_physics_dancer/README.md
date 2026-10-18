# 28 — Physics dancer

A 6.6-second shot where rigid-body physics meets on-device vision. Word cards fall onto a
dancer's raised hands and head and tumble to the floor; a cloud of ~800 particles flows around
her as the silk dress sweeps through it.

```bash
pnpm fonts            # Syne from google/fonts → assets/fonts/
pnpm render sim       # analyses the clip and steps the physics without drawing (~35 s cold, ~6 s cached)
pnpm render           # output/physics-dancer.mp4
pnpm render preview   # live player; vision and physics fill in as it plays
pnpm render:src       # same, on the engine's source (no package builds)
```

The clip is example 19's `assets/dancer.mp4`; generate it there with `pnpm assets`.

## How it works

| Piece | API |
|---|---|
| Pose and silhouette, frame by frame as it renders | `comp.vision(clip).person`, placed with `.place({ width, height, fit })`; results persist in `~/.cache/framefields/vision` |
| Physics that steps with the render | `world.live(comp)`: before each frame draws, its vision is ready and the world advances to it |
| Arms and head that catch the cards | kinematic circle bodies along shoulder → elbow → wrist (and past the wrist for the hand), `follow`ing `person.point(name, frame)` |
| The dress pushing particles and cards | `world.field()` with `person.sample(frame, x, y)`: out along the silhouette's gradient, much harder where the silhouette just arrived (the sweep) |
| Fluid feel | small circles with `linearDamping` 2.2, near-zero gravity, a slow swirling current and a soft pull home |
| Particles behind her | a second copy of the clip, cut out with `.withVision({ mode: "matte" })`, above the particles |
| Hot particles | `.colorSignal("fillColor", body.speed, { multiplier: 1 / 900, … })` |
| Screen shake | the whole stage's `y` driven by `world.impact` |

Cards are sized with `FontManager.measure`, so the text always fits. A live world can't look
ahead, so they drop at fixed offsets from where her head starts and find her hands on the way down.
