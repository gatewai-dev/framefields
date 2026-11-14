---
"framefields": patch
---

`Backdrop` now keys one loop of its drift and repeats it, instead of a minute of keys. A backdrop in a film shorter than a minute no longer fails the render's QA with `animation_truncated`, and it keeps drifting for as long as the scene runs. Run `npx framefields add backdrop --overwrite` to update a copied component. A repeating animation track whose cycle is longer than its layer now plays its whole cycle: its keys past the end of the layer are no longer dropped, which used to shorten the cycle.
