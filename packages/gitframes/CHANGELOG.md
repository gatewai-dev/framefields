# gitframes

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
