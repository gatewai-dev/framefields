# 45 · Sculpture

A horned guardian bust sculpted in code with `Layer3D.clay`, filmed being made: shoulders, neck and head blocked out, snout and brow joined smoothly, horns growing along their strokes (`progress`), eyes, nostrils and mouth carved, the chin pulled with an elastic `grab`, the cheeks inflated, then a ridged stone `detail`. Each stage is the same op list cut shorter, shown for six frames while the camera circles the plinth; the finished bust holds for the last two seconds. `symmetry: "x"` mirrors everything sculpted at positive x.

The sculpture is drawn per pixel from its field, so it stays sharp at 1920×1080 with no polygon count to choose (about 0.2 s a frame on an Apple M1 Pro, the 21 stages' cache bakes included).

```bash
pnpm render              # output/sculpture.mp4 and output/sculpture.jpg (its last frame)
pnpm render frames 0 90  # single frames as PNG
pnpm render model        # output/guardian.glb: the finished bust, plinth, camera and lights as glTF
```

`pnpm render:src` runs against the workspace sources instead of the built packages.
