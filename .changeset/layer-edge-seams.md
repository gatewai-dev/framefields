---
"framefields": patch
---

3D layers that share an edge no longer show a hairline of whatever is behind them. A layer's outline in the multisampled 3D pass is now resolved per sample (a coverage mask) instead of fading over a pixel while still writing depth, so an edge pixel is drawn only where the layer covers it and never hides a neighbouring or later layer.
