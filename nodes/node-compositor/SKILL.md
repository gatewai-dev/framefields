---
name: Compositor
nodeType: Compositor
summary: >
  Composes media inputs (Text, Image, SVG, Audio, Caption, Video, GIF, and Lottie) into a single
  image or video file with an HTML-like auto-layout engine. The composition document is a single
  recursive `layout` code tree (flex/block/box/text/media) with per-node keyframe animation —
  deterministic: identical pixels for the same document and frame, in preview AND final render.
triggers:
  - compositor
  - composite
  - layer
  - merge media
  - layout
  - flex
  - overlay
  - picture in picture
  - video layout
  - title card
---

# Compositor

## What It Does
Composes media inputs into a single image or video using a **layout code tree** — the ONE
source of truth for the composition. Agents author `config.layout`: a recursive tree of
layout nodes (`flex` / `block` / `box` / `text` / `media`) with HTML-like auto-layout
(`dir`, `gap`, `padding`, `justify`, `align`, `wrap`) and per-node keyframe animations.
Rendering is deterministic: `(document, frame) → pixels`, identical in preview and final render.

## When to Use
- **Title cards / hero layouts:** Flex stacks with title + subtitle text and box chips (see example below).
- **Overlays / Watermarks:** Absolute-positioned text or media over video/image backgrounds.
- **Picture-in-Picture:** Multiple videos/images arranged by a flex/block tree or absolute placement.
- **Timeline composition:** Per-node `startFrame` / `durationFrames` + keyframe tracks.
- **Visual styling:** Box fills + radius, text styling, shadows, keyframe motion.

## Inputs
This node uses **Variable Inputs**. You can add dynamically named input handles of the following types:
- `Text`
- `Image`
- `Video`
- `Audio`
- `Caption`
- `SVG`
- `GIF`
- `Lottie`
- `Signal`

## Config
| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| width | number | 1–4096 | 1080 | Canvas width in pixels. |
| height | number | 1–4096 | 1080 | Canvas height in pixels. |
| backgroundColor | string | Hex/RGB CSS Color | undefined | Background color of the compositor canvas. |
| volume | number | 0–1 | 1 | Overall master audio volume scaling. |
| fps | number | 1–120 | 24 | Frames per second for video output. |
| mode | string | `"Video"` or `"Image"` | `"Video"` | Explicitly configures compositor rendering/output mode. |
| layout | array | Array of Layout Nodes | `[]` | The composition document: a recursive tree of layout nodes. |

> **`type` vs `kind`:** `type` is an INPUT DataType (`Text`, `Image`, `Video`, `Audio`,
> `Caption`, `SVG`, `GIF`, `Lottie` …) and never appears on layout nodes. The layout type of
> a node is its **`kind`**: `flex` | `block` | `box` | `text` | `media` | `shape` | `chart`.

---

### Layout Node Schema
Common fields (every node):
- **`id`** (string, required): Unique node id — also keys the timeline.
- **`kind`** (string, required): `"flex"` | `"block"` | `"box"` | `"text"` | `"media"` | `"shape"` | `"chart"`.
- **`inputHandleId`** (string, optional): Graph binding — which connected input this node renders (for text/media nodes).
  > [!WARNING]
  > Do not place a handle label in `inputHandleId` when updating an existing live Compositor. The renderer may treat the media as unbound and produce a blank layer. Use the actual dynamic input handle ID returned from the live Compositor node.
- **`position`** (string, optional): `"relative"` (default, in-flow) or `"absolute"` (out-of-flow; placed by `x`/`y`).
- **`x` / `y`** (number, optional): Offset from the parent's content box (absolute placement / transform base).
- **`width` / `height`** (SizeSpec, optional): `number` (pixels), `"auto"` (content), `"fit"` (fit content), or `"fill"` (fill the parent). `block` defaults to `"fill"` width.
- **`grow`** (number, optional): Flex-grow weight — extra main-axis space is split proportionally.
- **`flexShrink`** (number, optional): Flex shrink factor (Yoga).
- **`flexBasis`** (number, optional): Flex basis in pixels.
- **`alignSelf`** (string, optional): Per-child cross-axis override (`"auto"` | `"start"` | `"center"` | `"end"` | `"stretch"` | `"baseline"`).
- **`aspectRatio`** (number, optional): Intrinsic aspect ratio (`width / height`).
- **`zIndex`** (number, optional, default 0): Stack order **within the same parent level**. Higher renders on top.
- **`hidden`** (boolean, optional): Skips drawing the node.
- **`opacity`** (number, optional, 0–1, default 1).
- **`blendMode`** (string, optional, default `"normal"`): Blend mode used when compositing the node (`"normal"`, `"multiply"`, `"screen"`, `"overlay"`, `"darken"`, `"lighten"`, `"color-dodge"`, `"color-burn"`, `"hard-light"`, `"soft-light"`, `"difference"`, `"exclusion"`, `"hue"`, `"saturation"`, `"color"`, `"luminosity"`, `"source-over"`, `"source-in"`, `"source-out"`, `"source-atop"`, `"destination-over"`, `"destination-in"`, `"destination-out"`, `"destination-atop"`, `"lighter"`, `"copy"`, `"mask-in"`, `"mask-out"`, `"xor"`).
- **`rotation`** (degrees) / **`scale`** (multiplier) / **`anchorX`**, **`anchorY`** (0–1): Node transform.
- **`rotateX`** / **`rotateY`** / **`rotateZ`** (degrees, default 0): 3D out-of-plane rotation (pitch, yaw, roll).
- **`perspective`** (number, px distance, default 0 = disabled): Virtual camera distance for 3D perspective foreshortening.
- **`translateZ`** (number, px depth, default 0): Translation along depth Z axis (moves closer/further under perspective).
- **`perspectiveOriginX`**, **`perspectiveOriginY`** (0–1, default 0.5): 3D perspective vanishing point anchor.
- **`backfaceVisibility`** (`"visible"` | `"hidden"`, default `"visible"`): When `"hidden"`, culls the layer when rotated > 90° away from the camera.
- **`transformStyle`** (`"flat"` | `"preserve-3d"`, default `"flat"`): 3D transform rendering style.
- **`startFrame`** / **`durationFrames`** (integer, optional): Node visibility window on the master timeline (frames).
- **`deflicker`** (object, optional): Temporal de-flickering and optical flow motion warping options (`blendWeight`, `disocclusionThreshold`, `searchRadius`).
- **`relighting`** / **`relight`** (object, optional): Screen-space 3D normal relighting options (`lightType`, `intensity`, `lightPosX`, `lightPosY`, `lightPosZ`, `lightRadius`, `specularStrength`, `roughness`, `metallic`, `ambientIntensity`, `depthScale`, `normalTexture`).
- **`effects`** (array, optional): Post-processing effect pipeline attached to the node (e.g. `Effect.deflicker()`, `Effect.relight3d()`).
- **`animation`** (object, optional): Track-based keyframes (§ Animation Schema).

Container styles (flex/block/box with children):
- **`dir`** (flex only): `"row"` (default) or `"column"`.
- **`gap`** (number): Space between children along the main axis.
- **`padding`** (number): Inset of the content box.
- **`justify`** (flex only): `start` (default) | `center` | `end` | `space-between` | `space-around`.
- **`align`** (flex/block): `start` (default) | `center` | `end` | `stretch`.
- **`wrap`** (flex only, boolean): Allow main-axis wrapping.
- **`overflow`** (`"hidden"` (default) | `"visible"`): Clip children to container bounds (`hidden`) or allow drawing outside (`visible`). A hidden container with a `borderRadius` clips to its rounded corners, animated radius and size included (an iris mask is a box closing its `width`, `height` and `borderRadius`).
- **`staggerFrames`** (number, optional, default 0): Automatic frame offset sequentially applied to child nodes.
- **`staggerDirection`** (`"forward"` | `"reverse"` | `"center-out"`, default `"forward"`): Traversal order when computing child stagger delays.

Per-kind fields:
- **`box`**: `background` (CSS color, also accepts gradients), `borderRadius` (number), `padding`. A `box` with children behaves like a column container.
- **`text`**: `text` (string), `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `fill` (text color), `align`, `verticalAlign`, `lineHeight`, `letterSpacing`, `textShadow`, `shadows`, `background` (rounded text box fill), `borderRadius`, `padding`.
  - **Kinetic Typography Animators (`animators`)**: Array of text animators applied sequentially at the Slug GPU glyph instancing stage:
    - `id` (string): Unique animator identifier.
    - `unit` (`"character"` | `"word"` | `"line"`, default `"character"`): Granularity of text breakdown.
    - `rangeStart` (number, 0–1, default 0): Normalized selector start bound.
    - `rangeEnd` (number, 0–1, default 1): Normalized selector end bound.
    - `offset` (number, -1 to 1, default 0): Normalized selection window phase offset (keyframeable via `offset`, `animatorOffset`, `rangeStart`, `rangeEnd`).
    - `ease` (string, default `"smoothstep"`): GSAP-style easing curve (`"power1"`, `"power2"`, `"power3"`, `"power4"`, `"sine"`, `"expo"`, `"back"`, `"smoothstep"`, `"linear"`).
    - `transform`: Property offsets applied to selected glyph units:
      - `deltaX` / `deltaY` (number): Spatial displacement in pixels.
      - `deltaRotation` (number, degrees): 2D in-plane rotation angle.
      - `deltaScale` (number, relative multiplier, e.g. -1 for full collapse to 0).
      - `scaleX` / `scaleY` (number, directional scale multiplier).
      - `rotationX` (number, degrees): 3D perspective flip squashing around the local glyph baseline.
      - `opacity` (number, absolute or relative alpha override).
      - `blur` (number): Gaussian blur radius.
- **`shape`**: Parametric vector shape and path primitive for motion graphics.
  - `shapeType` (`"rect"` | `"circle"` | `"ellipse"` | `"polygon"` | `"star"` | `"arrow"` | `"path"`, default `"rect"`).
  - Geometry: `borderRadius`, `radiusTL`, `radiusTR`, `radiusBR`, `radiusBL`, `polygonSides` (3..64), `starPoints` (3..64), `starInnerRadiusRatio` (0.01..0.99), `arrowHeadWidth`, `arrowHeadLength`, `arrowShaftWidth`, `d` (SVG path data: `M L H V C S Q T A Z`, absolute and relative; arcs included).
  - Fill: `fillType` (`"solid"` | `"linear"` | `"radial"` | `"none"`), `fillColor`, `gradientEndColor`, `gradientAngle`.
  - Stroke: `strokeColor`, `strokeWidth`, `strokeDashArray`, `strokeDashOffset`, `strokeLineCap` (`"butt"` | `"round"` | `"square"`), `strokeLineJoin` (`"miter"` | `"round"` | `"bevel"`), `strokeAlign` (`"inside"` | `"center"` | `"outside"`).
  - Trim Paths: `trimStart` (0..1), `trimEnd` (0..1), `trimOffset` (rotation/offset).
- **`chart`**: High-performance GPU-accelerated animated chart rendered headlessly with ChartGPU:
  - `chartOptions` (ChartGPUOptions, required): Options specifying theme, axes, and series (`line`, `area`, `bar`, `candlestick`, `ohlc`, `pie`, `heatmap`, `band`, `errorBar`, `impulse`, `pointCloud3d`, `surface3d`).
  - `progress` / `drawProgress` (number, 0–1, default 1): Timeline reveal progress for progressive write-on animations.
  - Supports 3D homography projection (`rotateX`, `rotateY`, `perspective`), border radius clipping, directional motion blur, and signal reactivity.
- **`media`**: `inputHandleId` (string, required — must match a connected input handle).
  - **Standard Media (`Video`, `Image`, `GIF`, `SVG`, `Lottie`)**: `fit` (`"cover"` | `"contain"` | `"fill"` | `"none"`, default `"contain"`), `volume` (0–1), `muted`, `borderRadius`, `borderColor`, `borderWidth`.
  - **Captions & Subtitles (`Caption` DataType)**: When bound to a `Caption` input (SRT source), `kind: "media"` renders time-synchronized subtitle cues:
    - `fontSize` (number, default `48`): Font size in pixels.
    - `fontFamily` (string, default `"Inter"`): Font family.
    - `fontWeight` (string | number, default `700`): Weight (`"normal"`, `"bold"`, `400`, `700`, `900`).
    - `fontStyle` (`"normal"` | `"italic"`).
    - `fill` (string, default `"#ffffff"`): Text color.
    - `align` (`"start"` | `"center"` | `"end"`, default `"center"`): Horizontal text alignment.
    - `verticalAlign` (`"top"` | `"middle"` | `"bottom"`, default `"bottom"`): Vertical alignment. When `"bottom"`, the bottom edge is anchored, and multi-line subtitle cues expand **upwards**.
    - `lineHeight` (number, default `1.2` or `fontSize * 1.2`).
    - `letterSpacing` (number, default `0`).
    - `background` (string, optional): Background box fill color behind the active subtitle text.
    - `padding` (number, optional): Inset padding around text.
    - `borderRadius` / `strokeRadius` (number, default `8`): Corner radius for background rectangle.
    - `stroke` (string) / `strokeWidth` (number): Text outline stroke.
    - `textShadow` / `shadows`: Drop shadows.
    - **Sizing & Placement**: An explicit `width` (e.g. `800` or `"80%"`) controls word-wrapping width. When `height` is omitted or `"auto"`, the engine measures the maximum height needed across all cues in the SRT file to keep layout and positioning stable throughout playback.

Layout semantics (HTML-like):
- A **flex** node with `dir: "column"` stacks children vertically; `dir: "row"` lays them horizontally.
- **block** behaves as a column container whose width fills the parent.
- **box** without children is a styled rectangle (fill + radius); with children it wraps them in a column.
- `"fill"`/`"fit"` sizes resolve against the containing block; `grow` splits leftover space.
- **absolute** nodes are removed from flow and placed at `x`/`y` of their parent's content box.
- **Text wraps**: an explicit numeric `width` wraps at that width. The node box always matches the drawn (wrapped) text.
- **Captions**: Render synchronized cues from connected SRT sources. Default to bottom alignment (`verticalAlign: "bottom"`), expanding earlier lines upwards when wrapping across multiple lines.
- **Canvas bounds**: the output is exactly `width`×`height`. Nodes may extend beyond it (large sizes, negative `x`/`y`) — anything outside the canvas is clipped in the output. Use `fit`/`contain`/`fill` and canvas-sized boxes for fully-visible media.

---

### Animation Schema (per node)
- **`tracks`** (array): Up to 24 animation tracks.
Each track represents animatable property modifications:
  - **`id`** (string, required): Unique identifier for the track.
  - **`prop`** (string, enum, required): `x`, `y`, `scale`, `rotation`, `opacity`, `fill`, `color`, `letterSpacing`, `width`, `height`, `volume`, `hidden`, `muted`, `fontSize`, `text`, `trimStart`, `trimEnd`, `trimOffset`, `strokeWidth`, `strokeDashOffset`, `cornerRadius`, `starInnerRadiusRatio`, `fillColor`, `strokeColor`, `rangeStart`, `rangeEnd`, `offset`, `animatorRangeStart`, `animatorRangeEnd`, `animatorOffset`, `rotateX`, `rotateY`, `rotateZ`, `perspective`, `translateZ`, `perspectiveOriginX`, `perspectiveOriginY`, `progress`, `drawProgress`, `chartProgress`.
  - **`source`** (object, optional, default `{ type: "keyframe" }`): Driver evaluating this track.
    - `{ type: "keyframe" }`: Keyframe sequence (requires `keyframes`).
    - `{ type: "signal", inputHandleId: string, multiplier?: number, offset?: number, smoothingWindowFrames?: number, signalMode?: "continuous" | "accumulate", threshold?: number, debounceFrames?: number, colorMode?: "interpolate" | "hueRotate" | "threshold", colorA?: string, colorB?: string, colorThreshold?: number }`: Samples a connected `Signal` variable input handle (e.g. from `AudioSignalExtractor` or `SignalMath`). In `"continuous"` mode, maps amplitude or continuous values directly. In `"accumulate"` mode, acts as a discrete event integrator that detects rising-edge acoustic transients/peaks exceeding `threshold` (with `debounceFrames` guard) and increments an integer step count on each peak — ideal for audio-reactive typography where each keystroke/drum hit reveals letters sequentially. Also supports dynamic color properties (`fill`, `color`) via linear interpolation, hue rotation, or binary threshold switching. Aliases `handleId` (for `inputHandleId`), `amplitude` (for `multiplier`), and `smoothing` (for `smoothingWindowFrames`) are also accepted. For procedural drivers like `signal`, `keyframes: []` can be empty.
    - `{ type: "wiggle", frequency: number, octaves?: number, amplitude: number, offset?: number, seed?: number }`: Multi-octave continuous coherent gradient noise.
    - `{ type: "springOvershoot", mass?: number, stiffness?: number, damping?: number, initialVelocity?: number, targetValue?: number }`: Analytical closed-form damped harmonic oscillator ODE.
  - **`keyframes`** (array, optional when procedural `source` is used): Chronologically sorted keyframe points.
  - **`repeat`** (number, optional): GSAP loop count (e.g., -1 for infinite loops).
  - **`yoyo`** (boolean, optional): If true, animates back and forth.

#### Keyframe Schema:
  - **`id`** (string, required): Unique keyframe identifier.
  - **`frame`** (number, required): Clip-relative frame number where this keyframe is reached (`0` = node start).
  - **`value`** (number or boolean, required): Target value at this keyframe.
  - **`ease`** (object, optional): Segment easing parameters.
    - **`name`**: `none`, `power1`, `power2`, `power3`, `sine`, `circ`, `expo`, `back`, `elastic`, `bounce`, `spring`, `cubic`, `hold`.
    - **`dir`**: `in`, `out`, `inOut`.
    - **`params`** (array of numbers): Optional easing parameter overrides (e.g. `back.out(1.7)`).
    - **`cubicParams`** (array of 4 numbers, optional): Control points `[x1, y1, x2, y2]` when `name: "cubic"`.
  - **`spatialTangentIn`** (array of 2 numbers `[dx, dy]`, optional): Ingoing spatial tangent handle for 2D position spline trajectories.
  - **`spatialTangentOut`** (array of 2 numbers `[dx, dy]`, optional): Outgoing spatial tangent handle for 2D position spline trajectories.

---

### Ordering / Z-Index
- Within each parent level, nodes draw in ascending `zIndex` (default `0`).
- The tree order (children array order) is the layout order; `zIndex` only breaks ties within a level.

## Output
| Handle | Type | Description |
|--------|------|-------------|
| Result | Image, Video | The final rendered composite media file. |

## Common Patterns
- **Title card:** one `flex` column (`align: "center"`, `pad`, `fill`) containing title `text`, subtitle `text`, and a `flex` row of `box` chips with `media` avatars. Animate the column's `opacity`, the row's `y`, and a media node's `scale` with keyframe tracks.
- **Video Subtitles / Captions:** Add a dynamic `Caption` input handle (e.g. `"subtitles"`). In the layout tree, place a `media` node bound to `"subtitles"` with `width: 900`, `fill: "#ffffff"`, `fontSize: 44`, `align: "center"`, `verticalAlign: "bottom"`, and place it near the bottom of the canvas (e.g. `x: 90`, `y: 880` or in a bottom-aligned flex container).
- **Watermarking a Video:** a `flex` row (`align: "end"`, `justify: "end"`, full canvas) containing a `media` node bound to the PNG input; low `opacity`.
- **Picture-in-Picture:** a `flex` row with two `media` nodes (`fit: "cover"`, each `grow: 1`).
- **Audio-Reactive 3D Models:** a `kind: "model3d"` node loading an OBJ/FBX/GLTF/STL/PLY mesh with `audioDeform: { audioTrackId, mode: "normal_extrusion" | "radial_pulse" | "harmonic_wave" | "twist" | "ripple", amplitudeMultiplier, damping }`, deformed directly in VRAM via WebGPU compute shaders driven by audio frequency spectra and transient energies. `twist` turns each slice about Y by its height (harder on the bass); `ripple` runs concentric waves across XY, struck by the drums. `audioTrackId` may be an audio layer's id or an audio file path.
- **glTF scenes:** a glTF/GLB `model3d` keeps its node hierarchy, every skin and its animation clips (translation, rotation, scale; linear, step and cubic-spline). Skinned meshes are posed per frame from the clip (`animationName`, `animationTime`/`animationProgress`, `loop`); base-colour textures (with mipmaps), alpha `MASK`/`BLEND` and VRM MToon materials (`material: "toon"`, picked automatically when `material` is unset) render as authored. `center`/`normalizeSize` apply above the scene graph, so skinning stays intact.

## Don't Forget
- If text rendering required, you must include a font in spec (CLI TOOL only). By default emoji font is not loaded. NotoColorEmoji seems to be working well. Try to use NotoColorEmoji as default font for emojis.
- The `layout` tree IS the composition — there is no other layer model. Every **media** node
  needs a valid `inputHandleId` matching a connected input, and every node needs a `kind`.
- `type` is an input DataType — never put it on layout nodes; use `kind`.
- Connected inputs do NOT render automatically — build the tree explicitly.
- **Static Image Compositions:** When outputting static ad banners, posters, or graphics, set `"mode": "Image"` and ensure all connected filter nodes (such as `FilmGrain`) are configured statically (`animated: false`). Do NOT insert `ExtractFrame` nodes for static image compositions — connect `Compositor` directly to `Export`.

## Live Canvas Authoring vs. Offline CLI/Spec Compilation
Understanding how `inputHandleId` resolves is critical depending on the authoring environment:

- **Live Canvas Authoring:**
  - You must use the **actual dynamic input handle ID** returned after creating/inspecting the Compositor node (e.g. `input_abc123`).
  - **Never use handle labels here.** Live runtime lookups query inputs directly by their exact handle IDs.
- **Offline CLI / Spec Compilation:**
  - A **human-readable handle label** (e.g. `"bg_canvas_handle"`) may be used in `inputHandleId`.
  - The Artifex runner automatically resolves and maps these human-readable labels to internal generated IDs (`temp-xxxx`) during graph compilation.
  - This mapping is recursively applied to matching dynamic input labels in root configuration properties and Compositor `layout` tree elements (`inputHandleId`).

> [!WARNING]
> **Live Canvas Warning:** Do not place a handle label in `inputHandleId` when updating an existing live Compositor. The renderer may treat the media as unbound and produce a blank layer.

---

## Verification Checklist
When authoring or modifying a Compositor configuration, verify:
1. **Confirm the graph edge exists:** The upstream source node is connected to the corresponding dynamic input handle on the Compositor.
2. **Confirm the layout contains a media node:** A `kind: "media"` (or `kind: "text"`) node is explicitly declared in `config.layout`.
3. **Confirm its binding matches the live Compositor input:** The `inputHandleId` matches the live dynamic input handle ID (or human-readable handle label if building an offline CLI spec).
4. **Preview a frame where opacity is greater than zero:** Check an active playback frame where `opacity > 0`, `hidden` is not `true`, and the frame falls within `startFrame` and `durationFrames`.

---

## Troubleshooting: Blank Output or Missing Layers
If a layer or the final composite renders blank, check the following common failure modes:

- **Missing media node:** The upstream node is connected in the graph canvas, but no `kind: "media"` element exists in `config.layout`. Inputs do not render automatically without a layout node.
- **Stale or incorrect input binding:** `inputHandleId` references a non-existent handle, uses a human-readable label in live canvas mode instead of the real handle ID, or refers to a deleted/renamed handle. The renderer treats unbound media as empty.
- **Zero opacity:** The node's `opacity` is `0`, a parent container's `opacity` is `0`, or an animation track interpolates `opacity` to `0` at the inspected frame.
- **Timeline outside `startFrame`/`durationFrames`:** The current frame is outside the active clip range (`frame < startFrame` or `frame >= startFrame + durationFrames`).
- **Layer outside canvas bounds:** Absolute coordinates (`x`, `y`), padding/offsets, or transforms place the layer completely outside the canvas `width`×`height`, or `scale` is `0`.
- **Hidden node or invalid dimensions:** `hidden: true` is set, or `width`/`height` evaluates to `0` with no intrinsic media dimensions available.

---

## Example JSON Configuration
```json
{
  "width": 1920,
  "height": 1080,
  "backgroundColor": "#16130d",
  "fps": 24,
  "mode": "Video",
  "layout": [
    {
      "id": "hero",
      "kind": "flex",
      "dir": "column",
      "gap": 24,
      "padding": 80,
      "align": "center",
      "width": "fill",
      "height": "fill",
      "animation": {
        "tracks": [
          {
            "id": "hero-fade",
            "prop": "opacity",
            "keyframes": [
              { "id": "kf0", "frame": 0, "value": 0 },
              { "id": "kf1", "frame": 15, "value": 1, "ease": { "name": "power2", "dir": "out" } }
            ]
          }
        ]
      },
      "children": [
        {
          "id": "title",
          "kind": "text",
          "text": "Big Title",
          "fontSize": 96,
          "fontWeight": 900,
          "fill": "#f4ead8"
        },
        {
          "id": "subtitle",
          "kind": "text",
          "text": "Rendered by the compositor layout engine",
          "fontSize": 40,
          "fill": "#b8a88a"
        },
        {
          "id": "badges",
          "kind": "flex",
          "dir": "row",
          "gap": 16,
          "animation": {
            "tracks": [
              {
                "id": "badges-rise",
                "prop": "y",
                "keyframes": [
                  { "id": "kf0", "frame": 0, "value": 40 },
                  { "id": "kf1", "frame": 20, "value": 0, "ease": { "name": "back", "dir": "out" } }
                ]
              }
            ]
          },
          "children": [
            { "id": "chip-avatar", "kind": "box", "width": 160, "height": 48, "borderRadius": 24, "background": "#3a2f1e" },
            { "id": "chip-hero", "kind": "box", "width": 160, "height": 48, "borderRadius": 24, "background": "#3a2f1e" }
          ]
        }
      ]
    },
    {
      "id": "avatar-img",
      "kind": "media",
      "inputHandleId": "avatar",
      "fit": "cover",
      "width": 200,
      "height": 200,
      "borderRadius": 100,
      "startFrame": 0,
      "durationFrames": 72,
      "animation": {
        "tracks": [
          {
            "id": "avatar-pop",
            "prop": "scale",
            "keyframes": [
              { "id": "kf0", "frame": 0, "value": 1.15 },
              { "id": "kf1", "frame": 30, "value": 1 }
            ]
          }
        ]
      }
    },
    {
      "id": "subtitles",
      "kind": "media",
      "inputHandleId": "subtitles_handle",
      "position": "absolute",
      "x": 160,
      "y": 860,
      "width": 1600,
      "fontSize": 48,
      "fontWeight": 700,
      "fill": "#ffffff",
      "align": "center",
      "verticalAlign": "bottom",
      "stroke": "#000000",
      "strokeWidth": 4,
      "background": "#00000088",
      "padding": 16,
      "borderRadius": 12
    }
  ]
}
```