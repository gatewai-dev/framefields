# 23 — Data Story

A 30-second report where the data keeps moving. Revenue bars morph through three fiscal years, a
live feed slides a ten-second window over a stream of users, a donut and its share bars re-divide
month by month as search overtakes direct, the newest candle ticks while the price rolls, and the
outro's bars never sit still. Every chart is `Layer.chart`; counters roll on gsap-baked odometers;
accents breathe on signals. Light theme: the tokens are in `theme.ts` (page, text, muted, chart text
and grid, data hues, and darker text variants of cyan and green for numbers on white).

Nothing to download or generate: fonts come from the repo's `assets/fonts`.

```bash
pnpm render grid          # output/grid.png, a 16-frame contact sheet
pnpm render frames 230 400
pnpm render               # output/data-story.mp4
pnpm render:src grid      # same, on the engine's source (no package builds)
pnpm test
```

## Changing data: `morph` (`morph.ts`)

Build the same chart once per data state, with the same options and **fixed axes** (`yAxis.min` /
`max`), so every state has the same node ids. `morph` takes the first state's tree and, wherever a
node's `x`, `y`, `width`, `height` or `rotation` differs between states, keys it to ease from one
state to the next. The keys go after the chart's own reveal; overlapping them is an error.

```ts
const view = morph(
  YEARS.map((y) => ({ at: y.at, node: yearView(y) })), // Layer.chart + overlays per year
  { duration: 30, ease: "power3.inOut" },
);
```

Overlays built from chart geometry ride along for free: the revenue ring around the best bar, the
live feed's halo and level line, the market's ring around the newest candle. A layer with its own
`startFrame` is keyed on its own clock.

Two things can't be keyframed, so they're built differently:

- **Lines** (`live.ts`): a path's `d` doesn't animate, so the live line is drawn with rotated boxes
  between the chart's points (`segment()`), which morph like everything else.
- **Donut slices** (`donut.ts`): each slice is the same full circle, stroked and trimmed to its share.
  `trimStart`/`trimEnd` animate, so slices grow, shrink and slide round the ring. Round caps with a
  one-stroke gap keep the joins clean.
- **Numbers** don't change text; they roll on odometers.

## Scenes

| Scene | Data | What moves |
| --- | --- | --- |
| Revenue | three fiscal years, 8 months × revenue/costs | bars, best-month ring and caption; the year rolls 2023 → 2025 |
| Live | a stream of users, 10-sample window, a new sample every 11 frames | points, segment line, halo, level line; the latest value rolls; a LIVE dot blinks |
| Mix | four months of channel shares | donut slices and share bars re-divide; the search share and month roll |
| Market | 24 sessions, then 7 live ticks on the newest candle | candles stream in; the live candle, its ring and the price line move; the price rolls |
| Outro | 9 states of a 16-bar level meter | every bar |

## gsap and signals

**gsap** (`motion.ts`). framefields evaluates every `ease` string with gsap, so single moves are plain
keyframes. gsap is used directly where one tween isn't enough:

- `odometer()` rolls a "0…9" strip per digit in a clipped cell. The first value rolls in with a
  stagger (rightmost digits spin longest); every later value rolls each strip to its new digit. It's
  one gsap timeline, scrubbed frame by frame and written out as keyframes by `bake()`.
- `envelope()` is `gsap.parseEase`, so signal curves use the same easing vocabulary.

**Signals** (`signals.ts`) are per-frame functions registered on the composition by name and bound
with `LayerAnimation.signal(prop, name, { multiplier, offset })`:

| Signal | Shape | Drives |
| --- | --- | --- |
| `pulse` | 1 on every beat (100 BPM), decaying along `expo.out` | the rings, the live halo, the LIVE dot |
| `breathe` | 0 → 1 → 0 over four beats, `sine.inOut` | the backdrop glows |

Pass the signal's **name** to `.signal()` after `comp.addSignal`, not the signal object, and remember
signal functions see the **composition** frame.

## Layout

- `timeline.ts` — scene windows in frames; `film.ts` mounts them over the backdrop.
- `scenes/` — title, revenue, live, mix, market, outro. Each scene is a full-frame box on its own
  clock (children key from frame 0) that lifts out over its last ten frames (`ui.ts`).
- `film.test.ts` — the spec validates, scenes tile the film, signals are bound by registered name,
  `morph` keys only what changes and respects layer clocks, the revenue bars, live window and donut
  settle on their last states, and the rendered August bar grows 2023 → 2025 by the right ratio.
