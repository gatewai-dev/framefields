# gitframes

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
