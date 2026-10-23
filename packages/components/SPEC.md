# framefields components — specification & plan

Status: **M0 implemented** (foundations; no components yet) · Branch: `feat/components` · Owner: framefields core

This document defines what the framefields component library is, how it plugs into the
SDK, which components ship first and why, and the exact contract every component follows.
It is the source of truth for implementation; anything not covered here is a decision to
raise before writing code.

---

## 1. What we are building

A library of **ready-made, parametric motion components**: the recurring pieces of product
films, explainers, launch videos and social clips that today every project rebuilds by hand
(cursors, captions, counters, code terminals, annotations, title cards …).

Our own example films are the evidence. They each hand-roll the same helpers: an odometer
(`examples/23_data_story/src/motion.ts`), pop-in and fade presets, star / heart / blob path
generators (`examples/29_capabilities_reel/src/kit.ts`), beat rings, headers and scene
wrappers (`examples/23_data_story/src/ui.ts`). The component library turns those into one
tested, documented, versioned API.

### 1.1 Goals

1. **One import, zero setup.** `import { MousePointer, Captions } from "framefields"`. No
   second package to install, no registration step, no runtime to mount.
2. **Pay only for what you use.** Every component is a standalone named ESM export in a
   `sideEffects: false` module graph. Importing one component never pulls another.
3. **Native, not embedded.** A component is a function that returns an ordinary framefields
   layer tree. Everything the SDK can do to a layer (`.animate()`, effects, mattes, 3D,
   physics bodies, vision pinning, blend modes) works on a component.
4. **Exact by construction.** Components measure real glyphs with the registered fonts,
   resolve timing on the integer frame clock, and use seeded randomness. Same props → same
   pixels, on every machine, in any frame order.
5. **Agent-first.** Every component ships a typed props schema, a one-paragraph summary,
   tags and a canonical example, so a coding agent can discover, validate and use it
   without reading source.

### 1.2 Non-goals

- **Scene transitions.** They already exist as `Transition.*` for `Layer.sequence`. New
  transitions are contributed there, not as components.
- **Charts.** `Layer.chart` covers line / area / bar / scatter / candlestick / pie / donut.
  Components may *wrap* a chart (e.g. a stat card), never re-implement one.
- **Whole-frame looks and VFX.** `Styles.*`, `Layer.vfx` and the effect nodes own those.
- **A visual editor or template marketplace.** This is a code library.
- **HTML / DOM rendering.** Components build native nodes only.

### 1.3 How we differ from snippet catalogs

A catalog of copy-paste snippets gives you one fixed animation per entry and leaves you to
wire its timing to everything else. We go the other way:

| Snippet catalogs | framefields components |
|---|---|
| Many one-off entries, one look each | Few deep components, each with `style` variants |
| Timing lives inside the snippet | Timing is input (`at`, beats, word timings) **and** output (`cues`) |
| Positions guessed in CSS | Targets resolved from measured text, layout rects or tracked objects |
| Randomness at runtime | Seeded, frame-exact, replayable |
| Copy, then edit the source | Typed props, `theme`, and a `customize` hook over the built parts |
| Flat, 2D | Can use GPU effects, particles, physics, vision mattes and 3D |

---

## 2. Design principles

1. **Props in, layer tree out.** A component is a pure function. It never touches the
   `Composition`, never registers globals, never reads the clock or `Math.random`.
2. **Cues out.** Every component reports *when* its meaningful moments happen (clicks,
   keystrokes, words, landings) as integer frames. Sound design, particles, camera moves
   and other components sync to those cues instead of to re-typed magic numbers.
3. **Few components, many styles.** Prefer one `TextReveal` with ten `style`s over ten
   reveal components. Variants share the timing, staggering and measurement logic and stay
   consistent with each other.
4. **Targets, not coordinates.** Anything that points at something (cursor, annotation,
   zoom, callout) accepts a `Target`: a point, a rect, a measured text range, a node, or a
   vision-tracked object.
5. **Theme tokens, not hex codes.** Colors, fonts, radii and motion come from a `Theme`.
   Every token can be overridden per instance.
6. **Escape hatches everywhere.** `customize(parts)` exposes every built sub-node, so users
   never fork a component to change one detail.
7. **Plain data.** The produced tree is plain program JSON. Cues and helpers ride on
   non-enumerable properties (the same way `.animate()` does today), so `toJSON()`,
   linting, previews and server rendering are unaffected.

---

## 3. Package architecture

### 3.1 Import story

```ts
// The default: straight from the SDK root.
import { Composition, Layer, MousePointer, Captions } from "framefields";

// Same exports from a dedicated subpath, for consumers that want an explicit boundary
// (the browser preview engine, bundle-size-sensitive builds).
import { MousePointer } from "framefields/components";
```

Components are exported from both paths. The root exports only the user-facing pieces
(the components, `themes`, `defineTheme`, `pulseKeys`, `bindComponent` and the `Target` /
`Cue` / `ComponentNode` / `Theme` types). The subpath adds the authoring toolkit (timing,
paths, strokes, targets, baking, motion presets, `defineComponent`), which would otherwise
crowd the root namespace (`span`, for one, is already the rich-text helper there).
There are **no** per-component subpaths for users:
ESM named exports plus `sideEffects: false` let bundlers drop everything that isn't
imported, and a CI check (§9.5) enforces that this stays true.

### 3.2 Where the code lives

```
packages/components/                 @framefields/components (internal, bundled into framefields)
  SPEC.md                            this document
  package.json                       private, sideEffects: false
  src/
    index.ts                         named re-exports only: no registries, no top-level calls
    core/
      contract.ts                    defineComponent, ComponentNode, BaseProps, cue helpers
      host.ts                        Host interface (what framefields injects, §3.3)
      timing.ts                      frame math, beats, stagger orders, windows
      theme.ts                       Theme type, defineTheme, built-in themes
      targets.ts                     Target union + resolution to points / rects / signals
      text.ts                        word / line / glyph boxes from measured text
      motion.ts                      enter / exit presets, springs baked to keyframes
      path.ts                        waypoints, Catmull-Rom, arc length, Path3D interop
      draw.ts                        draw-on strokes, hand-drawn wobble + boil
      rng.ts                         seeded PRNG (splitmix32) + hash-by-key
      bake.ts                        per-frame samples → simplified keyframes
    mouse-pointer/
      index.ts                       the factory
      plan.ts                        pure planner: props → timeline (unit tested)
      styles.ts                      the cursor glyph library
      meta.ts                        summary, tags, schema, example
      mouse-pointer.test.ts          planner unit tests against a fake host
    captions/ …                      same shape for every component
packages/framefields/
  src/components/index.ts            binds the host, re-exports every component
  src/components/*.render.test.ts    frame-grid golden tests (real GPU)
```

### 3.3 Layering: the host

framefields bundles every `@framefields/*` package into itself (`noExternal` in
`tsdown.config.ts`). The component package therefore **must not depend on `framefields`**,
or the build graph becomes circular. Components depend only on lower layers
(`@framefields/core`, `@framefields/compositions/program`) and receive everything else
through a small injected **host**:

```ts
// packages/components/src/core/host.ts
export interface Host {
  box(options: Partial<BoxNode>): Animatable<BoxNode>;
  flex(options: Partial<FlexNode>): Animatable<FlexNode>;
  text(content: string, options?: Partial<TextNode>): Animatable<TextNode>;
  shape(type: ShapeType, options?: Partial<ShapeNode>): Animatable<ShapeNode>;
  measure: MeasureFn;                   // FontManager.measure
  fonts(): readonly string[];           // registered families, for error messages
  autoId(prefix: string): string;       // stable ids, like Layer.* ids
}
```

The host grows with the components that need it: effect constructors (motion blur, blur)
arrive with M1 (`MousePointer`, `FocusZoom`), particles with `Confetti`, subject cut-outs
with `Captions`. Each addition is one method here and one line in
`packages/framefields/src/components/host.ts`, which reads `Layer` lazily inside each call
so importing it has no effects.

framefields binds it once per component, as pure top-level expressions that bundlers can
drop:

```ts
// packages/framefields/src/components/index.ts
export const MousePointer = /* @__PURE__ */ bindComponent(mousePointer);
export const Captions = /* @__PURE__ */ bindComponent(captions);
// …
```

`bindComponent` (exported from both paths) is also how users bind components they write
with `defineComponent`.

The root `src/index.ts` adds `export * from "./components/index.js"`, `tsdown.config.ts`
gains the `src/components/index.ts` entry, and `package.json` gains the `./components`
export.

**Types without a type move.** The full `AnimatableNode` type depends on effect, vision and
tensor types that live in framefields, so it can't move down cheaply. Instead the component
package types nodes structurally (`Animatable<T> = T & { animate(...): unknown }`), and
`bindComponent` in framefields restores the real types: a bound component returns
`AnimatableNode<BoxNode> & ComponentExtras<C>`.

**Tests follow the same rule.** The components package runs pure unit tests against a fake
host. Anything that renders lives in `packages/framefields/src/components/` so there is no
`framefields ↔ components` dependency cycle for turbo.

### 3.4 Versioning

`@framefields/components` is internal (`private: true`) and ships inside `framefields`, so
there is one version to reason about. Changesets for component work target `framefields`.

---

## 4. The component contract

### 4.1 Signature

```ts
const node = Component(props);            // → ComponentNode<Cues>
comp.add(node);                           // it is a normal layer
node.animate(LayerAnimation.create().fadeOut(...)) // and behaves like one
node.cues.clicks                          // plus the moments it produced
```

```ts
export type ComponentNode<C extends Cues = Cues> = AnimatableNode<BoxNode> & {
  /** Moments the component produced, in composition-local frames of its parent. */
  readonly cues: C;
  /** The component's own window: first visible frame, last visible frame, length. */
  readonly span: { start: number; end: number; duration: number };
  /** A named sub-node (same objects `customize` receives). */
  part(name: string): AnimatableNode<LayoutNode> | undefined;
};
```

The root is always a `box` (absolute when `x`/`y` are given, otherwise in flow), carrying
`startFrame` = `at` and `durationFrames` = the resolved duration.

### 4.2 Base props (every component)

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | auto | Root id; parts get `<id>-<part>` ids. |
| `at` | `number` | `0` | Start frame (in the parent's local timeline). |
| `duration` | `number` | natural | Override the window. Natural = derived from content (script length, word timings …) + `hold`. |
| `hold` | `number` | per component | Frames the finished state stays on screen before `exit`. |
| `enter` / `exit` | `MotionPreset \| false` | per component | Whole-component entrance / exit (§5.4). |
| `x`, `y`, `width`, `height`, `position` | layout | — | Placement of the root box, same semantics as `Layer.box`. |
| `theme` | `Theme \| Partial<Theme>` | `themes.graphite` | Tokens (§5.2). Partial themes merge over the default. |
| `seed` | `number` | `1` | Every random choice derives from it. |
| `fps` | `number` | `30` | The composition's frame rate. Theme speeds (authored at 30 fps) and real-time inputs scale by it. |
| `customize` | `(parts) => void` | — | Receives every built sub-node before return. |

Rules:

- **All times are integer frames.** Inputs that are naturally in seconds (word timings,
  typing speed in chars/sec) use the `fps` prop; the result is rounded once, in one place
  (`timing.ts`).
- **Props are strict.** Unknown props are an error (a typo like `lable` fails loudly).
- **Structure.** The root box carries placement and the window; a `stage` box inside it
  (absolute at 0, 0, the component's measured size) carries `enter` / `exit`, so preset
  offsets never fight the root's layout, in flow or absolute. Every component reports its
  measured `width` / `height`, which the root takes unless overridden.
- **Natural duration is always computable** without rendering, so `Layer.sequence` and
  `computeDuration()` can size scenes around components.
- **Validation is eager.** Props are parsed with the component's zod schema at call time.
  Errors name the prop, the bad value and the fix (e.g. an unregistered font lists the
  registered ones).

### 4.3 Cues

Cues are plain arrays of integer frames, optionally with data:

```ts
type Cue<D = {}> = { frame: number } & D;
// MousePointer
cues.clicks   // Cue<{ point: [number, number]; target?: string }>[]
cues.presses  // Cue[] ; cues.releases ; cues.arrivals
```

Cue frames are in the **parent's** timeline (they already include `at`), so they can be
used directly as `startFrame` for sibling layers:

```ts
const pointer = MousePointer({ at: 30, path: [...] });
const clicks = pointer.cues.clicks.map((c) =>
  Layer.audio("assets/sfx/click.wav", { startFrame: c.frame, durationFrames: 12 }),
);
comp.add([pointer, ...clicks]);
```

Helpers in `core/contract.ts`: `cueSignal(cues, { decay })` turns cues into a pulse
`Signal` (for `.signal("scale", …)`, particle `rate`, physics impulses), and
`cueKeys(cues, shape)` turns cues into keyframes on another layer.

### 4.4 Parts and `customize`

Each component documents its part names (e.g. MousePointer: `root`, `motion`, `cursor`,
`glyph`, `hover`, `trail`, `label`, `ripples`). `customize` runs after the tree is built and
before cues are frozen. It may add animations or effects, change styling, or add children.
Removing parts is unsupported.

### 4.5 Metadata (agent and docs surface)

```ts
// <component>/meta.ts
export const meta = defineMeta({
  name: "MousePointer",
  summary: "An animated pointer that travels between targets, clicks, drags and hovers.",
  tags: ["pointer", "cursor", "demo", "ui", "interaction"],
  schema: MousePointerProps,           // zod
  parts: ["root", "motion", "cursor", "glyph", "hover", "trail", "label", "ripples"],
  cues: ["clicks", "presses", "releases", "arrivals", "drags"],
  example: `MousePointer({ path: [{ to: [400, 300] }, { to: [900, 520], click: true }] })`,
});
```

`scripts/build-meta.ts` (part of the package build) collects every `<component>/meta.ts`
default export into `dist/components.json`, read by the skills generator and the docs
gallery. A component folder without a `meta.ts`, or two components with one name, fails
the build.

---

## 5. Shared core

Built in milestone M0 (§10). Every Wave 1 component depends on most of it, which is why the
first wave is chosen to exercise all of it.

### 5.1 Timing (`core/timing.ts`)

- `toFrames(sec, fps)`, `toSeconds`, `beats(n, beatFrames)`, `scaleFrames(framesAt30, fps)` → integers, rounded once.
- `staggerOrder(n, order, seed)` for `"forward" | "reverse" | "center" | "edges" | "random"`,
  as `staggerOffsets` / `staggerRanks`.
- `FrameWindow` arithmetic: `frameSpan`, `within`, `cover`, `chain(...)`.
- `quantize(frame, grid)`: optional quantisation for every component's cue-producing
  times (`quantize: beatFrames` base prop on components that schedule events).

### 5.2 Theme (`core/theme.ts`)

```ts
interface Theme {
  color: {
    bg: string; surface: string; raised: string; line: string;
    ink: string; muted: string; accent: string; accent2: string;
    positive: string; negative: string; highlight: string;
  };
  font: { display: string; body: string; mono: string; hand?: string };
  radius: { sm: number; md: number; lg: number; pill: number };
  stroke: { hair: number; base: number; bold: number };
  motion: {
    ease: { enter: string; exit: string; move: string; snap: string };
    speed: { fast: number; base: number; slow: number }; // frames at 30 fps, scaled by fps
  };
  scale: number; // 1 = designed for 1080p; 2 for 4K, 0.5 for 540p
}
```

- `defineTheme(partial)` deep-merges over `themes.graphite`.
- Built-ins: `themes.graphite` (dark neutral), `themes.paper` (light editorial),
  `themes.signal` (high-contrast, saturated accent for social).
- Built-in themes reference the font families `Inter` and `JetBrains Mono`; fonts are
  never bundled. When a theme font isn't registered, the error says which families are.
- Color tokens are validated with `Color.contrast`: `ink` on `surface` must be ≥ 4.5.
- `motion.speed` is defined at 30 fps and rescaled to the composition fps, so a theme feels
  the same at 24, 30 and 60 fps.

### 5.3 Targets (`core/targets.ts`)

```ts
type Target =
  | [x: number, y: number]                                     // a point
  | { x: number; y: number; width: number; height: number }   // a rect
  | { node: AnimatableNode<LayoutNode> | string; anchor?: Anchor }
  | { text: AnimatableNode<TextNode>; match?: string | RegExp; range?: [number, number]; nth?: number }
  | { track: ObjectTrackSignals; anchor?: ObjectAnchorName }   // vision-tracked, moves per frame
  | ((frame: number) => [number, number]);                     // escape hatch
```

Resolution returns either a static `Rect` or a per-frame `RectSignal`. Components that
accept targets must handle both (static targets bake to keyframes; dynamic targets bind
signals).

- **Text targets** use `FontManager.measure(...).glyphs` on the text node's own props to
  return one rect per line the range spans (so an underline under a wrapped phrase becomes
  two strokes).
- **Node targets** need absolute geometry. Nodes with numeric `x`/`y`/`width`/`height`
  resolve directly. Flex children need the layout pass: see open question Q3.
- **Anchor** names: `center`, `top`, `bottom`, `left`, `right`, `top-left` … plus `tip`
  (the point a pointer should land on: centre for buttons, the left edge mid-height for
  text fields).

### 5.4 Motion presets (`core/motion.ts`)

Named entrances/exits used by every component's `enter` / `exit`:
`fade`, `rise`, `drop`, `scale`, `pop` (overshoot), `slide-{left,right,up,down}`,
`tilt` (3D perspective settle), `none`. `blur` (needs the blur effect on the host) and
`mask-{up,down,left,right}` (needs a matte) arrive with `TextReveal` in M2. Each preset accepts `{ duration, ease, distance, delay }` overrides and reads
defaults from `theme.motion`.

Springs are evaluated in closed form and **baked to keyframes** with `bake.ts`
(tolerance-simplified), so the output stays plain JSON and seeks exactly. `core/ease.ts`
evaluates exactly the ease names the keyframe schema accepts (`power1-3`, `sine`, `circ`,
`expo`, `back`, `elastic`, `bounce`, `cubic`, `hold`, `none`/`linear`), so a curve
baked offline matches the same ease keyed directly.

### 5.5 Paths and waypoints (`core/path.ts`)

Carries over the design in the pending `@framefields/components` changeset:
`Waypoint`, `EASE` + `evaluateEase`, `buildPointerPath` (centripetal Catmull-Rom with
per-segment timing), arc-length reparametrisation, `positionOnPathAtFrame`, and interop
with `Path3D` / `LayerAnimation.followPath`.

### 5.6 Strokes and the hand-drawn look (`core/draw.ts`)

- `drawOn(shape, { start, duration, ease })` keyframes `trimEnd` 0 → 1.
- `wobble(d, { amount, seed })`: perturbs a path's points with seeded low-frequency noise.
- `boil({ every, variants, seed })`: pre-computes `variants` wobbled versions of a path and
  keys `d` between them every `every` frames with `hold` interpolation, so a mark "lives"
  like hand-drawn animation, deterministically.
- Path generators: `roughEllipse`, `roughRect`, `underlineStroke`, `squiggle`, `bracket`,
  `arrowPath` (straight / arc / swoop, with a separate head that lands on the tip).

### 5.7 Randomness (`core/rng.ts`)

`rng(seed)` (splitmix32) and `hashRng(seed, key)` so the n-th word of a caption gets the same
random tilt whether or not earlier words change. `Math.random` is banned in the package by
a biome rule.

---

## 6. How the first components were chosen

Each candidate was scored 1–3 on four criteria:

- **Demand:** how often it appears in product demos, launch films, explainers and social
  clips (our examples, user projects, common video formats).
- **Leverage:** how much it gains from what framefields does that others can't: measured
  GPU text, frame-exact timing, effects, particles, physics, vision, 3D.
- **Foundation:** how much shared core it forces us to build properly, which later
  components then reuse.
- **Hard by hand:** how error-prone it is for a person or an agent to get right with raw
  layers (measurement, timing math, sync).

| Candidate | Demand | Leverage | Foundation | Hard by hand | Total | Wave |
|---|---|---|---|---|---|---|
| MousePointer | 3 | 2 | 3 (paths, targets, cues) | 3 | **11** | 1 |
| FocusZoom | 3 | 3 (motion blur, signals) | 2 (bake, targets) | 3 | **11** | 1 |
| Captions | 3 | 3 (vision cut-out, audio pulse) | 3 (text boxes, fps timing) | 3 | **12** | 1 |
| TextReveal | 3 | 3 (GPU glyph animators) | 3 (stagger, text, motion) | 2 | **11** | 1 |
| Counter | 3 | 2 | 2 | 3 | **10** | 1 |
| Annotate | 2 | 2 | 3 (draw, text targets) | 3 | **10** | 1 |
| AppFrame | 3 | 2 | 2 (slots, rects for targets) | 2 | **9** | 1 |
| Terminal | 3 | 2 | 2 (mono measure, scroll) | 3 | **10** | 1 |
| CodeBlock | 3 | 2 | 1 | 3 | 9 | 2 |
| ChatThread | 2 | 2 | 1 | 2 | 7 | 2 |
| Callout | 2 | 3 (tracked objects) | 1 | 2 | 8 | 2 |
| Spotlight | 2 | 2 | 1 | 2 | 7 | 2 |
| Confetti | 2 | 3 (GPU particles, physics) | 1 | 1 | 7 | 2 |
| Meter | 2 | 1 | 1 | 2 | 6 | 2 |
| TitleCard / LowerThird | 3 | 1 | 1 | 1 | 6 | 2 |
| Toasts | 2 | 1 | 1 | 2 | 6 | 2 |

Wave 1 is the eight components with the highest totals. Together they cover the two most
common film types (the **product demo** and the **talking-head / social clip**) end to
end, and they exercise every shared core module.

---

## 7. Wave 1: detailed specifications

Common to all: base props (§4.2), parts, cues, a `meta`, unit tests for the planner and a
frame-grid golden test (§9). Prop tables list only component-specific props.

---

### 7.1 `MousePointer`

An animated pointer that travels between targets, presses, clicks, drags and changes shape
over hover regions. The anchor of every screen-demo film. The detailed design already
exists in the pending changeset `.changeset/components-mouse-pointer.md`; this section
records it as the target and lists what Wave 1 adds.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `path` | `Waypoint[]` \| `Path3D` | required | `Waypoint = { to: Target; at?: number; dwell?: number; click?: boolean \| ClickOptions; press?: number; drag?: Target; hover?: CursorStyle }`. `at` omitted → derived from distance and `speed`. |
| `style` | `CursorStyle` | `"arrow"` | `arrow`, `triangle`, `chevron`, `dot`, `ring`, `target`, `crosshair`, `plus`, `ibeam`, `caret`, `square`, `diamond`, `sparkle`, `hand`. |
| `size` | `number` | `28 × theme.scale` | All styles normalised to one visual size. |
| `color` / `accent` / `outline` | color | theme | Fill, secondary, and outline. |
| `outlineMode` | `"each" \| "union"` | `"union"` | Union dilates the whole silhouette so overlapping parts read as one cursor. |
| `motion` | `"natural" \| "swift" \| "lazy" \| "linear"` | `"natural"` | Travel feel: ease shape, slight overshoot, arc bias. |
| `speed` | `number` | `1400` px/s | Used when `at` is omitted. |
| `drift` | `number \| false` | `2` px | Idle micro-motion while dwelling (seeded). |
| `autoOrient` | `boolean` | `false` | Rotate along travel (for `dot`/`triangle` styles). |
| `trail` | `false \| { length, fade, width }` | `false` | Fading trail. |
| `feedback` | `"press" \| "bounce" \| "pulse" \| false` | `"press"` | Per-click glyph response. |
| `ripple` | `"ring" \| "fill" \| "pulse" \| false` | `"ring"` | Click ripple. |
| `hoverRegions` | `{ target: Target; style: CursorStyle }[]` | `[]` | Style swaps while inside a region, resolved from the motion solution so they are exact. |
| `label` | `string \| { text, color }` | — | **New.** Name tag that rides beside the pointer: AI-agent and multiplayer pointers. |
| `motionBlur` | `boolean \| number` | `false` | **New.** Adds `MotionBlur` on the motion part, strength scaled by speed. |
| `shadow` | `boolean` | `true` | **New.** Soft drop shadow via layer style. |
| `from` / `to` | `"left" \| "right" \| "top" \| "bottom" \| Target` | — | **New.** Enter from / exit to off-frame. |

**Parts:** `root`, `motion`, `cursor`, `glyph`, `hover`, `trail`, `label`, `ripples`.
**Cues:** `arrivals`, `presses`, `releases`, `clicks` (with `point`, `target` id), `drags`
(`{ start, end, from, to }`).

**Implementation notes**

- Planner (`plan.ts`) is pure: waypoints → per-segment windows, positions, press/hover
  intervals, cues. All tests run on the planner.
- Travel is keyframes (baked arc-length samples), never per-frame signals, unless a target
  is dynamic (`track`), in which case the segment binds signals.
- Glyphs are built from `rect` / `circle` / `polygon` / `star` primitives; the classic arrow
  is one `path`.

**Acceptance**

- Click cue frames equal the frames on which the glyph is fully pressed (golden test reads
  the press scale at that frame).
- A pointer whose path visits a `text` target lands on the first glyph's mid-height,
  within 0.5 px of the measured position.
- 14 styles × 3 sizes render in one frame grid without clipping; union outline shows no
  seams at 4× zoom.

---

### 7.2 `FocusZoom`

A virtual camera over 2D content (a screen recording, an `AppFrame`, any layer tree) that
pushes in on what matters and eases back out, the auto-zoom look of polished product
demos. It can follow a `MousePointer` automatically.

```ts
const screen = AppFrame({ kind: "browser", url: "app.acme.dev", content: Layer.video("rec.mp4") });
const pointer = MousePointer({ path: [...] });
comp.add(FocusZoom({ content: [screen, pointer], follow: pointer, maxZoom: 2.2 }));
```

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `content` | `LayoutNode \| LayoutNode[]` | required | What the camera films. Laid out at full size; the camera transforms one wrapper box. |
| `shots` | `Shot[]` | — | Manual: `{ at, target: Target \| "full", zoom?, hold?, ease? }`. |
| `follow` | `ComponentNode<PointerCues>` | — | Auto: derive shots from the pointer's cues (push in `lead` frames before each click cluster, trail the pointer between, release after `idle` frames). |
| `zoom` / `maxZoom` | `number` | `1.8` / `2.5` | Default and ceiling. |
| `lead` | `number` | `theme.motion.speed.base` | Frames the push-in starts before the event. |
| `idle` | `number` | `45` | Frames without events before easing back to full. |
| `smoothing` | `number` | `0.85` | Critically damped follow (0 = rigid, 1 = very loose). |
| `padding` | `number` | `48` | Kept around a target rect when framing it. |
| `clamp` | `boolean` | `true` | Never reveal outside the content bounds. |
| `smear` | `false \| "subtle" \| "standard" \| "heavy"` | `"subtle"` | Motion blur scaled by camera speed. |
| `focus` | `false \| { dim: number; feather: number }` | `false` | Optional dimming outside the framed region. |

**Parts:** `root` (clip box), `camera` (the transformed wrapper), `focus`.
**Cues:** `shots` (`{ start, settled, end, target }`), `pushIns`, `releases`.

**Implementation notes**

- The camera path is solved offline: target rects per frame → desired (scale, tx, ty) →
  damped follow → clamped → **baked to keyframes** with tolerance simplification. Dynamic
  targets fall back to signals.
- Zoom is applied as `scale` + `x`/`y` on the wrapper with `overflow: "hidden"` on the root,
  so text stays vector-sharp (re-rasterised, not upscaled).
- Smear uses `host.effects.motionBlur` with strength bound to the camera's speed.

**Acceptance**

- With `follow`, every click cue happens while the camera is settled (velocity < 1 px/frame)
  and the click point lies inside the central 60 % of the frame.
- `clamp: true`: no frame shows the root background outside the content (golden check on
  corner pixels).
- A 1080p UI zoomed 2.5× has text edges as sharp as the same UI rendered natively at 2.5×
  (SSIM ≥ 0.98 against the reference).

---

### 7.3 `Captions`

Word-timed captions for talking-head and social video, with the styles people actually
publish, exact word highlighting, and options only a GPU compositor with vision can do:
captions tucked behind the speaker, and words that pulse with the voice.

```ts
Captions({
  fps: 30,
  words,                         // [{ text: "Ship", start: 0.42, end: 0.61 }, …] (seconds)
  style: "karaoke",
  emphasis: ["faster", /\d+%/],
  behind: { video: "assets/talk.mp4" },
  pulse: voiceEnvelope,          // Signal from the voice track
});
```

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `fps` | `number` | required | For converting word times. |
| `words` | `Word[]` | required* | `{ text, start, end }` in seconds. *Or `transcript`. |
| `transcript` | `string` | — | SRT, WebVTT, or word-level JSON (`{ word \| text, start, end }[]`). Cue-level formats are split into words with times distributed by measured width. |
| `style` | `CaptionStyle` | `"karaoke"` | See below. |
| `group` | `{ maxChars?, maxWords?, maxLines?, breakOnPunctuation?, minGap? }` | `{ maxChars: 28, maxLines: 2 }` | Phrase builder; never splits mid-word; prefers punctuation and pauses ≥ `minGap` s. |
| `emphasis` | `(string \| RegExp)[] \| ((word, i) => boolean)` | `[]` | Emphasised words get `theme.color.accent`, a weight or size bump per style. |
| `case` | `"as-is" \| "upper" \| "lower"` | `"as-is"` | |
| `placement` | `{ anchor: "bottom" \| "center" \| "top"; safeArea?: "portrait" \| "landscape" \| Rect; offset? }` | `bottom`, auto safe area | Portrait safe area keeps clear of platform UI overlays. |
| `avoid` | `Target[]` | `[]` | Move a phrase up/down when it would overlap a target, e.g. a tracked face. |
| `behind` | `{ video: string; mode?: "person" \| "subject" }` | — | Renders a vision cut-out of the clip **above** the captions, so text passes behind the speaker. |
| `pulse` | `Signal \| false` | `false` | Active word scale = `1 + pulse × 0.08`. |
| `font`, `fontSize`, `weight` | text props | theme `display`, auto | `fontSize` auto-fits the safe-area width at `maxChars`. |

**Styles (`CaptionStyle`)**

| Style | Look |
|---|---|
| `clean` | Broadcast subtitles: phrase fades in, no per-word animation, optional backing plate. |
| `karaoke` | Whole phrase visible in `muted`; each word fills with `ink` as it is spoken. |
| `highlight` | A rounded marker slides behind the active word and resizes to it. |
| `pop` | Words appear as they are spoken with a small overshoot scale. |
| `bold` | One or two words at a time, very large and centred, alternating entrance directions. |
| `outline` | Heavy stroked type (stroke via layer style), active word in accent. |
| `pill` | Phrase on a pill plate; active word gets an inner accent pill. |
| `gradient` | Active word filled with an accent gradient; others in `ink`. |

**Implementation notes**

- **No node per word for colour changes.** Each phrase is two text layers (base colour and
  active colour); the active layer is matted by per-word rects measured with
  `FontManager.measure(...).glyphs`, keyed open at each word's start frame. This is exact,
  cheap, and keeps kerning identical between the two layers.
- Phrase layout is measured once; `highlight` and `pill` plates are shapes keyed between
  word rects.
- `behind` uses `host.cutout(video, { mode: "matte" })` stacked above the caption layers.
- Phrase builder, transcript parsers and auto font sizing are pure and unit tested.

**Cues:** `words` (`{ frame, end, index, text, emphasised }`), `phrases`
(`{ start, end, text }`).

**Acceptance**

- The active-colour edge for a word appears on `round(word.start × fps)` exactly
  (frame-grid test on a synthetic 3-word transcript).
- Two-line phrases never exceed the safe area at any `fontSize` produced by auto-fit.
- With `behind`, pixels inside the person matte show the person, not the text (golden).
- SRT, VTT and word-JSON fixtures produce the same phrases for the same content.

---

### 7.4 `TextReveal`

Headline and body text that animates in (and optionally out) by character, word or line.
One component, one timing model, many looks.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `text` | `string \| TextSpan[]` | required | Rich spans supported (`rich`, `accent`, `bold` …). |
| `style` | `RevealStyle` | `"rise"` | See below. |
| `by` | `"char" \| "word" \| "line"` | per style | Unit of animation. |
| `stagger` | `number` | per style | Frames between units. |
| `order` | `"forward" \| "reverse" \| "center" \| "edges" \| "random"` | `"forward"` | `random` uses `seed`. |
| `unitDuration` | `number` | `theme.motion.speed.base` | Frames for one unit's move. |
| `exitStyle` | `RevealStyle \| false` | `false` | Plays mirrored after `hold`. |
| text props | `fontFamily`, `fontSize`, `fontWeight`, `fill`, `align`, `lineHeight`, `letterSpacing`, `width`, `direction` | theme | Passed to the underlying text node(s). RTL respected. |

**Styles (`RevealStyle`)**

| Style | What happens | Engine |
|---|---|---|
| `rise` | Units lift from below with a fade | `TextAnimator` |
| `blur` | Units resolve from blur and slight scale | `TextAnimator` |
| `track` | Letter-spacing closes in from wide | `letterSpacing` keys |
| `mask` | Each line slides up through its own line box | per-line text + matte |
| `slam` | Units scale down into place with a short landing shake | `TextAnimator` + root keys |
| `scatter` | Glyphs gather from seeded scattered positions/rotations | `TextAnimator` + seeded offsets |
| `scramble` | Each character cycles seeded glyphs, then locks, left to right | per-char glyph reels (see notes) |
| `type` | Typewriter with a blinking caret, seeded human rhythm | `typewriter` + caret shape at `caretX` |
| `stream` | Words arrive in uneven bursts and ink from `muted` to `ink` | `TextAnimator` colour + seeded burst timing |
| `wipe` | A soft feathered front crosses the line with a trailing blur | gradient matte + blur |
| `flip` | Units rotate in around X in 3D | `TextAnimator.flip3D` |

**Implementation notes**

- Prefer GPU glyph animators (`TextAnimator`) over splitting text into nodes. Split only
  where a style needs per-unit geometry (`mask`, `scramble`).
- `scramble` needs no content keyframes: each character is a masked vertical **reel** of
  seeded glyphs moved with `stepped(2)` and landing on the real glyph, all widths fixed to
  the final glyph's advance so the line never jitters.
- `type` and `stream` place the caret from `measure().caretX(i)`, so the caret sits exactly
  after the last revealed glyph in any font.

**Cues:** `units` (`{ frame, settled, index, text }`), `revealed`, `exitStart`, and for
`type`/`stream`: `keystrokes`.

**Acceptance**

- Every style renders the final frame pixel-identical to a static `Layer.text` with the
  same props (the reveal never leaves residue or kerning changes).
- `scramble` with the same seed produces identical frames across runs; a different seed
  changes intermediate frames only.
- Arabic text with `by: "word"` reveals right to left.

---

### 7.5 `Counter`

Numbers that change in a way viewers trust: odometer reels, smooth counts, prices,
percentages, scoreboards.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `from` / `to` | `number` | `0` / required | Or `values`. |
| `values` | `[frame: number, value: number, ease?: string][]` | — | Multi-step counts (e.g. 0 → 120 → 87). |
| `format` | `string \| Intl.NumberFormatOptions \| ((n) => string)` | `",d"` | d3-format strings, same as `Layer.chart` axes. |
| `prefix` / `suffix` | `string \| TextSpan[]` | — | Styled separately (e.g. smaller `%`). |
| `style` | `"roll" \| "count" \| "flip"` | `"roll"` | `roll` = per-digit reels; `count` = plain digits; `flip` = split-flap (Wave 2). |
| `duration`, `ease` | | `speed.slow × 2`, `theme.motion.ease.move` | |
| `digitStagger` | `number` | `2` | Higher places settle later (roll only). |
| `motionBlur` | `boolean` | `true` (roll) | Vertical blur on fast reels. |
| `signal` | `Signal` | — | Drive the value live from audio, physics or data. |
| `tabular` | `boolean` | `true` | Fixed digit advance (max measured digit width) so nothing shifts. |
| text props | | theme `display` | |

**Implementation notes**

- `roll`: one masked reel per digit position (0–9 stacked, repeated for multi-turn spins);
  the reel `y` is keyed from the value trajectory so a digit spins `floor(Δ / 10^place)`
  full turns plus the remainder, the way a mechanical counter does.
- Growing digit counts (`999 → 1,000`) animate the width and slide new places in from the
  left; separators are placed by the formatter, not hard-coded.
- `count`: a single text node whose content is keyed per frame with hold interpolation.
  Depends on Q2; falls back to `roll` with zero blur until then.

**Cues:** `settled`, `milestones` (crossings of `milestoneEvery` units, e.g. for tick
sounds).

**Acceptance**

- Final frame equals a static `Layer.text(format(to))` pixel for pixel.
- `0 → 1,000,000` over 60 frames never shows an intermediate frame wider than the final
  width.
- `values` with a decrease (`120 → 87`) spins reels downward.

---

### 7.6 `Annotate`

Marks that draw on to point at something: underline a word, circle a number, strike a
claim, box a region, draw an arrow. Clean geometric or hand-drawn.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `target` | `Target` | required | Text ranges produce one mark per line. |
| `mark` | `"underline" \| "circle" \| "box" \| "highlight" \| "strike" \| "cross" \| "bracket" \| "arrow" \| "squiggle"` | `"underline"` | |
| `from` | `Target` | — | Arrow start (arrows point *to* `target`). |
| `curve` | `"straight" \| "arc" \| "swoop"` | `"arc"` | Arrows and connectors. |
| `color`, `width` | | `theme.color.highlight`, `theme.stroke.bold` | |
| `hand` | `false \| { wobble?: number; boil?: number; seed? }` | `{ wobble: 0.6, boil: 4 }` | `boil` = frames between re-poses; `0` = still. |
| `texture` | `"ink" \| "marker" \| "pencil"` | `"marker"` | Marker = round caps + multiply blend; pencil = thin, grainy (FilmGrain-masked). |
| `drawDuration` | `number` | `speed.base` | |
| `label` | `string \| { text; side?; font? }` | — | Note placed beside the mark with a short connector; font defaults to `theme.font.hand` then `body`. |
| `padding` | `number` | `8` | Space between target and mark. |

**Implementation notes**

- Every mark is a `Layer.shape("path")` with `trimEnd` keyed for the draw-on; highlight is a
  filled swash path behind the text (inserted as a sibling below the target).
- Hand-drawn = `wobble` once + `boil` variants keyed on `d` with hold interpolation (shape
  morphing already supports differing point counts).
- Arrow heads are separate paths that appear when the shaft's trim reaches 92 %, with a
  small stretch-and-settle.

**Cues:** `drawn` (mark complete), `labelIn`.

**Acceptance**

- Underline on a phrase that wraps to two lines produces two strokes aligned to each
  line's baseline + `padding` (± 0.5 px).
- `boil: 4` changes the path exactly every 4 frames and repeats with the same seed.

---

### 7.7 `AppFrame`

Window chrome around any content: the container for UI recordings and mock interfaces, and
the coordinate system other components target.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `kind` | `"window" \| "browser" \| "terminal" \| "minimal"` | `"window"` | Traffic-light window, browser with URL bar and tabs, terminal title bar, or bare rounded frame. |
| `content` | `LayoutNode \| LayoutNode[] \| string` | required | A string is treated as a media path (`Layer.video`/`image` by extension). |
| `fit` | `"cover" \| "contain" \| "fill"` | `"cover"` | For media content. |
| `title` | `string` | — | |
| `url` | `string \| { text; typeAt?: number }` | — | Browser: optionally types the URL and plays a load bar. |
| `tabs` | `string[]` | — | Browser tabs; the first is active. |
| `appearance` | `"dark" \| "light"` | from theme | |
| `elevation` | `0–3` | `2` | Shadow depth via layer style. |
| `tilt` | `false \| { rotateX, rotateY }` | `false` | 3D presentation angle (perspective root). |

**API additions on the returned node:** `contentRect` (absolute rect of the content slot)
and `at(x, y)` (maps content-local coordinates to composition coordinates), so pointers and
zooms can target positions inside a recording: `MousePointer({ path: [{ to: frame.at(812, 140) }] })`.

**Parts:** `root`, `chrome`, `titlebar`, `controls`, `urlbar`, `tabs`, `content`, `shadow`.
**Cues:** `urlTyped`, `loaded`.

**Acceptance**

- `contentRect` matches the rendered content bounds exactly at every `kind`.
- Light and dark appearances pass `comp.lint()` contrast checks.

---

### 7.8 `Terminal`

A scripted shell session: commands typed with a human rhythm, output streaming in,
spinners resolving, the view scrolling, all on cue. The default terminal look is built in;
`frame: true` wraps it in `AppFrame({ kind: "terminal" })`.

```ts
Terminal({
  script: [
    { cmd: "pnpm add framefields" },
    { spinner: "Resolving packages", for: 40, done: "✔ 1 package added" },
    { cmd: "pnpm render", output: ["Rendering 900 frames…", "{green}✔{/} out/film.mp4 (12.4 s)"] },
  ],
  rows: 14,
});
```

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `script` | `Step[]` | required | `Step = { cmd } \| { output } \| { spinner; for; done? } \| { progress: label; for } \| { pause } \| { clear: true }`. |
| `prompt` | `string \| TextSpan[]` | `"❯ "` | Per-step override allowed. |
| `cps` | `number` | `18` | Typing speed (chars/sec), seeded jitter ±30 %, pauses after spaces and punctuation. |
| `outputRate` | `number \| "instant"` | `40` lines/sec | |
| `rows` / `cols` | `number` | `16` / auto | Viewport; overflow auto-scrolls. |
| `fps` | `number` | required | For `cps` / `outputRate`. |
| `markup` | `boolean` | `true` | `{green}…{/}`-style colour markup mapped to a 16-colour palette from theme. |
| `frame` | `boolean \| AppFrameProps` | `true` | |
| `caret` | `"block" \| "bar" \| "underline"` | `"block"` | Blinks while idle, solid while typing. |

**Implementation notes**

- One text node per visible line; a line's content is final and its reveal uses
  `typewriter` keys; scrolling animates the line container's `y` by whole line heights.
- Caret position from `measure().caretX`; mono advance validated (warn when the font isn't
  monospaced).
- Spinners are a single glyph slot keyed through braille frames with `hold` interpolation.

**Cues:** `keystrokes` (per typed character, for typing sounds), `submits` (Enter per
command), `outputs` (`{ start, end, step }`), `done`.

**Acceptance**

- Same script + seed → identical keystroke cues and frames.
- Scrolling never cuts a line in half at rest; during scroll, lines leave through the
  viewport mask.
- 200-line output with `rows: 16` keeps ≤ 18 text nodes visible on any frame.

---

## 8. Waves 2 and 3

Specified at summary level now; each gets a full section (like §7) before its milestone
starts.

### 8.1 Wave 2

| Component | Summary | Key props | Notable framefields use |
|---|---|---|---|
| `CodeBlock` | Syntax-highlighted code with line focus, typing, and diffs that move unchanged lines to their new places. | `code`, `lang`, `tokens?` (bring your own highlighter), `focus: [lines]`, `diff: { to, at }`, `typing` | Measured mono layout; lines keyed between positions so diffs read as motion. Ships a small built-in tokenizer for ts/js/json/bash/python/css; anything else via `tokens`. |
| `ChatThread` | A messaging conversation: bubbles from either side, typing indicator, reactions, timestamps, auto-scroll. | `messages: { from, text \| media, at? }[]`, `participants`, `appearance` | Bubble sizes from measured text; spring entries baked; typing dots between messages. |
| `Callout` | A label with a leader line pinned to a point or a moving tracked object; stays inside the frame. | `target`, `text`, `side: "auto" \| …`, `elbow` | Dynamic targets bind to vision `track` signals; auto side picks the free quadrant per frame. |
| `Spotlight` | Dims the frame except a feathered region that glides between targets. | `targets: { at, target }[]`, `dim`, `feather`, `shape` | Inverted alpha matte + blur; region keyed between target rects. |
| `Confetti` | Celebration bursts with paper, ribbons and sparkles that fall and settle. | `bursts: { at, origin, count }[]`, `palette`, `gravity`, `floor` | GPU particles; optional physics floor; bursts can come straight from `cues`. |
| `Meter` | Progress and score visuals: ring, bar, arc gauge, star rating, each with an optional `Counter`. | `value`, `max`, `kind`, `segments`, `label` | Conic gradients, `trimEnd` arcs, fractional star fill via matte. |
| `TitleCard` | Kicker, headline, rule and sub-line in tested layouts (`center`, `left`, `split`, `stack`). | `kicker`, `title`, `subtitle`, `layout` | Built from `TextReveal` + `Annotate` (rule) for consistent motion. |
| `LowerThird` | Name and role bar for interviews and talks, several layouts, safe-area aware. | `name`, `role`, `layout`, `side` | Measured plate width; enter/exit presets. |
| `Toasts` | Notifications arriving into a stack that pushes down and compresses as it grows. | `items: { at, title, body, icon? }[]`, `max`, `corner` | Stack layout solved offline; spring settle baked. |

### 8.2 Wave 3 candidates

`TouchPoint` (mobile taps, long-presses and swipes) · `Selection` (marquee and text
selection driven by a `MousePointer`) · `WordCycle` (one slot in a sentence cycles through
alternatives while the rest reflows) · `DeviceFrame` (phone, tablet, laptop bezels with a
screen slot; 2D and 3D) · `Backdrop` (mesh gradient, grid, dot field, grain; loop-exact) ·
`BeforeAfter` (split view with a draggable divider) · `CardStack` (depth-stacked cards that
shuffle forward) · `LogoReveal` (extruded / glass / chrome wordmark reveal on `Layer3D`) ·
`LayerDiagram` (exploded 3D plates with labels for architecture explainers) · `Avatars`
(overlapping avatar group with count) · `SocialPost` (post / follow card mock-ups).

Wave 3 is re-scored with the §6 criteria after Wave 2 ships, using what users actually
ask for.

---

## 9. Quality bar

A component is **done** when all of the following pass in CI.

### 9.1 Unit tests (components package, fake host)

Planners, parsers, phrase builders, path math, stagger orders, bake simplification. No
GPU. Target ≥ 90 % line coverage on `core/` and every `plan.ts`.

### 9.2 Render tests (framefields package, real GPU)

`packages/framefields/src/components/<name>.render.test.ts` renders a `renderFrameGrid` of
the canonical example and compares to a committed golden with the existing tolerance
helpers. Every acceptance criterion in §7 that mentions a frame is a test here.

### 9.3 Determinism

Each render test also renders its frames in reverse order and in a shuffled order, and
asserts identical output. Each component with randomness renders twice with the same seed
(identical) and once with another seed (different).

### 9.4 Plain data

`JSON.parse(JSON.stringify(component))` validates against the program schema
(`builder-schema-conformance` style), and `comp.lint()` reports nothing for the canonical
example under every built-in theme.

### 9.5 Tree-shaking

`packages/framefields/scripts/check-components-treeshake.mjs` runs at the end of the
framefields build. It bundles the built `dist` with esbuild the way a user's bundler would,
on top of a baseline that already imports `Layer` (every project does; the framefields
root's own top-level code is outside this check), and for each case asserts:

- no marker string survives from a module the import must not pull (contract, strokes,
  targets, motion …), and
- the bytes added over the baseline stay inside a budget.

Each new component adds a case importing only itself, with every other component's marker
forbidden.

### 9.6 Budgets

| Component | Max nodes on any frame (canonical example) | Max build time |
|---|---|---|
| MousePointer | 24 | 20 ms |
| FocusZoom | content + 3 | 50 ms (500-frame solve) |
| Captions | 6 per visible phrase | 30 ms per minute of speech |
| TextReveal | 4 + 2 per line (`mask`, `scramble`: + 1 per char) | 10 ms |
| Counter | 3 + 1 per digit | 5 ms |
| Annotate | 4 per line of target | 5 ms |
| AppFrame | 14 + content | 5 ms |
| Terminal | rows + 6 | 20 ms |

### 9.7 Docs and skills

- Docs page per component: summary, live gallery stills, props table generated from the
  schema, parts, cues, recipes.
- `plugins/framefields/skills/framefields-compose/SKILL.md` gains a **Components** section
  (a table generated from `components.json` plus the cue-sync pattern). The skill-md check
  test keeps it in sync.
- One example film per milestone (§10) under `examples/`.

---

## 10. Delivery plan

Each milestone ends with a changeset for `framefields` (minor), docs, and its example film.

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 · Foundations** ✅ | Package scaffold; host binding in framefields (`./components` export, root re-exports, tsdown entry, `bindComponent`); `core/*` modules (§5); test harness (fake host, GPU render test, determinism); tree-shake check; `components.json` collector. | Done: a test-only `Probe` component passes §9.1–9.5 (§12). |
| **M1 · Pointer & camera** | `MousePointer` (rebuilt to the existing changeset design plus the Wave 1 additions), `FocusZoom`, `AppFrame`. | Example `30_product_demo`: a screen recording in a browser frame, pointer with clicks and auto-zoom, click SFX placed from cues. |
| **M2 · Type** | `TextReveal`, `Counter`, `Annotate`. | Example `31_type_and_numbers`: every reveal style, counters, annotations on wrapped text; all §7.4–7.6 acceptance tests green. |
| **M3 · Speech & shell** | `Captions` (incl. transcript parsers and `behind`), `Terminal`. | Example `32_talking_head_social` (portrait, captions behind the speaker, audio pulse) and a terminal segment in a dev-tool launch cut. |
| **M4 · Wave 2a** | `CodeBlock`, `TitleCard`, `LowerThird`, `Meter`. | Full specs written first (§8 → §7 format). |
| **M5 · Wave 2b** | `ChatThread`, `Callout`, `Spotlight`, `Confetti`, `Toasts`. | As above. |
| **M6 · Re-score** | Rank Wave 3 against usage and requests. | Updated §8.2. |

Housekeeping before M1: `.changeset/components-mouse-pointer.md` and the
`packages/components` lockfile entry describe a package that is not on disk. Either restore
that implementation as the M1 starting point or retarget the changeset to `framefields`
when M1 lands.

---

## 11. Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Root re-export or `framefields/components` only? | **Decided (M0):** components and user-facing types at the root, full toolkit at the subpath (§3.1). |
| Q2 | Is text `content` keyframeable with hold interpolation? | **Answered:** yes, `text` is an animatable prop (`.keys("text", …)`, which `FontManager.measure().caretX` is documented to pair with). `Counter` `count` style and `TextReveal` `type` / `stream` use it directly. |
| Q3 | Node targets inside flex layouts need resolved geometry at build time. | **Partly answered:** `computeLayoutSync(yoga, { layout, viewport, measure })` already exists in `@framefields/compositions/program`. M1 adds a `host.layout(root)` backed by it; until then node targets require absolute nodes and the error says so. |
| Q4 | PascalCase factories vs. a namespace? | **Decided:** PascalCase named exports. A namespace object defeats tree-shaking. |
| Q5 | Should built-in themes ship fonts? | **Decided:** no. Fonts stay user-registered. |
| Q6 | Seconds vs. frames for user-facing times. | **Decided:** frames everywhere; `fps` base prop for real-world inputs and theme speeds. |
| Q7 | Per-component deep import paths for users? | **Decided:** no, unless the §9.5 check ever fails. |
| Q8 | The framefields root chunk keeps ~1 MB of top-level code for any import. | Outside components; worth a separate pass over framefields' module-level side effects (schemas, registries) if browser bundle size starts to matter. |

## 12. M0 delivery notes

What landed:

- `packages/components`: `core/` (rng, ease, timing, theme, bake, motion, path, draw,
  text, targets, host, contract, meta), 50 unit tests on a fake host
  (`src/test/fake-host.ts`, fixed-advance text measurement) including package rules
  (no `Math.random` / clock reads; `index.ts` is re-exports only), and the meta collector.
- `packages/framefields`: `src/components/host.ts`, `src/components/index.ts`
  (`bindComponent`, toolkit re-exports), the `./components` export and tsdown entry, root
  re-exports, the tree-shake check, and `contract.render.test.ts` (GPU): enter motion,
  in-flow placement, frame-exact cues for siblings, schema + lint, and identical pixels in
  any frame order.

Deviations from the original plan, all reflected above: no `AnimatableNode` type move
(§3.3), a narrower root export (§3.1), an added `fps` base prop (§4.2), `blur` / `mask`
presets moved to M2 (§5.4), and a baseline-relative tree-shake check (§9.5). The probe
component lives in tests only, so there was nothing to delete.
