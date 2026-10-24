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
`tilt` (3D perspective settle), `none`, and (M2) `mask-{up,down,left,right}`: the stage
slides its full width or height through the root, which clips (`overflow: hidden`), with no
fade. A `blur` preset is deferred: framefields' blur is an effect driven by signals, not a
keyable node prop; `TextReveal` `blur` covers text. Each preset accepts `{ duration, ease, distance, delay }` overrides and reads
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
| `pulse` | `AudioLevels \| false` | `false` | The voice's levels (§7.15, analysed from the same track the timings come from): the active word swells with the voice, scale `1 + level × pulseAmount` (default 0.12). Level frame 0 is the component's first frame. (M7; was a `Signal`.) |
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

### 7.9 `CodeBlock`

Code on screen that reads like an editor and moves like an explanation: syntax colours,
typing, a focus band that walks the lines being discussed, and diffs where unchanged
lines glide to their new places while removed lines fold away and new ones arrive.

```ts
CodeBlock({
  code: before,
  lang: "ts",
  typing: { cps: 30 },
  focus: [{ at: 90, lines: { from: 3, to: 5 } }, { at: 150, lines: [8] }],
  diff: { to: after, at: 210 },
  frame: { title: "render.ts" },
});
```

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `code` | `string` | required | Tabs expand to `tabSize` spaces. |
| `lang` | `"ts" \| "js" \| "json" \| "bash" \| "python" \| "css" \| "plain"` | `"ts"` | Built-in tokenizer. |
| `tokens` | `Array<Array<{ text; kind?; color? }>>` | — | One array per line: bring your own highlighter (shiki, prism …). Overrides `lang`. |
| `typing` | `boolean \| { cps?, at? }` | `false` | Types the code line by line, seeded rhythm, caret. |
| `focus` | `{ at; lines: number[] \| { from, to } }[]` | `[]` | 1-based lines. Other lines dim; a band glides to the focused lines. `lines: []` clears. |
| `diff` | `{ to: string; at: number; duration? }` | — | Line diff (LCS): kept lines move, removed lines fade with a red wash, added lines slide in with a green wash. |
| `lineNumbers` | `boolean` | `true` | Renumbered across a diff. |
| `tabSize` | `number` | `2` | |
| `frame` | `boolean \| { title? }` | `false` | `true` wraps it in an `AppFrame` window; otherwise a rounded surface plate. |
| text props | `fontFamily`, `fontSize` | theme `mono`, 24 × scale | Line height 1.5. |

**Token colours** come from the theme: keyword `accent2`, string `positive`, number
`highlight`, comment `muted`, function `accent`, type a cyan, punctuation and operators a
dimmed ink, everything else `ink`.

**Implementation notes**

- One text node per line with coloured spans; line numbers are their own right-aligned
  nodes. The block's size is fixed up front from the longest line and the larger line count
  (before and after a diff), so nothing reflows.
- Typing keys each line's reveal count with `core/typing.ts` rhythm; a line appears when
  its first key lands.
- Focus dims with per-line opacity keys; the band is a box keyed between line spans.
- Diff matching is a longest common subsequence on trimmed line text, so re-indented
  lines count as kept and glide (their text swaps in the same frame they start moving).

**Cues:** `keystrokes` (`{ frame, line }`), `lines` (each line's first frame), `focus`
(`{ frame, lines }`), `diff` (`{ frame, end }`).

**Acceptance**

- Every token of the built-in tokenizer fixtures gets the expected kind (unit tests per lang).
- After a diff settles, the frame equals a `CodeBlock` of `to` with no diff (render test).
- Kept lines are on screen in every frame of the diff (they move, never blink).

---

### 7.10 `TitleCard`

Kicker, headline, rule and sub-line in layouts that are designed, not assembled: the
headline reveals with `TextReveal`, the kicker tracks in, the rule draws, the sub-line
rises, on one shared timeline.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | `string` | required | `\n` for a forced break. |
| `kicker`, `subtitle` | `string` | — | Kicker is upper-case, tracked, accent coloured. |
| `layout` | `"center" \| "left" \| "stack" \| "split"` | `"center"` | `stack`: left-aligned with a vertical accent bar. `split`: headline left, kicker and sub-line right of a vertical rule. |
| `reveal` | `RevealStyle` | `"rise"` | Headline style (any `TextReveal` style). |
| `emphasis` | `(string \| RegExp)[]` | `[]` | Headline words in the accent colour. |
| `rule` | `boolean` | `true` | |
| `exitStyle` | `ExitStyle \| false` | `false` | Headline exit; kicker, rule and sub-line fade with it. |
| `width` | `number` | `1600 × scale` | Headline wraps inside it. |
| `titleSize`, `fontFamily` | | `120 × scale`, theme `display` | Kicker and sub-line scale from `titleSize`. |

**Cues:** `revealed` (headline at rest), `settled` (every part at rest), `exitStart`.

**Acceptance**

- The settled frame is identical in any render order; each layout keeps every part inside
  `width` (unit test on the measured geometry).

---

### 7.11 `LowerThird`

The name-and-role bar of interviews and talks. Safe-area aware, measured to its text, and
it leaves on its own after `hold`.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `name` | `string` | required | |
| `role` | `string` | — | |
| `layout` | `"bar" \| "stacked" \| "tag" \| "line"` | `"bar"` | `bar`: plate with an accent edge; `stacked`: name plate over a smaller accent role plate; `tag`: one pill, name · role; `line`: no plate, an accent line draws up beside the text. |
| `side` | `"left" \| "right"` | `"left"` | |
| `safeArea` | `"landscape" \| "portrait" \| Rect` | from the frame's aspect | Placed at the safe area's bottom corner. |
| `stay` | `boolean` | `false` | Stay on screen instead of leaving after `hold`. |
| `accent`, `plate` | colours | theme `accent`, `surface` | |
| `nameSize` | `number` | `44 × scale` | Role is 0.62 × that. |

Root covers the frame (`width` / `height`, default 1920 × 1080 × scale) from 0, 0.
Default `hold`: 3 seconds.

**Cues:** `in` (fully on screen), `out` (starts leaving; empty with `stay`).

**Acceptance**

- The plate is exactly the measured text width plus padding for any name (unit test).
- With `side: "right"`, the plate's right edge sits on the safe area's right edge.

---

### 7.12 `Meter`

Progress and scores: a ring, an arc gauge, a bar, lit segments or a star rating, filling
on the same value timeline as an optional `Counter`.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` / `values` | `number` / `[frame, value, ease?][]` | required | Like `Counter`. |
| `from`, `max` | `number` | `0`, `100` (`5` for stars) | |
| `kind` | `"ring" \| "arc" \| "bar" \| "segments" \| "stars"` | `"ring"` | |
| `segments` | `number` | `10` (stars: `max`) | Cells for `segments`, stars for `stars`. |
| `size` | `number` | ring / arc 260, bar 640, segments 640, stars 300 (× scale) | Width (bar, segments, stars) or diameter. |
| `thickness` | `number` | per kind | |
| `counter` | `boolean` | `true` (not for stars) | A `Counter` in the middle (ring, arc) or beside (bar, segments). |
| `format`, `suffix` | as `Counter` | `",d"`, `"%"` when `max` is 100 | |
| `label` | `string` | — | Small caption under (ring, arc) or above (bar). |
| `color`, `track` | colours | theme `accent`, `line` | |
| `countDuration`, `ease` | | as `Counter` | Fill and number share them exactly. |

**Implementation notes**

- Ring and arc fills are stroked arc paths with `trimEnd` keyed on the value timeline;
  the arc spans 240° with round caps. Bars key their fill width.
- Segments light up (colour and a small pop) on the frame the value crosses each cell.
- Stars are clipped boxes over filled star shapes, so fractional ratings fill a star partway.

**Cues:** `settled`, `crossings` (`{ frame, segment }` for segments and stars).

**Acceptance**

- The fill fraction equals `(value − from) / (max − from)` at every key frame (unit test on
  the keys), and the counter shows the same value on those frames.
- 3.5 stars fill exactly three stars and half of the fourth (render test).

---

### 7.13 `LogoReveal`

The end-card lockup: a mark and a wordmark arriving as one designed move, with a glint
on the name once it lands. The mark is an image or SVG file, or path data (which can draw
itself on); the name is live text, flat or extruded in 3D.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `mark` | `string \| { d: string; viewBox: [w, h]; color? }` | — | A file (image or `.svg`) or path data in its own viewBox, scaled to `markSize`. |
| `name` | `string` | — | One line. At least one of `mark` / `name`. |
| `tagline` | `string` | — | Muted line under the name, rises in after it. |
| `layout` | `"row" \| "stack"` | `"row"` | `row`: mark left of the name; `stack`: mark centred above. |
| `style` | `"slide" \| "pop" \| "draw" \| "rise"` | `"slide"` | See below. |
| `glint` | `boolean` | `true` | A light sweeps across the name's letters once the lockup lands, and the mark bumps. |
| `depth` | `number` | `0` | Above 0 the name is extruded text that deep (px), swinging in on its Y axis. |
| `material` | `"lit" \| "chrome" \| "glass"` | `"lit"` | Surface of extruded names. |
| `markSize`, `nameSize`, `gap` | `number` | `150`, `120`, `0.32 × nameSize` (× scale) | |
| `color`, `accent` | colours | theme `ink`, `accent` | Name colour; path-mark colour and glint tint. |
| `fontFamily`, `fontWeight` | | theme `display`, `800` | |

**Styles**

| Style | Move |
|---|---|
| `slide` | The mark pops in at the lockup's centre, then glides to its place while the name wipes out from behind it (the name sits in a clip that opens with the glide). |
| `pop` | The mark springs in with overshoot; the name's letters rise in after it, staggered. |
| `draw` | Path marks draw their outline on, then fill; the name's letters rise in. Image marks fall back to `pop`. |
| `rise` | Mark, name and tagline rise through masks, staggered. |

Extruded names (`depth > 0`) always swing in (rotate Y −70° → 0 on a spring) whatever the
style, and skip the letter glint: glyph animators don't reach meshes. Lighting is the
scene's: add lights to the composition for shaded extrusions.

**Cues:** `hit` (the mark lands), `revealed` (the lockup is complete), `glint`.

**Acceptance**

- The lockup is centred in its measured box for both layouts, in every style (unit test
  on the settled geometry).
- `slide`: no letter of the name is visible before the mark starts gliding (render test).
- A path mark's settled frame is identical in `draw` and `pop` (render test).

---

### 7.14 `Backdrop`

The surface behind everything: a drifting mesh gradient, a grid or a dot field, with a
vignette and film grain, looping exactly so it can sit under any length of scene.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `kind` | `"mesh" \| "grid" \| "dots" \| "solid"` | `"mesh"` | |
| `colors` | `string[]` | theme `accent`, `accent2`, `highlight` | Mesh blob colours; grid / dot colour is the first. |
| `background` | colour | theme `bg` | |
| `loop` | `number` | `10 s` | Every motion is periodic in `loop`: frame `f` equals frame `f + loop`. |
| `speed` | `number` | `1` | Scales drift amplitude, not the period (the loop stays exact). |
| `cell` | `number` | `64 × scale` | Grid cell / dot pitch. |
| `intensity` | `number` | `1` | Mesh blob opacity; line / dot opacity scale. |
| `glow` | `boolean` | `true` (grid, dots) | A soft light drifting over the pattern. |
| `vignette` | `number` | `0.45` | Edge darkening, 0–1. |
| `grain` | `number \| false` | `0.35` | Film grain strength, 0–1. |

Root covers the frame (`width` / `height`, default 1920 × 1080 × scale) from 0, 0 and
clips. Open-ended: it lasts as long as its parent; motion is keyed for `duration` when
given, otherwise for 60 s, in whole loops.

**Implementation notes**

- Mesh blobs are large radial-gradient boxes on Lissajous orbits (x at 1, y at 2 cycles
  per loop, seeded phases); keys sit on each axis's extremes with `sine.inOut`, which is
  an exact cosine (the pieces at the loop seam are `sine.out` / `sine.in`, close but not
  exact), so a loop costs 3–5 keys per axis and long scenes stay inside the 128-key
  limit. x and y live on separate nodes, each with its own limit.
- The grid is one path and the dots one text node of `•` glyphs on the lattice (a path of
  hundreds of circles renders in seconds; glyphs in milliseconds), each a cell larger than
  the frame on every side, sliding one cell per loop and snapping back on the loop frame
  (invisible: the pattern repeats).
- Grain is the engine's `FilmGrain` on the root.

**Acceptance**

- Frame `f` and frame `f + loop` are identical for every kind, grain off (render test).
- Seeds change blob phases; one seed renders identically twice (render test).

---

### 7.15 `Waveform`

An audiogram: bars, mirrored bars, dots or a ring that move with a track's spectrum. The
audio is analysed once, offline and deterministically, into plain data (`AudioLevels`);
the component binds each bar to its band as a signal, so a minute of audio costs no
keyframes.

```ts
const levels = await analyzeAudio("assets/voice.wav", { fps: 30, bands: 32 });
comp.add([
  Layer.audio("assets/voice.wav", { startFrame: 60 }),
  Waveform({ audio: levels, audioStart: 60, kind: "mirror", x: 560, y: 700 }),
]);
```

`analyzeAudio(source, { fps, bands, minHz, maxHz })` (framefields) decodes the file;
`analyzeChannels(channels, sampleRate, options)` (components core, pure) does the work:
a Hann-windowed FFT per frame, log-spaced bands, each band normalised to its own 98th
percentile (floored 30 dB under the loudest band's, so a quiet band isn't stretched into
noise; silence stays 0), an RMS `level` envelope, and onset `beats` from low-band flux.

```ts
interface AudioLevels {
  fps: number;
  frames: number;          // length in frames
  bands: number[][];       // [band][frame], 0–1, low → high
  level: number[];         // [frame], 0–1
  beats: number[];         // frames
}
```

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `audio` | `AudioLevels` | required | Its `fps` must equal the component's. |
| `audioStart` | `number` | the component's `at` | Composition frame where the track starts. Signals read the composition's frame, so this is the audio layer's absolute `startFrame`. |
| `kind` | `"bars" \| "mirror" \| "dots" \| "radial"` | `"mirror"` | `bars` grow up from a baseline, `mirror` from the centre line both ways, `dots` scale, `radial` grow outward from a ring. |
| `bars` | `number` | `audio.bands.length` | Bands are resampled (averaged) to this count; mirrored bars place low bands in the middle. |
| `width`, `height` | `number` | `800`, `200` (× scale); radial: `height` is the outer diameter | |
| `gap`, `radius` | `number` | `0.45` of a bar's pitch, round | |
| `floor` | `number` | `0.06` | Smallest bar, as a fraction of full height. |
| `gain` | `number` | `1` | |
| `smoothing` | `number` | `2` | Frames a bar takes to fall from a peak (offline; attack is instant). |
| `color` | colour or `[from, to]` | theme `accent` | A pair grades the bars across. |

Natural duration is the audio's length from `audioStart`; open-ended is false (the bars
fall to the floor at the end).

**Cues:** `beats` (component-local, from `audio.beats`).

**Acceptance**

- `analyzeChannels` finds a 440 Hz tone in the band holding 440 Hz, a 100 Hz kick's
  onsets within one frame, and is identical on two runs (unit tests).
- A bar's rendered height at frame `f` matches its band's level at `f − audioStart`
  (render test).

---

### 7.16 `WordCycle`

"Make videos *faster* / *together* / *in code*": one slot in a line cycles through words,
the slot resizes to each word's measured width, and the rest of the line glides to fit.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `text` | `string` | required | One line with one `{}` marking the slot, e.g. `"Make videos {}"`. |
| `words` | `string[]` | required | At least two. |
| `every` | `number` | `1.6 s` | Frames each word stays. |
| `cycles` | `number` | `1` | Passes through `words`; the last word stays. |
| `transition` | `"roll" \| "fade" \| "slide" \| "type"` | `"roll"` | `roll`: up through the slot's clip; `slide`: sideways; `type`: deletes and types. |
| `align` | `"left" \| "center" \| "right"` | `"left"` | `center` / `right`: the text before the slot glides too. |
| `slot` | `"plain" \| "pill" \| "underline"` | `"plain"` | A pill or underline behind / under the slot that resizes with it. |
| `color`, `slotColor` | colours | theme `ink`, `accent` | |
| `fontSize`, `fontFamily`, `fontWeight` | | `96 × scale`, theme `display`, `800` | |

The root is as wide as the line with the longest word, so the layout never reflows
outside it. Width and position changes ease over the transition (`theme.motion.ease.move`;
`type` steps per character), two keys a change, so many cycles stay inside the key limit.

**Cues:** `changes` (`{ frame, index, word }`, the frame each new word starts arriving).

**Acceptance**

- At rest, the gap between the slot and the text after it equals one space's measured
  width for every word (unit test on the keys).
- Exactly one word is visible in the slot at rest, and a `roll` never shows a word outside
  the slot's clip (render test).

---

### 7.17 `DeviceFrame`

A phone, tablet or laptop around a screen: the mobile counterpart of `AppFrame`. Content
is authored in the device's own points (a phone screen is 393 × 852) and scaled into the
screen, so a mock UI or recording made at device size drops in unchanged, and `at(x, y)`
maps those points to the parent for pointers, touches and zooms.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `device` | `"phone" \| "tablet" \| "laptop"` | `"phone"` | |
| `orientation` | `"portrait" \| "landscape"` | `"portrait"` | Phone and tablet. |
| `content` | `LayoutNode \| LayoutNode[] \| string` | — | Layers in screen points, or a media path (fills the screen with `fit`). |
| `fit` | `"cover" \| "contain" \| "fill"` | `"cover"` | Media content. |
| `points` | `[w, h]` | phone 393 × 852, tablet 820 × 1180, laptop 1440 × 900 | Screen size content is authored in (swapped for landscape). |
| `finish` | `"graphite" \| "silver" \| "midnight"` or colour | `"graphite"` | Body colour; edges and buttons follow. |
| `island` | `boolean` | `true` | Phone: the camera island (a notch-less pill). |
| `statusBar` | `boolean \| { time?: string; dark?: boolean }` | `true` | Phone and tablet: time, signal, Wi-Fi and battery, drawn (no glyph fonts needed). |
| `screen` | colour | `#000000` | Screen background under the content. |
| `tilt` | `false \| { rotateX?, rotateY? }` | `false` | A 3D presentation angle (box perspective). |
| `elevation` | `0–3` | `2` | Shadow depth. |

Size: give `height` (phone / tablet) or `width` (laptop); the other follows the device's
proportions. Defaults: phone and tablet 860 × scale tall, laptop 1280 × scale wide.

**API on the returned node:** `screenRect` (the screen in the parent's coordinates),
`at(x, y)` (screen points → the parent's coordinates; ignores `tilt`) and `fill(...nodes)`.

**Parts:** `body`, `bezel`, `screen`, `content`, `island`, `status`, `buttons`, `base`,
`shadow`, `tilt`.

**Acceptance**

- `at(0, 0)` and `at(...points)` are the screen's corners for every device and orientation
  (unit test).
- Content authored at `points` fills the screen exactly (render test: a full-size box in
  points covers the screen rect and nothing outside it).

---

### 7.18 `TouchPoint`

Fingers on glass: taps, double taps, long presses and swipes, drawn the way screen
recordings show touches (a soft disc that lands, presses and lifts, with a ripple). It
pairs with `DeviceFrame` through `at()`.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `touches` | `Touch[]` | required | `Touch = { to: Target; at?: number; tap?: number; press?: number; swipe?: Target; dwell?: number }`. `tap`: tap count (default 1 unless `press` / `swipe`); `press`: hold frames (long press); `swipe`: drag to this target and lift. `at` omitted → after the previous touch plus a reading gap. |
| `size` | `number` | `64 × scale` | Disc diameter. |
| `color` | colour | `#ffffff` | |
| `opacity` | `number` | `0.55` | |
| `ripple` | `boolean` | `true` | A ring expanding from each tap and long press. |
| `trail` | `boolean` | `true` | A short fading streak behind swipes. |

Root covers the frame (like `Callout`). Between touches the finger is lifted: the disc is
gone, so it never "travels" like a pointer.

**Cues:** `taps` (`{ frame, point }`, each tap down), `presses` (`{ frame, end, point }`),
`swipes` (`{ frame, end, from, to }`), `touches` (every touch-down).

**Acceptance**

- The disc is invisible before a touch's lead-in and after its lift (render test).
- A swipe's disc is at `from` on the swipe cue's frame and at `to` on its `end` (unit test on
  the keys).

---

### 7.19 `BeforeAfter`

Two versions of one picture split by a moving divider: a clip with and without an effect
or grade, a redesign, a cleanup. The `before` side is clipped to the divider; both sides
are laid out at the full size, so they line up exactly.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `before`, `after` | `LayoutNode \| LayoutNode[] \| string` | required | Layers or media paths, laid out at the component's size. |
| `split` | `number \| [frame, value, ease?][]` | a sweep: 0.5 → 0.15 → 0.85 → 0.5 | Divider position, 0–1 from the left (or top). |
| `direction` | `"horizontal" \| "vertical"` | `"horizontal"` | `horizontal`: a vertical divider moving left / right. |
| `labels` | `[string, string] \| false` | `["Before", "After"]` | Corner pills; each fades as the divider covers it. |
| `handle` | `boolean` | `true` | A round grip with arrows on the divider. |
| `fit` | as `AppFrame` | `"cover"` | Media sides. |
| `color` | colour | `#ffffff` | Divider and handle. |

Default size 1280 × 720 × scale. Open-ended (a container).

**Cues:** `settled` (the last split key).

**Acceptance**

- Left of the divider is exactly `before`, right of it exactly `after`, on every frame
  (render test with two solid sides).

---

### 7.20 `Selection`

A text selection or a marquee, the way an editor draws them, driven by a `MousePointer`
drag: the highlight follows the pointer glyph by glyph (text) or corner by corner
(marquee), and marquee items light up as the box covers them.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `kind` | `"text" \| "marquee"` | `"text"` | |
| `target` | text target | — | `text`: `{ text, match? \| range? }` to select. |
| `pointer` | a `MousePointer` | — | Follow its `positionAt()` during the drag. |
| `drag` | `{ frame, end }` | `pointer.cues.drags[0]` | Frames of the drag (parent timeline). Without a pointer, the selection eases across the range in this window. |
| `from`, `to` | `[x, y]` | the drag's | Marquee corners (parent coordinates). |
| `items` | `Target[]` | `[]` | Marquee: these light up once covered. |
| `clear` | `number` | — | Frame (parent timeline) the selection disappears. |
| `color` | colour | theme `accent` | Fill at 30 %, marquee border at full. |

Root covers the frame from 0, 0. Open-ended unless `clear`.

**Cues:** `selected` (selection complete), `items` (`{ frame, index }`, each item covered).

**Acceptance**

- With a pointer, the selection's end on frame `f` is the glyph boundary nearest the
  pointer's x on the line under it (unit test, fake host).
- A selection over two lines draws one rect per line, matching `rangeRects` (unit test).

---

### 7.21 `CardStack`

Cards in a depth stack that shuffle: the front card lifts away and the rest step forward,
or cards are dealt onto the pile one by one. A testimonial carousel, feature cards, a deck
of photos.

**Props**

| Prop | Type | Default | Notes |
|---|---|---|---|
| `cards` | `(LayoutNode \| { title, body?, image?, accent? })[]` | required | Layers sized to the card, or simple cards drawn from the theme. At least two. |
| `mode` | `"cycle" \| "deal"` | `"cycle"` | `cycle`: the front card flies off and returns to the back; `deal`: cards land one at a time onto the pile. |
| `every` | `number` | `1.5 s` | Frames between moves. |
| `cycles` | `number` | `1` | Passes (cycle mode). |
| `visible` | `number` | `3` | Cards shown behind the front one. |
| `flyTo` | `"up" \| "left" \| "right"` | `"left"` | Where the front card flies. |
| `cardWidth`, `cardHeight` | `number` | `640 × 400` (× scale) | |
| `tilt` | `false \| { rotateX?, rotateY? }` | `{ rotateX: 12 }` | Perspective on the stack. |

**Cues:** `changes` (`{ frame, index }`: the card that is now in front).

**Acceptance**

- At rest the front card is drawn last and unscaled; card `k` behind it is scaled
  `1 − 0.06 k` and offset `k` steps up (unit test).
- After a full cycle the stack is the starting order (unit test on the keys).

---

## 8. Waves 2 and 3

Specified at summary level now; each gets a full section (like §7) before its milestone
starts.

### 8.1 Wave 2

| Component | Summary | Key props | Notable framefields use |
|---|---|---|---|
| `CodeBlock` | Specified in §7.9 (M4). | | |
| `ChatThread` | A messaging conversation: bubbles from either side, typing indicator, reactions, timestamps, auto-scroll. | `messages: { from, text \| media, at? }[]`, `participants`, `appearance` | Bubble sizes from measured text; spring entries baked; typing dots between messages. |
| `Callout` | A label with a leader line pinned to a point or a moving tracked object; stays inside the frame. | `target`, `text`, `side: "auto" \| …`, `elbow` | Dynamic targets bind to vision `track` signals; auto side picks the free quadrant per frame. |
| `Spotlight` | Dims the frame except a feathered region that glides between targets. | `targets: { at, target }[]`, `dim`, `feather`, `shape` | Inverted alpha matte + blur; region keyed between target rects. |
| `Confetti` | Celebration bursts with paper, ribbons and sparkles that fall and settle. | `bursts: { at, origin, count }[]`, `palette`, `gravity`, `floor` | GPU particles; optional physics floor; bursts can come straight from `cues`. |
| `Meter` | Specified in §7.12 (M4). | | |
| `TitleCard` | Specified in §7.10 (M4). | | |
| `LowerThird` | Specified in §7.11 (M4). | | |
| `Toasts` | Notifications arriving into a stack that pushes down and compresses as it grows. | `items: { at, title, body, icon? }[]`, `max`, `corner` | Stack layout solved offline; spring settle baked. |

### 8.2 Wave 3 (re-scored in M6)

**Evidence.** There is no usage telemetry or request log yet, so demand comes from what
this repository's ten example films build by hand, read file by file
(`examples/19`–`30`), plus common video formats. Leverage comes from engine features
that already exist (`Layer3D` extrusion and materials, GPU particles and noise, film grain,
`AudioSignal` extraction, vision mattes), and foundation from what Waves 1–2 built that a
candidate would reuse or extend. The criteria are §6's, scored 1–3.

What the films show:

- **Logo lockups** close 5 of 10 films (19, 22, 25, 29, 30), each built by hand: extruded
  in 3D (22), with a glint on the hit (25), as a mark-and-name lockup (29, 30).
- **Backdrops** (gradients, grain, lens finish) sit behind 8 of 10.
- **A cycling word** drives 22's type scene (one word cycling through every face).
- **3D cards** carry 28 (glass word cards thrown in with physics).
- **No phone, tablet or laptop frame** appears in any film; mobile demos are a common
  format elsewhere, so demand is scored on format, not on our films.
- **Audio** has a whole example (24); podcast and music clips (audiograms) are a common
  social format, and nothing on the component side reads audio yet.

| Candidate | Demand | Leverage | Foundation | Hard by hand | Total | Plan |
|---|---|---|---|---|---|---|
| `LogoReveal`: wordmark / mark reveal and lockup, flat or extruded (glass, chrome), with a glint | 3 (5/10 films) | 3 (`Layer3D` extrusion, materials, glint) | 2 (SVG / path import to shapes and extrusions; a lockup layout `TitleCard` can reuse) | 3 | **11** | 3a |
| `Backdrop`: mesh gradient, grid, dot field, grain; loop-exact | 3 (8/10 films) | 3 (GPU noise, grain, loop-exact time) | 2 (periodic, loop-exact motion any ambient part can use) | 2 | **10** | 3a |
| `Waveform` (new): audiogram bars, line or radial spectrum from a track | 2 (podcast and music clips; example 24) | 3 (`AudioSignal` extraction) | 3 (binding audio signals into components: also unblocks `Captions` `pulse` and signal-driven glyph selectors) | 2 | **10** | 3a |
| `WordCycle`: one slot cycles through words while the sentence reflows | 2 (22; rotating-word headlines in launch films) | 3 (measured GPU text, glyph schedules) | 1 | 3 (every other word must glide to fit each new word's measured width) | **9** | 3a |
| `DeviceFrame`: phone, tablet, laptop with a screen slot; 2D and 3D | 2 (format; none in our films) | 3 (`Layer3D` presentation, video in the slot) | 2 (screen slot and `at()` shared with `AppFrame`) | 2 | **9** | 3b |
| `BeforeAfter`: split view with a moving divider | 2 | 3 (one clip with and without effects or grading, split by a matte: shows off the effects stack) | 1 | 2 | **8** | 3b |
| `Selection`: marquee and text selection driven by a `MousePointer` drag | 2 | 2 (text range rects, pointer cues) | 1 | 3 (selection must track the drag glyph by glyph) | **8** | 3b |
| `CardStack`: depth-stacked cards that shuffle forward | 2 (28) | 3 (3D, physics) | 1 | 2 | **8** | 3b |
| `LayerDiagram`: exploded 3D plates with labels | 1 | 3 (3D) | 1 | 2 | 7 | backlog |
| `TouchPoint`: mobile taps, long-presses, swipes | 2 (with devices) | 1 | 1 (reuses the pointer planner) | 2 | 6 | 3b, with `DeviceFrame` |
| `SocialPost`: post / profile card mock-ups | 2 | 1 | 1 | 1 | 5 | backlog |
| `Avatars`: overlapping avatar group with a count | 1 | 1 | 1 | 1 | 4 | dropped as a component |

Decisions:

- **Wave 3a (M7): `LogoReveal`, `Backdrop`, `Waveform`, `WordCycle`.** The first two are
  what our own films rebuild most often; `Waveform` brings audio into the component layer
  (and with it the deferred `Captions` `pulse`); `WordCycle` is the hardest common text
  move left to do by hand.
- **Wave 3b (M8): `DeviceFrame` + `TouchPoint`, `BeforeAfter`, `Selection`, `CardStack`.**
  `TouchPoint` scores low alone but ships with `DeviceFrame`: a device without touches, or
  touches without a device, is half a demo.
- **Backlog:** `LayerDiagram` (no film needs it yet), `SocialPost` (low leverage; if built,
  a generic card with no real platform's name, logo or styling).
- **Dropped:** `Avatars` as a component. An avatar stack is a few boxes; it becomes a
  helper used by `ChatThread` participants and any future `SocialPost`.
- Re-score again when there is real demand data (issues, requests, generated-composition
  logs), not only our own films.

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

Each component is a row in the script's `COMPONENTS` table: a marker string only its module
has, and the components it composes (Terminal composes AppFrame and Counter, CodeBlock
composes AppFrame, TitleCard composes TextReveal, Meter composes Counter). The check imports
each component alone and forbids every other marker except those.

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
| CodeBlock | 2 per line + 4 | 10 ms |
| TitleCard | 8 | 10 ms |
| LowerThird | 8 | 2 ms |
| Meter | 6 (segments / stars: 3 per cell) | 5 ms |
| LogoReveal | 10 | 10 ms |
| Backdrop | 8 (mesh: 4 + blobs) | 10 ms |
| Waveform | bars + 2 | 5 ms (analysis: 1 s per 10 min of audio, offline) |
| WordCycle | words + 6 | 5 ms |
| DeviceFrame | 16 + content | 5 ms |
| TouchPoint | 3 per touch | 5 ms |
| BeforeAfter | 10 + both sides | 2 ms |
| Selection | 2 per line (marquee: 3 + items) | 5 ms |
| CardStack | 4 per card | 10 ms |

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
| **M1 · Pointer & camera** ✅ | `MousePointer` (rebuilt to the existing changeset design plus the Wave 1 additions), `FocusZoom`, `AppFrame`. | Example `30_product_demo`: a screen recording in a browser frame, pointer with clicks and auto-zoom, click SFX placed from cues. |
| **M2 · Type** ✅ | `TextReveal`, `Counter`, `Annotate`. | All §7.4–7.6 acceptance tests green (§14). No example film for M2 or later milestones: examples stop at `30_product_demo`. |
| **M3 · Speech & shell** ✅ | `Captions` (incl. transcript parsers and `behind`), `Terminal`. | §7.3 / §7.8 acceptance tests green (§15); no example film. |
| **M4 · Wave 2a** ✅ | `CodeBlock`, `TitleCard`, `LowerThird`, `Meter`. | Specs in §7.9–7.12; acceptance tests green (§16); no example film. |
| **M5 · Wave 2b** ✅ | `ChatThread`, `Callout`, `Spotlight`, `Confetti`, `Toasts`. | Built from the §8.1 rows; behaviour and acceptance in §17; no example film. |
| **M6 · Re-score** ✅ | Rank Wave 3 against usage and requests. | Updated §8.2 (no telemetry yet: evidence from the example films and engine features). |
| **M7 · Wave 3a** ✅ | `LogoReveal`, `Backdrop`, `Waveform`, `WordCycle` (+ `Captions` `pulse` via audio levels). | Specs in §7.13–7.16; acceptance tests green (§18); no example film. |
| **M8 · Wave 3b** ✅ | `DeviceFrame` + `TouchPoint`, `BeforeAfter`, `Selection`, `CardStack`. | Specs in §7.17–7.21; acceptance tests green (§19); no example film. |

Housekeeping (done in M1): the stale `.changeset/components-mouse-pointer.md` described a
standalone package that never shipped; it is replaced by `framefields` changesets per
milestone (the components package is private and bundled).

---

## 11. Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Root re-export or `framefields/components` only? | **Decided (M0):** components and user-facing types at the root, full toolkit at the subpath (§3.1). |
| Q2 | Is text `content` keyframeable with hold interpolation? | **Corrected (M1):** the `text` track is a *reveal amount*, not a string: ≤ 1 is a fraction, > 1 a character count (so one character of n is keyed as `1 / n`). Typing (`AppFrame` URLs, `TextReveal` `type`) keys counts with `hold`. Changing strings per frame is not possible, so `Counter` uses digit reels for both styles and `stream` uses glyph animators. |
| Q3 | Node targets inside flex layouts need resolved geometry at build time. | **Open:** `computeLayoutSync(yoga, …)` exists in `@framefields/compositions/program`, but no `host.layout` was needed for M1/M2: node targets still require absolute nodes and the error says so. `TextReveal.rects(match)` and `AppFrame.at(x, y)` cover the common cases. |
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

## 13. M1 delivery notes

What landed: `MousePointer`, `AppFrame`, `FocusZoom` (§7.1, §7.2, §7.7), their unit tests
and `m1.render.test.ts`, the tree-shake cases, and `examples/30_product_demo`.

Decisions and deviations:

- **Props are a factory** (`props: () => zodShape`) and shared schemas (`basePropsSchema()`,
  `targetSchema()`) and glyph tables are built on first use, so importing a component builds
  nothing; the tree-shake baseline (§9.5) enforces it.
- **Contract additions:** `BuildContext.requested` (the user's width / height), `BuildResult`
  `origin` (components that work in parent coordinates sit at 0, 0), `duration: null`
  (open-ended containers; an exit then needs an explicit `duration`) and `api` (extra methods
  on the node: `positionAt`, `contentRect`, `at`, `toScreen` …). Host gained `media` and
  `style` (layer styles).
- **MousePointer:** default size 44 px, motion blur via the node's `motionBlurShutter`
  (45° when `true`), click rests count as pressed so drift never moves a click, and the moving
  part is a box the size of the glyph (1 × 1 boxes cull their children).
- **FocusZoom camera:** moves interpolate the *view rectangle* between framings that are
  clamped beforehand, eased minimum-jerk. Every content point then moves one way on screen,
  with no sideways wiggle while zooming. Smoothing pan and zoom separately and clamping the
  result made the view drift sideways mid-zoom. Moves land by `settleBy` (two frames before a
  cluster's first click); `bounds` keeps a zoomed view inside a region (e.g. the app
  window); `follow` frames click clusters and does not chase the pointer. Smear presets are
  24 / 60 / 140° shutter.

## 14. M2 delivery notes

What landed: `TextReveal`, `Counter`, `Annotate` (§7.4–7.6), `core/glyphs.ts`, mask
presets, unit tests on the fake host and `m2.render.test.ts` (every glyph style ends
pixel-identical to the static text; scramble frames identical in any render order; wrapped
underlines; settled counters hold still).

How it is built:

- **Per-unit GPU schedules (`core/glyphs.ts`).** The renderer's expression selector reads
  the text node's local `frame` and the unit index (`textIndex` counts every character,
  spaces included; `wordIndex`; `lineIndex`). A schedule bakes each unit's start and an
  ease table sampled with `core/ease.ts` into the expression, so cue frames are exact, any
  order works (`random`, `center` …) and back / elastic overshoot comes through. One text
  node per paragraph; `evaluateGlyphExpression` mirrors the renderer for unit tests.
- **Node-based styles** where glyph animators can't do it: `mask` (one clipped node per
  line), `scramble` (a clipped reel per character), and `slam` (a node per unit: the
  renderer pivots glyphs on their own boxes, so a word can't scale as one). Both hand over to
  the paragraph node the frame they settle, so the final frame is still the static text.
- **`wipe`** is a CSS-gradient box matte (`host.matte`); shape mattes don't mask in the
  renderer. The front trails blur from a baked front-position table.
- **Counter:** every digit place is a clipped reel; values are integers in the last shown
  digit (`99.5` at two decimals is `9950`). `roll` spins like an odometer, capped at
  `MAX_TURNS` (3) full turns per move plus the remainder, so the landing digit is exact;
  `count` steps the same reels. Formats: a d3-style subset (`[$][,][.precision][d|f|%]`),
  `Intl.NumberFormatOptions` (affixes and separators from `formatToParts`), or a function
  (laid out per character from the right). Places fade in and the number slides to keep
  `align` as they appear.
- **Annotate:** strokes draw on in sequence by length; hand-drawn marks boil with `d` hold
  keys; text ranges give one stroke per line; arrows' boxes include the tail.

Deviations from §7.4–7.6:

- **Lifetime.** New `BuildResult.openEnded`: text, numbers and marks stay on screen after
  they settle unless an `exit` or `duration` is given (then `hold` applies). New
  `BuildResult.afterHold` / `BuildContext.hold` let a component play its own exit after the
  hold (`TextReveal` `exitStyle`).
- **TextReveal:** rich `TextSpan[]` text is replaced by `emphasis` (words or patterns in the
  accent colour), which keeps one measured string. `exitStyle` excludes `scramble` and
  `slam`; `mask` exits only a `mask` reveal. Added `cps` and `caret` for `type` / `stream`,
  and `rects(match)` on the node (parent coordinates) for `Annotate` and cameras.
- **Counter:** digits are always tabular (reels need fixed cells), so the final frame
  matches a tabular layout, not a proportional `Layer.text`. The `duration` / `ease` props
  are `countDuration` / `ease` (base `duration` is the window); `signal`-driven values and
  the `flip` style are deferred.
- **Annotate:** targets must be static (moving targets belong to `Callout`). `hand.wobble`
  is 0–1 (× 5 px at theme scale), `pencil` has no grain yet, and `highlight` multiplies on
  light themes and tints on dark ones instead of being inserted under the target.

## 15. M3 delivery notes

What landed: `Captions` (§7.3) with SRT / WebVTT / word-JSON parsers and the phrase
builder, `Terminal` (§7.8), `core/typing.ts` (shared typing rhythm), `host.cutout`, unit tests
and `m3.render.test.ts` (karaoke colour changes on `round(start × fps)` and not a frame
earlier; captions and terminal frames identical in any render order; a finished terminal
holds still).

How it is built:

- **Renderer indexing.** `textIndex` skips line breaks: after a `\n` every character sits
  one index earlier than in the string, while `FontManager.measure` keeps string indices.
  `rendererChars(text, values)` converts any per-character array before it reaches an
  expression; TextReveal and Captions both use it.
- **Captions:** one text node per phrase, lines broken by the phrase builder (measured
  width, `maxChars`, `maxLines`, sentence ends, pauses ≥ `minGap`). Word colour, pops and
  gradients are glyph animators with exact step / window expressions; `highlight` and `pill`
  markers are keyed boxes that leave on the word's first frame and land a few frames in, and
  the text on the marker flips colour as it lands. `outline` uses a layer-style stroke
  outside the glyphs. Auto font size fits `maxChars` across the safe area, and lines are
  checked by measured width. `behind` stacks `host.cutout(video)` (segmentation matte; `subject`
  uses the larger model) over the phrases.
- **Terminal:** `planTerminal` runs the script on a clock (typing, Enter beat, output pacing,
  spinners, progress, clears) and the nodes are built from the plan. Lines are drawn only
  while on screen (`startFrame` / `durationFrames`), so live text nodes stay within
  `rows + 6`. Scrolling moves by whole lines; a scroll during a glide retargets it, and
  `clear` snaps. Spinners and check marks are vector shapes, and the progress percentage is
  a composed `Counter`; the window is a composed `AppFrame` (`frame: false` for the bare
  screen).

Deviations from §7.3 / §7.8:

- **Captions:** `pulse` (voice-driven active-word scale) and `avoid` are deferred: glyph
  signal selectors need a way to bind user signals into a text node. (`pulse` landed in
  M7 from analysed levels, §18.) Phrase cues are
  `{ frame, end, text }`. The default font is the theme's display face at weight 800 (body
  weight for `clean`).
- **Terminal:** the default prompt is `$ ` and spinners / checks are drawn, because common
  mono fonts (the bundled JetBrains Mono included) lack `❯`, `✔` and braille. A done line's
  leading `✔` / `✓` is replaced by the drawn check. The monospace check (warn when not
  mono) is not implemented.

## 16. M4 delivery notes

What landed: `CodeBlock`, `TitleCard`, `LowerThird`, `Meter` (§7.9–7.12), unit tests for
each, a cross-cutting **unique node id** test over every component (`src/ids.test.ts`), and
`m4.render.test.ts` (a settled diff renders exactly like the new code; 3.5 stars fill three
and a half; title cards render identically in any frame order).

How it is built:

- **CodeBlock:** a small regex tokenizer per language (keyword sets built on first use),
  one text node per line with coloured spans, line numbers as separate nodes. All opacity
  changes per node (typing, focus, diff) go through one `Track`, so they merge into a single
  ascending keyframe track. Diffs use an LCS on trimmed lines; removed lines finish leaving
  before added lines on the same row arrive.
- **TitleCard:** kicker, headline and sub-line are composed `TextReveal`s; the rule and the
  `stack` accent bar are keyed boxes (crisper than a stroked mark for a straight rule, so not
  `Annotate`). With `exitStyle` the headline is built with its hold lined up to the card's,
  and the other parts fade with it.
- **LowerThird:** each plate is a clipping box whose background slides in from the side
  and whose text rises a beat later; leaving reverses it. Keys are merged per node and prop.
  `tag` is one text node with spans (name bold, role a size down).
- **Meter:** ring / arc fills are stroked arc paths with `trimEnd` keyed on exactly the
  value's keyframes and eases, so the composed `Counter` and the fill agree on every key
  frame. Segments light (with a pop) on the frame the value crosses them; stars fill through
  widening clip boxes.

Found on the way:

- **Duplicate ids share geometry and keyframes in the renderer.** CodeBlock's diff washes
  had the same ids as the added lines and took their layout. Ids are now unique, and
  `ids.test.ts` guards every component.

Deviations from §7.9–7.12:

- CodeBlock line numbers use the muted colour (no extra opacity), and `focus.lines` takes
  a list or `{ from, to }` (a two-number list was ambiguous).
- TitleCard's rule is a box, not an `Annotate` mark.
- LowerThird has no logo slot yet.

## 17. M5 delivery notes

What landed: `ChatThread`, `Toasts`, `Callout`, `Spotlight`, `Confetti` (from the §8.1
rows), unit tests for each, the components in `ids.test.ts`, and `m5.render.test.ts` (a
reply is invisible until it lands; toasts are absent before they arrive; the spotlight's hole
is lit and the rest dimmed; confetti frames identical in any render order).

**A contract-wide fix.** Before a track's first keyframe the renderer draws the node's base
value, not the first key's. Every component meant "hold the first key" (a bubble hidden until
it lands, a second underline undrawn until its turn, a label waiting for its cue), so the
contract now pins each track's first value at frame 0 for the whole built tree
(`holdFirstKeys`, skipping repeating tracks). This fixed latent early-visibility in earlier
components too; every M1–M4 test still passes unchanged.

How they are built:

- **ChatThread** (`messages`, `me`, `participants`, `names`, `typing`, `readCps`): timing
  from reading speed, with typing dots (a bouncing wave) before the other side's replies.
  Bubbles are measured (wrapping past 74 % of the width), spring in from their corner
  (`core/bake.ts` `springKeys`), and the column scrolls to keep the newest in view. It also
  supports names for group chats, timestamps, image messages and reactions; a heart reaction
  is drawn, other reactions are text.
- **Toasts** (`items`, `corner`, `max`): the stack is solved at every arrival and dismissal
  (newest at the edge, older ones pushed away, each a little smaller, faded beyond `max`), and
  every toast springs between its targets (`springTrack`: a retarget starts from the current
  value). Kinds draw their own icon: success, info, warning, error.
- **Callout** (`target`, `text`, `title`, `side`, `elbow`, `dot`, `length`): the leader is
  one or two rotated boxes (keyed numbers, not a morphing path), the label hangs off its end,
  is clamped inside the frame, and `auto` picks the open quadrant. Moving targets are followed
  for `length` frames; the side decision eases, so a target crossing the middle swings its
  label across instead of snapping.
- **Spotlight** (`targets`, `dim`, `shape`, `feather`, `glide`, `follow`): a full-frame dim
  layer masked by an **inverted** matte (`host.matte(…, "alpha-inverted")`) whose hole glides
  between padded target rects; `"full"` lifts the dim. `ellipse` is a soft pool
  (radial-gradient hole); `rect` is a crisp rounded rectangle.
- **Confetti** (`bursts`, `palette`, `gravity`, `floor`, `ribbons`, `sparkles`): GPU particles
  via `host.particles`, with one square-paper system per palette colour per origin (bursts
  sharing an origin share systems), spark streaks for ribbons, and additive soft glints.
  Curl noise reads as flutter, and a floor lets pieces bounce and settle. Each system is
  seeded from `seed`.

Deviations from the §8.1 rows:

- ChatThread's `appearance` comes from the theme (no separate prop).
- Callout binds dynamic targets as baked frames over `length`, not live vision signals, and
  has no per-frame quadrant switching beyond the eased side choice.
- Spotlight's `rect` shape has no feathered edge: one matte can't be both rounded-rect and
  feathered. Use `ellipse` for a soft light.
- Confetti paper doesn't flip in 3D: GPU particles have no per-particle rotation, so the
  flutter comes from curl noise.
- Emoji need an emoji-capable font; the default theme fonts have none.

## 18. M7 delivery notes

What landed: `LogoReveal`, `Backdrop`, `Waveform`, `WordCycle` (§7.13–7.16), `Captions`
`pulse`, audio analysis (`analyzeChannels` in core, `analyzeAudio` in framefields), unit
tests for each, the components in `ids.test.ts` and the tree-shake table, and
`m7.render.test.ts` (the slide's name hidden until the glide; draw and pop settle alike; an
extruded name renders; every backdrop kind loops exactly; grain applies; seeds change the
mesh; a bar follows its band on the composition's clock at two start frames; one word at
rest and a roll that never leaves the slot; the pulse moves only the active word, and level
0 matches no pulse).

How they are built:

- **Audio as plain data.** Analysis is offline and deterministic (`AudioLevels`: bands,
  level, beats per frame). `Waveform` binds each band through `host.signal`
  (`Signal.fromArray`), so long tracks cost no keyframes; `Captions` bakes the phrase's
  level slice into its glyph expression table. The GPU `AudioSignal` extractor is not used:
  it is async and its output is a runtime object, not data.
- **Signals read the composition's frame**, not the layer's (checked with an offset parent),
  hence `audioStart`. It defaults to the component's `at`, which is right whenever the
  waveform starts with its track at the top level.
- **Bars key `height` and `y`.** 2D boxes have no `scaleY` (only 3D models and glyph
  animators do), so each bar takes two signals per band, shared by mirrored bars.
- **LogoReveal** path marks accept any SVG path data: `transformPathData` now scales
  relative commands and arcs. The mark is drawn last, so in `slide` the name wipes out from
  behind it through its clip. The glint is a char-indexed light band (glyph `fillColor`).
- **WordCycle** splits the line into before / slot / after; spaces at the slot are measured
  (`"a a"` minus `"aa"`) rather than trusted to trailing whitespace. Words sit in a clip as
  wide as the slot.
- **Contract:** `BuildContext.requested` now carries `duration` and `at` (Backdrop keys
  its loops for the window; Waveform defaults `audioStart`).
- **Host:** `signal` (`frameArraySignal` itself: the `Signal` namespace would add ~7.6 KB
  to every component), `grain`, `extrudedText` (`Layer3D.extrudedText`), and `.svg` files
  in `media` (`Layer.svg`). Effects attach only to media layers, so `grain` is its own
  layer: a mid-grey SVG carrying `FilmGrain`, blended `soft-light`.
- **Tree-shaking:** four new rows; the shared host grew ~1 KB, so MousePointer's budget
  moves from 60 to 62 KB (it also carries the larger `transformPathData`).

Deviations from the specs as first written:

- Captions `pulse` takes `AudioLevels`, not a `Signal` (§7.3 updated); glyphs scale about
  their own centres, so a pulsing word swells letter by letter.
- Waveform smoothing is offline release smoothing, not the engine's signal smoothing.
- WordCycle eases rather than springs (key budget); `type` re-centres a centred line once,
  as the new word lands.
- Backdrop's loop seam is close to, not exactly, the cosine (the loop itself is exact).
- Keyframe `repeat` exists in the schema but nothing evaluates it, so loops are written out
  in whole periods up to the 128-key limit per track (about 24 loops on the busiest track;
  raise `loop` for very long scenes).

## 19. M8 delivery notes

What landed: `DeviceFrame`, `TouchPoint`, `BeforeAfter`, `Selection`, `CardStack`
(§7.17–7.21), unit tests for each, the components in `ids.test.ts` and the tree-shake table,
and `m8.render.test.ts` (device content in points fills exactly the screen; a touch leaves
nothing before its lead-in or after its lift; each side of the split shows only on its side,
static and moving; a selection draws only once its drag starts; a full card cycle returns to
its first frame).

How they are built:

- **DeviceFrame** scales a content box authored in points into the screen (`scale`, anchored
  top-left); the status bar and island sit in a second points-space box over it, drawn from
  boxes and paths. `tilt` is box perspective. **AppFrame's `tilt`**, declared since M1 but
  never applied, now works the same way.
- **TouchPoint** has its own small planner (`planTouches`): fingers lift between touches, so
  there is no travel to plan and the pointer planner isn't reused. Each touch is one disc
  (plus ripples and swipe ghosts).
- **BeforeAfter** clips the `before` side with an animated-width box over a full-size
  `after`; the divider, grip and label fades are keyed from the same split keys.
- **Selection** follows `pointer.positionAt()` frame by frame: the line under the pointer,
  then the nearest glyph boundary. Text measurement is shared with targets
  (`textLayout`, now exported from `core/targets.ts`).
- **CardStack**: the renderer has no animated z-order (`zIndex` is schema and lint only), so
  in `cycle` each card sits in a clip that shows only the strip above the card in front of
  it. Draw order then never matters at rest, and the leaving card flies sideways, clear of
  the stack. `deal` needs no clip: the newest card is last in the tree.

Engine fix (`webgpu-renderers` + `node-compositor`): `overflow: hidden` clipped a container's
children but not its grandchildren, because a nested container's scissor replaced its
parent's instead of intersecting it. Containers now push `pushScissorIntersect`. This was
needed for BeforeAfter, and it also stops nested content leaking out of AppFrame and
DeviceFrame screens. There's a regression test in `overflow-clip.test.ts`.

Deviations from §7.17–7.21:

- DeviceFrame is a 2D body under a perspective tilt, not a `Layer3D` mesh.
- CardStack uses eased keys, not physics; at the corners of the front card's rounded top a
  card behind is clipped straight across (a sliver of background shows there).
- Selection doesn't recolour selected glyphs; the highlight sits under the text when the
  Selection is placed before the text layer.

Follow-up engine fix: 3D models inside 2D containers ignored the containers' offsets (models
are laid out in flow, so their layout rect never reflected their `x` / `y`). The compositor
now maps a model's own `x` / `y` through its parent's matrix (`model-parent-offset.render.test.ts`),
so LogoReveal's extruded names need no compensation and can sit anywhere in the tree.
