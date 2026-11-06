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

When a video layer uses a cached clip-vision matte, the source frame's mask is authoritative: a known absent subject renders empty rather than holding an earlier silhouette. Prompted SAM clip mattes require matching source aspect ratio; apply layout cropping after source-space matting rather than silently detecting another subject.

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
> a node is its **`kind`**: `flex` | `block` | `box` | `text` | `media` | `shape` | `chart` | `model3d` | `camera` | `light`.

---

### Layout Node Schema
Common fields (every node):
- **`id`** (string, required): Unique node id — also keys the timeline.
- **`kind`** (string, required): `"flex"` | `"block"` | `"box"` | `"text"` | `"media"` | `"shape"` | `"model3d"` | `"camera"` | `"light"`.
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
- **`overflow`** (`"visible"` (default) | `"hidden"`): Children draw past the container's edges unless it is `hidden`, which clips them to its bounds (a rounded card that must keep a square header or image inside its corners needs `hidden`). A text node's own outside stroke and shadows are never cut at its box. A hidden container with a `borderRadius` clips to its rounded corners, animated radius and size included (an iris mask is a box closing its `width`, `height` and `borderRadius`).
- **`staggerFrames`** (number, optional, default 0): Automatic frame offset sequentially applied to child nodes.
- **`staggerDirection`** (`"forward"` | `"reverse"` | `"center-out"`, default `"forward"`): Traversal order when computing child stagger delays.

Per-kind fields:
- **`box`**: `background` (CSS color, also accepts gradients), `borderRadius` (number), `padding`. A `box` with children behaves like a column container.
- **`text`**: `text` (string), `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `fill` (text color), `align` (`start`/`end` follow the text direction), `direction` (`auto` default | `ltr` | `rtl`: paragraph base direction; `auto` takes it from the first strong character, so Arabic/Hebrew/Persian read right to left, with mixed Latin and numbers kept in order), `verticalAlign` (`top` default | `middle` | `bottom`: places the text block in a `height` taller than it; ignored for path text), `lineHeight`, `letterSpacing`, `textShadow`, `shadows`, `background` (rounded text box fill), `borderRadius`, `padding`.
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
- **Charts**: there is no chart node kind. `Layer.chart` in the `framefields` SDK expands a chart into `box`, `shape` (`"path"`/`"circle"`) and `text` nodes, so a program document describes a chart with those kinds.
- **`media`**: `inputHandleId` (string, required — must match a connected input handle).
  - **Standard Media (`Video`, `Image`, `GIF`, `SVG`, `Lottie`)**: `fit` (`"cover"` | `"contain"` | `"fill"` | `"none"`, default `"contain"`), `volume` (0–1), `muted`, `borderRadius`, `borderColor`, `borderWidth`.
  - **Video and audio timing**: `timeRemap` maps layer-local frames to source seconds, with an explicit `durationFrames`. Use `{ kind: "rate", sourceStartSec, rate }` with a nonzero rate (negative plays in reverse), or `{ kind: "keyframes", keyframes: [{ frame, sourceSec, interpolation? }, ...] }`. Keyframes span frame 0 through `durationFrames` and increase by frame; source time may increase, decrease, or hold. `interpolation` on the starting key applies to the following segment: `linear`, `ease-in`, `ease-out`, or `smooth`; all are monotonic. Or `{ kind: "signal", mode: "speed" | "source-time", signal, sourceStartSec? }`: a signal instance or a named program signal read at each layer frame boundary on the composition clock (`speed` is integrated from `sourceStartSec`); it is sampled at compile time unless the host records it live. Equal source times hold video and silence audio. Rate changes alter audio pitch. Do not combine with `trimStartSec`; effects retain the composition clock.
  - **Captions & Subtitles (`Caption` DataType)**: When bound to a `Caption` input (SRT source), `kind: "media"` renders time-synchronized subtitle cues:
    - `fontSize` (number, default `48`): Font size in pixels.
    - `fontFamily` (string, default `"Inter"`): Font family.
    - `fontWeight` (string | number, default `700`): Weight (`"normal"`, `"bold"`, `400`, `700`, `900`).
    - `fontStyle` (`"normal"` | `"italic"`).
    - `fill` (string, default `"#ffffff"`): Text color.
    - `align` (`"start"` | `"center"` | `"end"`, default `"center"`): Horizontal text alignment.
    - `direction` (`"auto"` | `"ltr"` | `"rtl"`, default `"auto"`): Caption text direction; `start`/`end` follow it.
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
  - **`prop`** (string, enum, required): `x`, `y`, `scale`, `rotation`, `opacity`, `fill`, `color`, `letterSpacing`, `width`, `height`, `volume`, `hidden`, `muted`, `fontSize`, `text`, `trimStart`, `trimEnd`, `trimOffset`, `strokeWidth`, `strokeDashOffset`, `cornerRadius`, `starInnerRadiusRatio`, `fillColor`, `strokeColor`, `rangeStart`, `rangeEnd`, `offset`, `animatorRangeStart`, `animatorRangeEnd`, `animatorOffset`, `rotateX`, `rotateY`, `rotateZ`, `perspective`, `translateZ`, `perspectiveOriginX`, `perspectiveOriginY`, `progress`, `drawProgress`, `chartProgress`, `volumetricFogDensity`, `volumetricFogAnisotropy`, `volumetricFogNoiseStrength`, `emissive`, `emissiveIntensity`, `clearcoat`, `clearcoatRoughness`, `anisotropy`, `anisotropyRotation`, `subsurface`, `subsurfaceColor`, `sheen`, `sheenColor`, `sheenRoughness`, `iridescence`, `iridescenceThickness`, `iridescenceIor`, `triplanarScale`, `triplanarSharpness`.
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
- **Several 3D scenes:** a `box`/`flex`/`block` with a numeric `width` and `height` that holds a `camera` and the layers it films renders as its own scene (one holding only a camera stays a shot in a camera cut list): a nested composition with only its own camera, lights and environment, on its own clock (children start from the box's frame 0), placed in its parent like a media layer. Its effects run over the finished scene, and without a window of its own it lasts its parent's. Transitions, opacity and mattes on the box then blend finished pictures. Without that, every 3D layer shares one world and the active camera (the latest to start).
- **3D scene capacity:** direct lights and skin joints use dynamically sized GPU storage; `directional`, `spot`, `rect` (1 layer each), and `point` lights (6 cube-face layers) can each cast shadows, up to the device texture-array layer limit.
- **Rect Area Lights (`lightType: "rect"`):** rectangular softbox/panel area lights (`width`, `height`, `twoSided`, `rotation`, `x/y/z`, `targetX/Y/Z`) use solid-angle subtended diffuse irradiance and Karis representative-point GGX specular shading, and can cast perspective frustum shadows (`castShadow: true`).
- **Volumetric Fog & Light Shafts (`volumetricFog` in `environment`):** `kind: "light"` with `lightType: "environment"` and `volumetricFog: true | { density, anisotropy, heightFalloff, baseHeight, color, lightIntensity, ambientIntensity, maxDistance, steps, noise: { scale, strength, speed, octaves } }` runs half-resolution raymarching with Interleaved Gradient Noise jitter, Henyey-Greenstein phase scattering, 3D FBM wind-animated density noise, and multi-light shadow-map sampling (carving god rays behind shadow casters), followed by depth-aware bilateral upsampling. `volumetricFogDensity`, `volumetricFogAnisotropy`, and `volumetricFogNoiseStrength` can be animated or driven by `Signal`s.
- **Substrate multi-lobe materials:** physical-shading surfaces (any scene with an `environment` light) on `model3d` nodes, 3D cards and 3D text accept extra lobes on top of `roughness`/`metallic`: `clearcoat` 0..1 + `clearcoatRoughness` (default 0.08; IOR 1.5 GGX varnish that attenuates the base), `anisotropy` -1..1 + `anisotropyRotation` degrees (tangent-space anisotropic GGX: brushed metal, satin), `subsurface` 0..1 + `subsurfaceColor` (default `#ff6b4a`; wrap diffuse, terminator bleed and back-lit transmission), `sheen` 0..1 + `sheenColor` + `sheenRoughness` (default 0.5; Charlie cloth/velvet lobe), `iridescence` 0..1 or `{ intensity, thickness, ior }` + `iridescenceThickness` nm (100..1200, default 400) + `iridescenceIor` (default 1.3; RGB thin-film interference), and `triplanar: true | { scale, sharpness }` + `triplanarScale` (repeats per 256 world px) + `triplanarSharpness` (1..16, default 4) for world-space UV-less texture projection. All numeric lobe props are animatable.
- **HDRI environments:** an environment light's `hdri` takes an equirectangular panorama: a Radiance `.hdr` (RGBE) or OpenEXR `.exr` file path (resolved from the working directory) or the file's bytes (told apart by magic bytes); it then replaces the procedural preset as the image-based light for reflections and ambient, honoring `intensity`, `rotation` and `exposure`. On first use per device a compute pass prefilters it into a GGX radiance cubemap (faces up to 256², one mip per roughness step, split-sum importance sampling) for reflections, and the CPU projects it onto L2 spherical harmonics for diffuse irradiance; both are cached (up to 8 panoramas per device, least recently used destroyed). `.exr` reads single-part scanline or tiled files (level 0 of mip/ripmaps) with NONE, RLE, ZIPS, ZIP, PIZ or PXR24 compression and HALF/FLOAT/UINT `R`,`G`,`B` (or `Y`) channels; lossy B44/B44A/DWAA/DWAB/HTJ2K, deep and multi-part files fail with an error naming the cause.
- **Screen-space reflections & GI (`ssr`, `gi` in `environment`):** `ssr: true | { intensity (0..1, default 0.85), maxRoughness (0..1, 0.6), thickness (world px, 120), steps (16..64, 32) }` makes glossy physical surfaces reflect whatever the camera sees (walls, curved metal, emissives off the floor plane); `gi: true | { intensity (0..4, 1), radius (world px, 400), samples (4..16, 6) }` adds ambient occlusion and one diffuse bounce of visible light (color bleeding from neon and lit walls). Either one renders the 3D scene twice: a radiance pass, then Hi-Z reflection tracing and a horizon-scan GI gather (bilateral-denoised) on it, then the shading pass, which swaps each surface's environment reflection for the traced one (glossy ones read a blurred radiance pyramid matching their lobe, so output is noise-free and identical every frame) and occludes its ambient light before tone mapping and fog. Screen-space limits apply: anything off screen or hidden behind other geometry reflects the environment instead; the planar `floor` reflection is unaffected. Needs physical shading; non-physical (legacy, toon) surfaces ignore it.
- **Procedural geometry (`primitive3d.type: "terrain" | "sdf"`):** terrain is a seeded fractal heightfield (`noise: { seed, scale px, octaves, persistence, lacunarity, ridgeMode: "fbm" | "ridged" | "terrace", terraceSteps }`, or `heights` 0..1 on the `(segments + 1)²` grid), `height` px of relief above the node's y (up is -y), optional `overhangWarp` px, `colorByElevation { lowColor, midColor?, highColor, cliffColor?, cliffThreshold, bands }` as vertex colors, closed into a block `base` px thick. `sdf` combines `primitives` (sphere, box, cylinder, capsule, torus, gyroid; `op` union / subtract / intersect, `smoothness` px, `center`, `rotation`, `color`) clipped to `bounds` and meshes them watertight with Surface Nets (`resolution` 16..160 cells). Both are strictly validated and rebuilt from the spec when `modelData` is lost.
- **Scatter (`scatter3d` on an `instances3d` node):** `{ surface: <model node spec>, count, minDistance, seed, slopeRange deg, elevationRange 0..1, alignToNormal, scaleRange, randomYaw, exclude: [{ x, z, radius, falloff }], sink }`. The compositor loads the surface (primitive, in-memory or file), samples it by area once (cached) and seats each instance on its variant's base; instance i draws variant i % n, in the variant's own material color under the node tint.
- **Wind (`wind` on any model node):** `{ amplitudeDeg (8), frequency Hz (0.4), direction [x, z], waveScale px (600) }` bends vertices downwind in the vertex shader by height above the mesh base (instances sway out of phase along a traveling wave); deterministic per frame, shadows included.
- **Texture layers (`textureLayer: { node }` on a model):** hoisted like a matte to a sibling with `textureOf`, drawn alone each frame (video plays), then bound as the base-color texture of every mesh the model queues, read through its rect in that picture (`uvRect`); without its own geometry it fills the frame (the whole UV square).
- **Art-directed 3D lighting:** `material: "toon"` on meshes, flat 3D cards and native 3D text uses the shared direct lights, colors, point/spot attenuation, cast shadows, environment fog and tone mapping. Optional `toon: { shadowColor, lightColor, threshold, softness, diffuse }` controls the shadow/lit albedo multipliers, terminator cosine/width and Lambert modelling (defaults: model shade color or `#80808c`, white, 0.075, 0.25, 0). Lit/physical materials retain their own shading.
- **Cube cameras:** a camera whose `lens.projection` is `"equirectangular"` or `"fisheye"`, or that has `relativity`, draws the scene as six 90° faces into a mipmapped cube (`cubeFaceCameras`, layer order +X −X +Y −Y +Z −Z; the right-handed view and left-handed cube sampling differ by a z reflection, `CUBE_FLIP`) and `Renderer3D.remapLens` turns it into the output picture. Each face gets its own floor reflection, outline pass (ink width rescaled to the output's density at the view centre) and volumetric fog; shadows are drawn once; bloom reads the remapped radiance. Screen-space reflections and GI and motion blur need one perspective screen, so with a cube camera they throw, like depth of field. `relativity` aberrates every ray (`cos θ = (cos θ' − β)/(1 − β cos θ')`) and applies a spectral Doppler/beaming matrix tabulated in ln D. Glass gets no 2D backdrop.
- **Geometry outlines:** an environment light's optional `outlines: true | { color, width, referenceHeight, creaseAngle, depthThreshold, opacity }` runs a depth/normal ink pass before camera depth blur and bloom (defaults: `#16131c`, 1.5 px at height 1080, 45°, 0.01, 1). It reuses the linear-depth attachment's spare channels for octahedral surface normals and outline participation. Inverse-depth curvature avoids false contours on perspective planes; normal discontinuities find creases without inking texture/shadow/triangulation seams. `outline: false` on a layer/model opts out while retaining depth occlusion; `creaseAngle: 180` disables creases. Ink fades into the environment fog. 3D `anchorX/Y` pivots remain fixed under scale/rotation and leave identity placement unchanged.
  With MSAA enabled, retain original scene color and geometry samples and shade ink per sample before resolving color. A single-sample ink pass after the scene resolve loses subpixel coverage between outlined surfaces. Lens blur uses a separate nearest-sample geometry resolve. The scene's geometry is still drawn once.
- **Transparent meshes:** glTF `BLEND` materials and meshes with reduced layer, material, tint, or vertex alpha draw after opaque items, back to front by the camera-space center of each mesh’s transformed bounds, without writing depth. This is object-level sorting: intersecting meshes, self-overlap, skinned/deformed bounds, translucent flat layers, glass, and transparent shadows have separate limitations.
- **Mesh wireframe:** `wireframe: true` on a `model3d` draws triangle edges as one-pixel lines, including triangulation and back edges; it also applies to skinned and audio-deformed meshes and their shadows.
- **glTF scenes:** a glTF/GLB `model3d` keeps its node hierarchy, every skin and its animation clips (translation, rotation, scale and morph weights; linear, step and cubic-spline). Draco and meshopt compressed geometry and all seven core primitive modes are supported; per-map UV sets and texture transforms are independent. Basis KTX2 (ETC1S/UASTC) textures transcode offline to RGBA8 with their mip levels. Unsupported required extensions fail clearly. Morph targets run on the GPU before skinning and audio deformation. Skinned meshes are posed per frame from the clip (`animationName`, `animationTime`/`animationProgress`, `loop`); base-colour textures (with mipmaps), alpha `MASK`/`BLEND` and VRM MToon materials (`material: "toon"`, picked automatically when `material` is unset) render as authored. `center`/`normalizeSize` apply above the scene graph, so skinning stays intact.
- **Procedural Shards (`Layer3D.shard`):** Procedural polyhedron primitive generated by Sutherland-Hodgman convex half-space clipping against Fibonacci lattice normals with PCG jitter. Faceted flat normals, automatic planar UVs, Rapier 3D convex hull collision.
- **Character rigs (`animationLayers`, `ik`, `lookAt`, `springBones` on a glTF `model3d`):** clips blend in order from the rest pose, each over the pose beneath by `weight` (number, `[[frame, w]]` keys, or `(frame) => w` in process), slerped per joint and restricted to `mask` joints and their descendants; `speed`, `timeOffset`, `loop` per layer. Then `lookAt` (joint `axis`, default glTF +z, clamped to `maxAngleDeg`) and analytic two-bone `ik` (`chain: [root, mid, effector]`, `poleTarget` sets the bend side); targets are scene coordinates (point, keys or function) mapped into model space through the model's transform. `springBones` (each root's chain down its first child; `stiffness`, `damping`, scene `gravity`) are Verlet-simulated from frame 0 and cached per layer, so frames come out the same in any order. A node without these keeps the single-clip path.
- **Joint poses and aims (`pose`, `aim` on a glTF `model3d`):** after clip layers, `pose` (joint name → Euler degrees Z·Y·X and offsets, `additive` over the animated pose or from `rest`, weighted) then `aim` (bone toward its first child, or `axis`, swung onto a scene direction mapped into model space) run before look-at and IK. Joint names match exactly, else without a namespace prefix and case. Every number in `pose`, `aim`, `ik`, `lookAt` and clip weights is a track (number, keys, function, or a signal read with the render's clock); points take one track per axis. Readers are shared with the SDK (`numberAt` / `vec3At` in `compositions/program/track-sampler.ts`).
- **Skinned crowds (`crowd` on an instances node):** `{ clips, fps (30), seed, speedRange, phase: "random" | "sync" }`; each mesh of each variant model bakes its joint matrices (or its node matrix, for rigid node meshes) for every clip once (`count + 1` samples per loop) into a GPU palette; instances take a second record (clip range, phase, playback rate) and skin in the vertex shader, interpolating two baked samples. Per instance `clip`, `animOffset`, `animSpeed` override the seeded defaults. One draw call per mesh, shadows included. Instance (and scatter) variants apply their own node `rotateX/Y/Z` and `scale` under each instance's transform.
- **Voronoi destruction (`fracture3d` on a model node):** `{ cells, seed, impactPoint (object space), interiorColor, interiorRoughness, track }`. The compositor fractures the loaded source model (`fractureModel`, cached per model and spec) into one rigidly skinned mesh (a joint per piece), then poses the joints from `track` (x, y, z, qx, qy, qz, qw per piece per frame, in the layer's parent space, as physics reads its x/y/z): node matrix L⁻¹ · T(p) · R(q) · S, with L the layer's own prop matrix, so pieces stay in their 3D group. While every piece is still at its frame-0 pose (or there is no track) it draws in the exact rest pose with the cut faces skipped, so the whole layer is sealed (a cut face can otherwise tie the surface's depth where pieces meet).
- **Shutter motion blur (`motionBlur` on the camera):** after the color pass (and fog, DoF), the queued meshes and planes are drawn again into a velocity target, with this and the previous frame's model matrices, skinning, instance records and deformed vertices (morphs, audio deformation; GPU copies), wind and crowd time, and this and the previous camera. Slug text planes draw per-glyph velocity from copied glyph records. Then the scene is blurred (tile max, neighbor max, gather) before bloom. Previous state lives in a per-render motion history keyed by node id and item index. When frame f - 1 is missing, the compositor first renders it with `motionHistoryOnly` (3D passes only record; meshes still deform, and every layer in the 3D scene, including ones placed by `z` alone, is recorded), so output does not depend on render order.
- **Automatic mesh instancing:** consecutive opaque draws of the same shared mesh with matching material state use one GPU draw with per-object model and normal matrices. Transparent, skinned, morphed, audio-deformed and glass meshes retain separate draws; shadows retain their individual draw submissions.
- **Instanced 3D Meshes (`instances3d`):** `kind: "model3d"` with `instances3d` renders hundreds or thousands of mesh instances in 1 GPU draw call (`drawIndexed(indexCount, instanceCount)`). Supports single or multi-mesh variants with round-robin or variant indexing, dynamic per-instance transforms, and per-instance emissive / color modulation. In `framefields`, created with `Layer3D.instances({ count, mesh, instanceAt, bodies, emissiveBySpeed })`.
- **GPU 3D Swarms (`swarm3d`):** `kind: "model3d"` with `swarm3d` runs continuous 3D particle simulation in a WebGPU compute shader with 3D curl noise, 3D vortex fields (`swirl`, `pull`, `axial`), ground plane collisions with Coulomb sliding friction and rotational roll torque, and kinetic heat accumulation/cooling, packing directly into GPU instance buffers.
- **Scaled 2D layers stay sharp:** a `text`, `shape` or `media` node rasterizes at its scale on the canvas (an ancestor's `scale` included), up to 4× and within the GPU's texture size, so zooming into a layout shows crisp glyphs and edges; borders follow. Its mask, relighting, motion-blur padding and effects work at that resolution: an effect renderer that declares `maxPixelScale` gets `pixelScale` and scales its pixel-unit parameters by it (`LayerStyle`, Gaussian/box `Blur`). 3D and deflickered nodes, media wrapped in effects/crop/vision, and nodes with an effect lacking `maxPixelScale` keep their layout-size raster.
- **Planar Reflective Floor (`floor` in `environment`):** `kind: "light"` with `lightType: "environment"` and `floor: { y, color, reflectivity, roughness, fadeDistance, opacity }` renders a mirrored-camera reflection pass, subterranean fragment clipping, 2-pass anisotropic roughness blur ($\sigma_y \approx 3.5 \sigma_x$), Schlick Fresnel grazing reflections, and analytical depth unprojection.

## Don't Forget
- If text rendering required, you must include a font in spec (CLI TOOL only). No emoji font ships with framefields: to draw emoji, provide a color emoji font yourself with `FontManager.registerEmojiFont(path)` (a CBDT/CBLC bitmap font such as Noto Color Emoji).
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
