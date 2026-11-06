---
"framefields": patch
---

A 2D layer longer than the GPU's texture side at layout scale (a counter's tall reel strip, a long scroll) rasterizes just under that side, and its motion-blur margin stays within it, instead of failing to allocate its texture and drawing nothing.
