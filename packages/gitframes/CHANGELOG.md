# gitframes

## 2.0.2

### Patch Changes

- d7bda9e: The preview now serves assets from the project that holds the entry (its nearest `.git`, else `package.json`), not just the entry's own directory. A project with no `.git`, where fonts and media live in a sibling `assets/` folder, previously failed to load them. `root` also accepts several paths now, for assets kept outside the project.

## 2.0.1

### Patch Changes

- Fix the browser preview failing to load from an installed package. The engine bundles the Node-only preview server, whose top-level `createRequire(import.meta.url)` ran against the stubbed `node:module`, so loading `gitframes` in the preview threw `(0, Dr.createRequire) is not a function` before the player could start. `node:module` now has a shim, and a test imports every engine entry so a missing shim is caught.

  The npm page now shows the repository README: the package's README is generated from the root one at build and pack time, with its relative asset and repository links rewritten to absolute GitHub URLs so images and links resolve on npmjs.com.

## 2.0.0

### Minor Changes

- 5c257c2: `Layer.chart` is rebuilt on d3 and no longer depends on `chartgpu`, which removes about 130 MB from every install. Charts are now ordinary nodes: bars are boxes, lines, areas and slices are path shapes, and labels are text in the composition's own fonts. They support line, area, bar (grouped or stacked), scatter, candlestick, pie and donut, with a built-in reveal (`animate: { start, duration, stagger, ease }`).

  Breaking for chart users: `Layer.chart` takes the new `ChartOptions` (`type`, `series`/`data`, `categories`, `xAxis`/`yAxis`, `legend`, `valueLabels`, …) instead of ChartGPU options, and returns a box. The `"chart"` node kind, the `ChartGPUOptions`/`Chart*Schema` exports, the `progress`/`drawProgress`/`chartProgress` animatable props and `LayerAnimation.drawProgress()`/`chartProgress()` are removed.

- 5c257c2: Add a live preview before rendering. `startPreview({ entry, export })` (also from `gitframes/preview`) serves a localhost player for a composition, with the mixed soundtrack and a timeline with the audio waveform. The page loads the module that builds the composition, bundled by esbuild against the browser engine that ships with the package (`dist/preview-engine`), and renders every frame with WebGPU in the browser, so nothing is streamed from the server. The server serves that bundle, the project's files (by absolute path, with byte ranges for video), and the soundtrack mixed by the export engine. Extruded 3D text (`Layer3D.extrudedText`) renders in the browser too. Glyph outlines used to go through skia's path `simplify`, which is Node-only; without skia they are read from fontkit, and overlapping contours (common in variable fonts) are sorted into outlines and holes by winding. Node output is unchanged. Build-time Node code in the composition (`node:path`, `import.meta.url`, synchronous `fs` reads) runs in the browser through shims. Playback never drops frames. Frames are rendered ahead, in order, into a buffer on the GPU and shown at the film's frame rate, on the soundtrack's clock. Playback starts once 3 seconds (or the rest of the film) are ready, and holds with a spinner to refill whenever rendering falls behind. The timeline shows the buffered range. `startPreview` returns a session (`url`, `close()`, `closed`) and serves the page instead of opening a browser, so an agent can show the URL in its own pane; `open: true` opens the system browser. The server shuts itself down a few seconds after the last tab closes (`idleCloseMs`). A reload doesn't trigger this. Each project gets a fixed port, so running the preview again replaces the running one and an open tab reloads into the new version by itself. No Electron. `esbuild` is a new dependency.

  Rendering consecutive frames is about 3× faster. The compositor no longer re-hashes every keyframe on each frame. `renderFrame` also accepts a stable `renderId`, which lets compiled timelines be reused between frames as `renderVideo` already does, and `format: "rgba"`, which returns raw pixels and skips PNG encoding. The new `renderAudio()` returns the composition's mixed soundtrack as PCM. The compositor also reuses the previous frame's layout when no layout input changed (the tree, the viewport, media sizes, and animated `width`, `height`, `gap`, `padding`, `fontSize` and `letterSpacing`). Before, it re-ran Yoga over the whole film's tree on every frame.

- 5c257c2: Vision effects are faster, in export and in the preview. The matte modes (`matte`, `mask`, `crop`) composite on the GPU: only the 8-bit mask is uploaded, instead of building the cut-out at full resolution on the CPU. That CPU path also kept a new full-frame texture for every frame rendered; the new path keeps two per node. Vision results are cached per source frame, keyed by node, source and inference settings, with run-length-encoded masks, so replays, scrubbing back and later renders in the same process skip inference. A frame found in the cache is cut out from its own pixels, without the usual one-frame delay. The preview analyses frames ahead of the playhead while paused, so tracked shots play at full frame rate. Background keying (`keyBackground`) runs about 10× faster with the same output: flood fills use typed-array queues and a foreground map computed once, and the edge blur reads memory in order. The preview page is served cross-origin isolated, so onnxruntime-web runs its CPU operations on several threads.

  Vision effects also run in the browser preview, on onnxruntime-web with WebGPU. `@gitframes/vision` adds `setDefaultSessionProvider()`, which the player uses to switch to that runtime. Cached models are read asynchronously. The texture cache now holds evicted textures until the frame being recorded has been submitted, which fixes "Destroyed texture used in a submit" when a frame's recording spans a mid-frame GPU readback. Its pruning also evicts the least recently used textures first, as documented.

### Patch Changes

- 985e6be: `LayerAnimation.signal()` and `.colorSignal()` now accept a signal object (`Signal.fromArray`, `Signal.builder`, …) as well as a name registered with `comp.addSignal`. Before, passing the object produced a meaningless handle id and the track silently did nothing (or picked up an unrelated signal). The object is carried on its track and registered with the program under a generated `inline_signal_N` id, so specs stay plain JSON. Values that are neither a signal nor a name now throw.
- 5c257c2: Require `sharp` ^0.35.0, so fresh installs no longer pull the libvips/libheif versions flagged by `npm audit`. Fix the README samples that did not compile against the published types (quickstart animation, 3D camera orbit and carousel, `ColorBalance`). The setup skill's `tsconfig.json` now sets `"types": ["node"]` so `typecheck` passes on TypeScript 6+, and its `package.json` also denies the `esbuild` install script that `tsx` brings in, so installs finish without warnings.

## 1.4.3

### Patch Changes

- Quieter renders: headless GPU, font, and node-discovery messages now log only with `LOG_LEVEL=debug`, and a local font no longer logs as if it were downloaded. The setup skill now writes `package.json` with the `skia-canvas` install-script approval (npm `allowScripts`, pnpm `onlyBuiltDependencies`, bun `trustedDependencies`) before installing, so installs work on package managers that block dependency scripts.

## 1.4.2

### Patch Changes

- Render logs now report the released version: the monorepo root version is synced on every release, so the logger no longer shows a stale `1.3.0`.

## 1.4.1

### Patch Changes

- Fix issues from the 1.4.0 friction report:

  - Published types no longer import unpublished `@gitframes/*` packages, so signal APIs, `frameSignal`/`timeSignal`/`progressSignal` and layer option types are fully typed instead of `any`. A build check now guards against regressions.
  - `Layer.cube`, `carousel3d`, `prism3d` and `extrudedText` no longer leak `faces`/`items` into the spec, so `CompositorProgramSchema` accepts them.
  - `scale` (and `scaleX`/`scaleY`/`scaleZ`) now applies to preserve-3d containers such as `Layer.cube`.
  - `renderVideo({ outputPath })` returns `outputPath` as `filePath` and removes the temp file.

## 1.4.0

### Minor Changes

- Bundle every built-in node renderer (Compositor, effects, audio) into the published package. Renderers are now registered from a generated static list instead of a scan for a `nodes/` directory, so installed projects no longer render blank frames. Set `GITFRAMES_NODES_DIR` to load extra nodes from disk during local node development.

  Remove React: the `gitframes/react` entry point (`CanvasComposition`, `GitframesPlayer`, `RenderProvider`, `useRenderContext`, `useCompositionState`) and the `react` peer dependency are gone. `import "gitframes"` no longer requires `react` to be installed.

  Relicense all `@gitframes/*` packages and nodes to Apache-2.0.

## 1.3.2

### Patch Changes

- Agent plugin: add the `gitframes` entry-point skill for setting up a new project, and fix the frame-grid example in `gitframes-render` (`showLabels`).

## 1.3.1

### Patch Changes

- init
