# 47 · Topple

A small physics game, drawn by the framefields engine and simulated by Steel
on WebGPU, live in the browser. Towers of blocks stand on a platform: throw
balls at them and score a point for each block knocked off. Twelve balls.

```bash
pnpm install
pnpm --filter @framefields/example-47-topple dev   # http://localhost:4747
```

- **Click** (or tap) to throw at what is under the pointer: the pick is
  measured by the renderer, and the ball's arc is solved to land there.
- **A / D** or **← / →** circle the platform, **W / S** or **↑ / ↓** raise and
  lower the view, the wheel zooms, **Space** throws at the middle, **R**
  starts over. A gamepad's left stick circles and its A button throws.

## How it works

- `src/game.ts` builds the level with Steel's `SceneBuilder` and steps it
  live. Input comes from `comp.input`: `on("pointerdown")` picks the
  surface under the pointer (`e.pick()`), and an `onRequestFrame` hook reads
  keys, wheel and gamepad once per frame (`axis`, `pressed`, `gamepads`).
  Throws are queued and applied in the world's `control` (`setBodyPose`,
  `setBodyTwist` on the next ball from the rack).
- The score, the balls left and the verdict ("All down!", "Out of balls")
  are live text: `Layer.text(() => \`${game.score} / 15\`, …)` reads the
  game each frame it is drawn (the player compiles the composition once, so
  assigning a layer's `text` in a hook would not reach the page).
- The 3D scene sits in a box with its own camera; the HUD is plain 2D layers
  above it.
- `src/app.ts` is the page loop: one simulation frame per 1/60 s of wall
  clock, drawn with `player.render`. The player feeds the input itself.
