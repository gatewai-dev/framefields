---
"gitframes": minor
---

`Layer.chart` is rebuilt on d3 and no longer depends on `chartgpu`, which removes about 130 MB from every install. Charts are now ordinary nodes: bars are boxes, lines, areas and slices are path shapes, and labels are text in the composition's own fonts. They support line, area, bar (grouped or stacked), scatter, candlestick, pie and donut, with a built-in reveal (`animate: { start, duration, stagger, ease }`).

Breaking for chart users: `Layer.chart` takes the new `ChartOptions` (`type`, `series`/`data`, `categories`, `xAxis`/`yAxis`, `legend`, `valueLabels`, …) instead of ChartGPU options, and returns a box. The `"chart"` node kind, the `ChartGPUOptions`/`Chart*Schema` exports, the `progress`/`drawProgress`/`chartProgress` animatable props and `LayerAnimation.drawProgress()`/`chartProgress()` are removed.
