# Components review: visuals, DX and code elegance

Date: 2026-10-25 · Scope: the 26 components in `src/` and the shared `core/` (about 25k lines
with tests), `SPEC.md`, the registry scripts and the render tests in
`packages/framefields/src/components/`.

The foundations are strong. The contract (root → stage → content, strict zod props, cues in
the parent's timeline, `holdFirstKeys`) is consistent across all 26 components. Determinism
is enforced by tests rather than by convention, the tree-shake and registry-typecheck scripts
catch real problems, and the delivery notes in `SPEC.md` explain why things are the way they
are. Most of what follows is about the next layer up: a richer look, less ceremony for the
people calling components, and pulling repeated code into `core/`.

## Status (implemented on `feat/components-dx-elegance`)

| Item | State |
|---|---|
| `core/keys.ts`, `core/color.ts`, `core/layout.ts` (§3.1, 3.2, 3.4) | **Done**: local copies removed; `springTrack` moved to `core/bake.ts` |
| Theme tokens: `mode`, weights, elevation, springs, `syntax`, `color.shadow` (§1.1) | **Done** |
| `surface()` helpers and depth on LowerThird, Toasts, Callout, CardStack, ChatThread (§1.2) | **Done** |
| Motion blur on slides (`blur` on motion presets; plates, toasts, cards) (§1.3) | **Done** |
| CodeBlock syntax colors from the theme, readable on light themes | **Done** |
| `canvas` base prop + `withDefaults` (§2.3; named `canvas`, since Terminal already has `frame`) | **Done** |
| Did-you-mean prop errors, instance ids in errors (§2.5) | **Done** |
| Meta drift test, `partNames`, prop docs in `components.json` (§2.1, 2.2 partly) | **Done**: nine metas fixed. 136 of 303 props have descriptions so far |
| `after()` chaining helper (§2.7) | **Done** |
| Gallery contact sheet (§1.5) | **Done**: `pnpm --filter framefields gallery` |
| ChatThread reactions as emoji text (Noto Color Emoji), replacing the jagged drawn heart | **Done** (from user feedback) |
| `framefields init` project bootstrapper (package.json, tsconfig, src, assets, LFS, fonts, git) | **Done** |
| Fonts installed with components: `add` fetches pinned Noto Color Emoji, writes `fonts.ts`; `framefields fonts add`; `missing_emoji_font` lint and render warning | **Done** |
| Typed parts and cues on `defineComponent` (§2.2) | Open |
| Prop vocabulary renames with aliases (§2.4) | Open |
| Examples as code, per-component READMEs, skill section (§2.6) | Open |
| Splitting large builders into planners (§3.5) | Open |
| Chat bubble tails, glass variants, Backdrop styles, anticipation (§1.3, 1.4) | Open |
| The 10 new components (§4) | Open |

## Top recommendations

| # | Change | Area | Effort | Payoff |
|---|---|---|---|---|
| 1 | Add `core/keys.ts` (`Track`, `KeyBook`, `ascending`, `valueAt`, `round`) and `core/color.ts`, then delete the 20+ local copies | Elegance | S–M | High: one place for the keyframe rules, and it removes a real divergence (§3.1) |
| 2 | Add elevation, type scale, weights, springs and `mode` to `Theme` | Visuals | M | High: every surface gets depth and consistent type |
| 3 | Let parts and cues be typed and declared once, with meta derived from them | DX | M | High: `customize` autocompletes, and meta can't drift from the code |
| 4 | `withDefaults({ fps, theme, frame })` so fps, theme and frame size are set once per project | DX | S | High: removes the 1920×1080 / 30 fps default trap in vertical and 60 fps work |
| 5 | A gallery script: every `example` under all three themes into one contact sheet | Visuals + DX | S | High: visual regressions and rough spots become visible at a glance |
| 6 | Add `.describe()` to props so `components.json` and agents get prop docs | DX | S | Medium–High: docs and agents currently see names and types only |

---

## 1. Visuals

### 1.1 The theme is too thin to carry a look

`Theme` has colors, three fonts, radii, strokes, eases and speeds. Everything else is decided
inside components:

- **Type scale and weights.** There are 25 `fontWeight: <number>` literals across components,
  and sizes are local ratios (`roleSize = nameSize * 0.62` in LowerThird, `fs = 30 * s` in
  ChatThread). Two components side by side don't share a scale.
- **Elevation.** Only 7 of 26 components use `dropShadow`, each with its own numbers. None use
  `innerShadow` or `outerGlow`, so plates, toasts, bubbles and cards look flat next to the
  framed windows.
- **Springs.** `SPRING` / `POP` are redefined with different constants in
  [chat-thread/index.ts:51](src/chat-thread/index.ts:51), [toasts/index.ts:39](src/toasts/index.ts:39)
  and [logo-reveal/index.ts:39](src/logo-reveal/index.ts:39). The `signal` theme can make eases
  snappier, but it can't change how springy things feel.
- **Light or dark.** Components work it out from contrast against black and white
  ([annotate/index.ts:323](src/annotate/index.ts:323), [app-frame/index.ts:126](src/app-frame/index.ts:126),
  MousePointer). An explicit `theme.mode` is clearer and cheaper.
- **Hard-coded palettes.** 20 component files contain hex or `rgba()` literals. Some are
  correct (traffic lights, device bodies), but AppFrame (21) and DeviceFrame (15) carry whole
  private palettes, and CodeBlock's syntax `type` color (`#4cc9e0`) and Terminal's ANSI colors
  ignore the theme.

Proposed additions, all optional with the current values as defaults so nothing moves:

```ts
interface Theme {
  mode: "dark" | "light";
  type: {
    scale: { xs: number; sm: number; md: number; lg: number; xl: number; display: number };
    weight: { regular: number; medium: number; bold: number; black: number };
    tracking: { tight: number; normal: number; wide: number };
  };
  elevation: { 0: LayerStyleConfig; 1: LayerStyleConfig; 2: LayerStyleConfig; 3: LayerStyleConfig };
  surface: { sheen: number; edge: string };   // top highlight, 1px inner edge
  motion: { /* existing */ spring: { soft: Spring; base: Spring; snappy: Spring } };
  syntax?: Partial<Record<TokenKind, string>>; // CodeBlock / Terminal
}
```

### 1.2 Give surfaces depth

A shared `surface(ctx, { elevation, radius, tone })` helper in `core/` would turn a flat box
into a finished surface: an elevation shadow, a faint top-edge highlight (an inner shadow at
`angle: -90`), and an optional vertical gradient of 2–3 % lightness. Using it in LowerThird
plates, Toasts, Callout labels, ChatThread bubbles, CardStack cards and the Selection / Spotlight
chrome would make them read as one design language. It also gives users one knob
(`theme.elevation`) instead of `customize` on every part.

### 1.3 Motion polish

- **Motion blur where things travel fast.** MousePointer, FocusZoom and Counter already use
  `motionBlurShutter`. CardStack's `fly`, Toasts' push-down, LowerThird's plate slide and the
  `slide-*` / `mask-*` presets would benefit most. A `smear` base prop (`false | true |
  shutter°`) applied to the stage would cover every component at once.
- **Consistent overshoot.** `pop` uses `theme.motion.ease.snap`, while bubbles and toasts use
  their own springs. With spring tokens (1.1), "pop" means the same thing everywhere.
- **Exit choreography.** LowerThird, TitleCard and TextReveal leave in reverse order with a
  stagger; Toasts, Callout and ChatThread just fade. A shared `exitStagger(parts, order)` would
  make the quieter exits match.
- **Anticipation.** Nothing pulls back before it moves. A 2–3 frame anticipation option on
  `MotionPreset` (`{ preset: "rise", anticipate: 0.15 }`) is cheap and noticeably more
  professional.

### 1.4 Per-component notes

| Component | What would lift it |
|---|---|
| LowerThird | No logo or avatar slot (noted in M4). Add `logo` (media) and a `glass` plate variant (blurred backdrop plus sheen). |
| ChatThread | Bubbles have no tail. Add drawn tails (one path per side) and a "read" tick row. Reactions are emoji text, which needs a registered color emoji font such as Noto. |
| Toasts | Add an optional time-left bar along the bottom edge and a `glass` surface. |
| Spotlight | `rect` can't be feathered (one matte can't be both rounded and soft). Stacking a blurred copy of the matte, or a second softer ring layer, would give a soft rectangle. |
| Confetti | Paper doesn't flip, because particles have no per-particle rotation. A small `scaleX` oscillation baked into a sprite sheet (two or three frames of a turning square) would sell the flutter. |
| CardStack | The sliver at the front card's rounded corners (noted in M8). Clip the strip with the card's own radius at its top edge. |
| CodeBlock / Terminal | Take syntax and ANSI colors from `theme.syntax`. Add a "focus glow" for the active line (outer glow at low opacity) to go with the dimming. |
| Backdrop | `mesh / grid / dots / solid` cover the basics. `aurora` (stretched, blurred ribbons), `noise` (domain-warped GPU noise) and `conic` would match current launch-film looks. |
| DeviceFrame | A 2D body under perspective. Edge lighting (a gradient along the bezel that follows `tilt`) would get much of the 3D feel without a mesh. The real 3D version is proposal B in §4. |
| Waveform | Add a `glow` (outer glow tied to `level`) and a rounded-cap option for bars. |

### 1.5 Visual QA tooling

The render tests check behaviour (a toast is absent before it arrives, a split shows only its
side). Nothing shows what the components look like together. A `pnpm gallery` script that
renders each meta example at 3–5 key frames under `graphite`, `paper` and `signal` into one
PNG contact sheet would make light-theme gaps, flat surfaces and inconsistent type obvious in
seconds. Committing the sheet lets a PR diff show visual change.

---

## 2. Developer experience

### 2.1 Props carry no documentation into the schema

There are zero `.describe()` calls in the components. The JSDoc comments inside the zod
shapes (`/** Stay on screen instead of leaving after hold. */`) help in the editor, but they
never reach `components.json`, the docs props table §9.7 calls for, or a coding agent reading
the schema. Moving those comments into `.describe("…")`, and having `build-meta.ts` emit
`z.toJSONSchema(schema)` per component, makes the agent-first goal (§1.1.5) real.

### 2.2 Parts and cues: typed, and declared once

Today:

- `customize` receives `Record<string, Animatable<LayoutNode>>`
  ([contract.ts:168](src/core/contract.ts:168)), so `parts.cursor` doesn't autocomplete and a
  typo is a silent `undefined`.
- Each of the 26 components declares a cues interface with the same
  `[name: string]: ReadonlyArray<{ frame: number }>` index signature, then casts its result
  (`as LowerThirdCues`, 25 times).
- `meta.ts` lists `parts` and `cues` again as strings, and no test checks them against what
  `build` actually returns.

Proposal: declare parts and cues on the definition and derive the rest from them.

```ts
export const lowerThird = defineComponent({
  name: "LowerThird",
  parts: ["plate", "edge", "name", "role"] as const,
  cues: { in: cue(), out: cue() },          // cue<{ index: number }>() for data
  props: () => ({ … }),
  build(ctx, props) {
    …
    return { children, width, height, duration, parts: { plate, edge }, cues: { in: […], out: […] } };
  },
});
// customize(parts) is typed as Record<"root" | "stage" | "plate" | …, Animatable<LayoutNode>>
// meta.parts / meta.cues come from the definition: meta.ts keeps summary, tags, example.
```

Until then, a test in `contract.test.ts` that builds each canonical example and asserts
`Object.keys(node.cues)` equals `meta.cues` and every `meta.parts` name resolves through
`node.part()` would stop drift cheaply.

### 2.3 Set fps, theme and frame size once

`fps` defaults to 30 ([contract.ts:336](src/core/contract.ts:336)), and ten frame-sized
components (Backdrop, Callout, Captions, Confetti, FocusZoom, LowerThird, Selection,
Spotlight, Toasts, TouchPoint) default to `1920 × 1080 × theme.scale`. In a 60 fps or 1080 × 1920
vertical project, every call needs `fps`, `width` and `height`, or it silently comes out at
the wrong speed or size. That is easy to miss for people and agents alike.

Components must stay pure, so the fix is a binding-time default rather than a global:

```ts
// src/components/defaults.ts (written once by `framefields add`, or by hand)
export const ui = withDefaults({ fps: 60, theme: themes.paper, frame: [1080, 1920] });
const Captions = ui(CaptionsBase);
```

`withDefaults` wraps a bound factory and merges its defaults under the call's props, so purity,
caching and tree-shaking are unchanged. `BuildContext` gains `frame: { width, height }`, and the
ten copies of `ctx.requested.width ?? 1920 * s` become `ctx.frame.width`. `framefields add`
could write this file from the project's composition settings.

### 2.4 Consistent prop vocabulary

The same idea goes by different names:

| Concept | Current names |
|---|---|
| The look preset | `style` (Captions, Counter, LogoReveal, MousePointer, TextReveal), `kind` (AppFrame, Backdrop, Meter, Selection, Waveform) |
| The arrangement | `layout` (LowerThird, LogoReveal, TitleCard) |
| The behaviour | `mode` (CardStack) |
| Text size | `fontSize` (8 components), `nameSize` (LowerThird, LogoReveal) |
| Typing / reading speed | `cps` (Terminal, TextReveal), `readCps` (ChatThread) |
| Main color override | `color` (11 components), `accent` (6), `palette` (Confetti) |

A short convention in `SPEC.md` §4, applied the next time each component is touched with the
old name kept as a deprecated alias, would do it: `style` = look, `layout` = arrangement,
`mode` = behaviour, `kind` only for "what it is" (AppFrame browser vs terminal). Font props
could become one shared fragment, `font: { family, size, weight }` (`fontFamily` alone appears
in 13 components), built by a `fontProps()` schema helper next to `targetSchema()`.

### 2.5 Friendlier errors

Errors are already good (prop path plus message, and theme-font errors list the registered
families). Two cheap wins:

- **Did you mean.** `.strict()` reports `Unrecognized key: "lable"`. Comparing unknown keys
  against the schema's keys (edit distance ≤ 2) in `bind` gives `lable → label?`.
- **Name the component instance.** Prefix errors with the `id` when one is given
  (`Captions#intro: invalid props`), so a composition with five Captions points at the right
  one.

### 2.6 Examples as code, and docs that travel with the source

- `meta.example` is a string, so it is never typechecked. An `example.ts` per component
  (default export: a function returning the node) can be typechecked, rendered by the gallery
  (1.5), and pasted into docs.
- `SPEC.md` is 1,951 lines combining spec, changelog and decisions, and its status line still
  says "M0 implemented… no components yet". Each component folder could get a short
  `README.md` (summary, props table generated from the schema, parts, cues, two recipes) that
  `framefields add` copies with the source, so users get the docs next to the file they own.
  SPEC.md then keeps the contract and the history.
- §9.7 says `framefields-compose/SKILL.md` should gain a generated Components section. It
  hasn't yet: only the setup skill (`framefields`) mentions components.

### 2.7 Composing timelines

Cues and `span` are the right primitives, but chaining still means arithmetic at the call site
(`at: title.span.end + 6`). Two tiny helpers would read better:

```ts
const title = TitleCard({ … });
const sub   = TextReveal({ at: after(title, 6), … });        // span.end + gap
const sfx   = onCues(pointer.cues.clicks, (c) => Layer.audio(click, { startFrame: c.frame }));
```

---

## 3. Code elegance

### 3.1 A missing `core/keys.ts`

The largest source of repetition is keyframe bookkeeping:

- `ascending()` is defined 8 times (Spotlight, CodeBlock, Terminal, ChatThread, TouchPoint,
  WordCycle, Meter, CardStack), **with two different behaviours**. Most pop earlier keys while
  the last one is `>=` the new frame, which silently drops keys if the input isn't already
  sorted. WordCycle de-duplicates by frame and then sorts. Spotlight's copy returns `[[0, 0]]`
  for empty input; the others return `[]`. This is the kind of divergence that turns into a
  bug when someone copies the wrong one.
- `round()` exists 6 times with precisions of 2, 3 and 4 decimals.
- `valueAt()` (sample a keyed track) exists in BeforeAfter and WordCycle.
- Per-node / per-prop accumulators are written three ways: LowerThird's
  `Map<node, Map<prop, keys>>`, CodeBlock's `Track` class
  ([code-block/plan.ts:82](src/code-block/plan.ts:82)), and Toasts' `springTrack`, which
  lives in a component but is re-exported from the package index.

Proposal: one module, unit-tested once.

```ts
// core/keys.ts
export class Track { to(start, end, value, ease?): this; set(frame, value): this; keys(): KeyframeTuple[] }
export class KeyBook {                       // node × prop → merged, sorted, one animate() per node
  key(node, prop, keys): this;
  track(node, prop, initial): Track;
  apply(): void;
}
export function ascending(keys): KeyframeTuple[];  // one rule: later key on the same frame wins, sorted
export function valueAt(keys, frame): number;      // matches the renderer, eases included
export const round = (v: number, places = 3) => …;
```

`springTrack` moves to `core/bake.ts` beside `springKeys`. LowerThird's 25-line accumulator
and its `prop as "x"` cast ([lower-third/index.ts:448](src/lower-third/index.ts:448)) become
`book.key(node, "y", …)` and `book.apply()`.

### 3.2 Color helpers

There are five hex parsers: `tint` (CodeBlock), a transparent-stop helper (Backdrop),
`withAlpha` (Selection), `mix` (Waveform) and `luminance` (theme). They disagree on non-hex
input. CodeBlock and Selection return the color unchanged, Waveform returns the first color,
and Backdrop returns `rgba(0,0,0,0)`. That last one means a theme using `rgb()` or `oklch()`
gets gradients that fade through black. A `core/color.ts` with `parse`, `withAlpha`, `mix`,
`transparent(c)`, `isLight` and the existing `contrastRatio`, accepting hex, `rgb[a]()` and
named colors, fixes the inconsistency and replaces the light/dark contrast checks in Annotate,
AppFrame and MousePointer.

### 3.3 `noUncheckedIndexedAccess` noise

Installed copies typecheck under strict user settings (good), but the cost is about 68
`as KeyframeTuple` / `as number` casts like `(out[out.length - 1] as KeyframeTuple)[0]`. Small
helpers (`last(arr)`, `pairs(arr)` for neighbouring keys), plus `for…of` / `entries()`, remove
most of them. The keyed props would also benefit from `LayerAnimation.keys` accepting
`AnimatableProp` (a string union) instead of needing the `as "x"` cast.

### 3.4 Shared layout helpers

`safeArea()` is duplicated in Captions and LowerThird, and the frame-size default is
duplicated ten times (2.3). A `core/layout.ts` with `safeArea(frame, area)`,
`anchorIn(rect, anchor)` and `fitText(measure, text, maxWidth)` covers them and gives future
components (Timeline, StatCard, BentoGrid) the same footing.

### 3.5 Big `build()` functions

| File | Lines | Has a pure `plan.ts` |
|---|---|---|
| text-reveal/index.ts | 1,134 | partly |
| mouse-pointer/index.ts | 785 | yes |
| chat-thread/index.ts | 736 | no |
| captions/index.ts | 659 | parse / phrases |
| app-frame/index.ts | 599 | no |
| code-block/index.ts | 557 | yes |

The split that works best here (MousePointer, Terminal, FocusZoom, Counter) is a pure planner
(props → timeline of plain data, tested without nodes) and a thin builder (timeline → nodes).
ChatThread (message timing, scroll positions, bubble rects), Toasts (stack solving) and
CardStack (slot poses per move) would read and test better that way. LowerThird's
four-way `switch` would read better as a `layouts` table of small functions returning
`{ plates, extras }`.

### 3.6 Smaller things

- **Hand-maintained lists.** `src/index.ts` (305 lines of re-exports) and the `cases` table in
  `ids.test.ts` have to be edited for every new component. A test that globs `*/index.ts` and
  checks each is exported and present in `ids.test.ts` makes forgetting impossible.
- **Magic ratios.** Geometry such as `padX = nameSize * 0.55` is reasonable but unexplained.
  CardStack's named `SHRINK` and LowerThird's `CAP_HEIGHT` are the pattern to follow.
- **Cue data shapes.** Cue payloads vary (`{ frame, index }`, `{ frame, end, text }`,
  `{ frame, point, target }`). That is fine, but the `end` convention for ranged cues should
  be written into `Cue`'s type (`RangeCue = Cue & { end: number }`), since `offsetCues` already
  special-cases it.
- **FocusZoom** is the only component without an `index.test.ts` (its planner is tested; the
  builder isn't).

---

## 4. Ten components that would add the most value

Scored with the §6 criteria (demand, leverage, foundation, hard by hand; 1–3 each). Four are
3D. None overlap the non-goals: charts are wrapped, not rebuilt, and there are no transitions
or whole-frame looks.

| # | Component | 3D | D | L | F | H | Total |
|---|---|---|---|---|---|---|---|
| A | Globe | ✓ | 3 | 3 | 2 | 3 | **11** |
| B | ProductTurntable | ✓ | 3 | 3 | 2 | 2 | **10** |
| C | PhysicsPile | ✓ | 2 | 3 | 3 | 3 | **11** |
| D | ExplodedStack (the `LayerDiagram` backlog item) | ✓ | 2 | 3 | 2 | 3 | **10** |
| E | Keystrokes | | 3 | 2 | 1 | 2 | 8 |
| F | Marquee | | 3 | 2 | 2 | 2 | 9 |
| G | StatCard | | 3 | 2 | 2 | 2 | 9 |
| H | Timeline | | 2 | 2 | 2 | 3 | 9 |
| I | BentoGrid | | 3 | 2 | 2 | 2 | 9 |
| J | Steps | | 2 | 1 | 1 | 2 | 6 |

Suggested waves: **4a** A, C, F, G (the two most distinctive 3D pieces, plus the two most
reused 2D ones); **4b** B, D, I, E; **4c** H, J.

### A. Globe (3D)

A lit globe with a dotted or flat land mask that rotates to bring each target city to the
front, draws great-circle arcs between them and pins labels. It's the SaaS "we're global" shot
and the travel-route explainer.

- **Props:** `stops: { at?, lat, lon, label? }[]`, `arcs: "chain" | "hub" | [from, to][]`,
  `land: "dots" | "solid" | image`, `atmosphere`, `tilt`, `radius`.
- **Cues:** `arrivals`, `arcs` (`{ frame, end }`), `pins`.
- **Engine use:** `Layer3D.sphere` with a land texture or instanced dots, `Path3D` arcs drawn
  on with `trimEnd`, light from `Lighting.studio`, a fresnel atmosphere as a slightly larger
  glass sphere. Rotation is solved offline as slerp between stop orientations and baked.
- **Host additions:** `sphere`, `path3d`, `light`.

### B. ProductTurntable (3D)

Any GLB / GLTF (or a built-in phone or laptop with a video screen slot) on a studio turntable,
with camera moves chosen by name: `orbit`, `hero` (low push-in), `reveal` (rise from
silhouette), `inspect` (stops at named angles).

- **Props:** `model: string | "phone" | "laptop"`, `screen?: media`, `shots: { at, move, to? }[]`,
  `environment`, `floor: "shadow" | "reflect" | false`.
- **Cues:** `shots`, `settles`.
- **Engine use:** `Layer.glb` / `Layer.gltf`, `Layer.environment`, a shadow catcher plane,
  `Layer.camera` keys baked with minimum-jerk easing, the same camera math as FocusZoom.
  This is DeviceFrame's real 3D version (its M8 deviation).
- **Host additions:** `model`, `camera`, `environment`.

### C. PhysicsPile (3D)

Words, logos or cards dropped, thrown or poured into a scene, where they collide and settle.
Example 28 builds this by hand with glass word cards. Frame-exact because Rapier runs
deterministically on the CPU.

- **Props:** `items: (string | media | { shape })[]`, `emit: "drop" | "throw" | "pour"`,
  `container: "floor" | "box" | "bowl"`, `material: "glass" | "matte" | "chrome"`, `gravity`,
  `seed`.
- **Cues:** `impacts` (`{ frame, index, strength }`, ready for SFX), `settled`.
- **Engine use:** `Physics.world` simulated offline and baked to per-body transforms,
  `Layer3D.roundedBox` / `extrudedText` bodies, glass materials. Impacts drive `pulseKeys` for
  camera shake or sound.
- **Host additions:** `physics` (step a world and return baked transforms), `roundedBox`.
  This also builds the bake-from-simulation foundation that a physics CardStack (an M8
  deviation) could reuse.

### D. ExplodedStack (3D)

The architecture-explainer shot: a stack of plates (layers of a product, a network stack, a
PCB) that separates in perspective, highlights one layer at a time with a leader-line label,
and collapses back.

- **Props:** `layers: { label, color?, content?: LayoutNode, height? }[]`,
  `focus: { at, layer }[]`, `gap`, `camera: "iso" | "front" | "orbit"`.
- **Cues:** `explode`, `focus`, `collapse`.
- **Engine use:** `Layer3D.roundedBox` plates with 2D content rendered onto their top faces,
  the Callout leader logic projected from 3D anchors, depth-of-field blur on unfocused plates.
- **Host additions:** `roundedBox`, `project(point3d) → [x, y]` for labels.

### E. Keystrokes

On-screen keyboard shortcuts (⌘ K, ⇧ ⌥ P, Ctrl C) as keycaps that press in sync with a
Terminal, CodeBlock or MousePointer. Every dev-tool demo needs this, and keeping the press
timing in sync by hand is fiddly.

- **Props:** `combos: { at, keys: string[] }[]`, `style: "caps" | "flat" | "minimal"`,
  `corner`, `size`.
- **Cues:** `presses`, `releases`.
- **Notes:** modifier glyphs (⌘ ⌥ ⇧ ⌃ ⏎ ⌫) are drawn as vector paths, since common fonts lack
  them (the same lesson as Terminal's drawn spinners). Keycaps use the elevation tokens (1.1)
  with a 2-frame press-down and spring-back. `fromTerminal(terminal.cues.keys)` maps an
  existing script to combos.

### F. Marquee

Loop-exact scrolling rows: the "trusted by" logo wall, a ticker of quotes, a band of
features. The loop period divides the scene, the same as Backdrop.

- **Props:** `rows: (string | media)[][]`, `speed`, `direction` per row, `gap`,
  `fade: "edges" | false`, `tilt` (perspective band), `pauseOn?: { at, index }[]`.
- **Cues:** `loops`, `pauses`.
- **Engine use:** measured text and media widths, a clip with a gradient edge matte, and
  Backdrop's whole-period loop keys. The fade matte reuses Spotlight's `host.matte`.

### G. StatCard

A KPI tile: label, a Counter value, a delta badge (▲ 12 % in `positive` / `negative`), and an
optional sparkline that draws on. The most-copied piece in data stories (example 23). It
*wraps* `Layer.chart`, as §1.2 allows.

- **Props:** `label`, `value`, `from?`, `format`, `delta?`, `spark?: number[]`,
  `layout: "tile" | "inline" | "hero"`.
- **Cues:** `counted`, `spark` (`{ frame, end }`).
- **Composes:** Counter, Meter (optional ring), `Layer.chart` line. Several StatCards drop
  straight into a BentoGrid.

### H. Timeline

Milestones along a horizontal or vertical line: the line draws on, dots pop as it reaches
them, dates and labels rise, and the camera pans when the line outgrows the frame. Roadmaps,
company history, "how it works" steps.

- **Props:** `events: { label, date?, body?, icon? }[]`,
  `orientation: "horizontal" | "vertical"`, `pace` (frames per event or `"even"`),
  `follow: boolean`.
- **Cues:** `reached` (`{ frame, index }`).
- **Engine use:** `drawOn` for the line, the per-event pacing that Annotate already does by
  stroke length, and FocusZoom's view-rect solver for `follow`.

### I. BentoGrid

A launch-film feature grid: tiles of different spans assemble in a staggered order, each with
an icon, title, short body and an optional slot (media, StatCard, any node), then focus moves
tile to tile.

- **Props:** `tiles: { span: [cols, rows], title, body?, icon?, content? }[]`, `columns`,
  `gap`, `order: StaggerOrder`, `focus?: { at, tile }[]`.
- **Cues:** `landed`, `focus`.
- **Engine use:** grid packing solved offline into rects (so every tile is a valid `Target`
  for MousePointer / Spotlight), `staggerRanks`, surface elevation, and the `tilt` preset per
  tile.

### J. Steps

A numbered checklist or onboarding flow: steps appear, the active one is emphasised, a
connecting line fills, and each completed step turns into a drawn check. Tutorials and setup
walkthroughs.

- **Props:** `steps: { title, body? }[]`, `active: { at, step }[]` or `every`,
  `layout: "list" | "row"`.
- **Cues:** `started`, `completed`.
- **Composes:** Toasts' drawn check, Meter's fill timing, LowerThird's plate slide. Low
  leverage on its own, but it's cheap and comes up constantly.

### Host growth these imply

The four 3D components share most of their needs: `sphere`, `roundedBox`, `model`, `camera`,
`light`, `environment`, `path3d`, `project`, and `physics` for C. Adding them in one
milestone keeps `host.ts` coherent and lets the tree-shake table budget the 3D path once. An
`AnimatableNode` for 3D containers already exists in framefields, so these would be thin
pass-throughs, like `extrudedText`.
