# 28 — Physics dancer

A 6.6-second shot that puts most of the engine in one frame: glass word cards are thrown in from
both sides and bounce off a dancer's raised arms and head, the last one landing on her hands; a
cloud of embers parts around her silk dress. Renders in about 20 seconds.

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
| 3D physics that steps with the render | `Physics.world3d(…)` + `world.live(comp)`: before each frame draws, its vision is ready and the world advances to it |
| Glass cards | `Layer3D.roundedBox({ material: "glass" })` as the rigid body, the word as unlit blue `Layer3D.extrudedText` following the body's `x`/`y`/`z` signals just in front of it; `lockRotation: true` keeps every word upright |
| Thrown in from the sides | each card's launch `velocity` solved from gravity and a 0.7 s flight so the arc crosses her head and arms; the finale drops from above with a lower `gravityScale` |
| Arms and head that catch them | kinematic spheres along shoulder → elbow → wrist (and past it for the hand), `follow`ing `person.point(name, frame)`; without a camera layer the 3D z = 0 plane matches the video 1:1 |
| Embers | `Layer.particles` with `push: { person }` (her silhouette, hardest where it sweeps in), curl `noise`, `colorBySpeed` |
| Embers behind her | a second copy of the clip, cut out with `.withVision({ mode: "matte" })`, above the embers |
