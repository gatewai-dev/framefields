---
"framefields": minor
---

Add the foundations of framefields components (`framefields/components`).

- `bindComponent(defineComponent({ ... }))` turns a component definition into a factory that returns an ordinary box layer, plus `cues` (moments it produced, in the parent's frames), `span` (its window) and `part(name)`. Props are validated strictly, every component has `enter` / `exit` motion presets, a `theme`, a `seed` and a `customize` hook, and the produced spec stays plain JSON.
- Themes: `themes.graphite`, `themes.paper`, `themes.signal` and `defineTheme(partial)`, contrast-checked.
- `pulseKeys(cues, …)` turns a component's cues into keyframes on any other layer.
- An authoring toolkit at `framefields/components`: frame timing and stagger orders, seeded randomness, eases, spring and curve baking to keyframes, Catmull-Rom and arc-length paths, draw-on and hand-drawn strokes (wobble, boil, arrows), text range geometry from real font measurement, and targets (points, rects, nodes, text matches, tracked objects).
