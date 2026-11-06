---
"framefields": patch
---

Effects on a 3D scene box (a box holding a camera and what it films) now apply, over the finished scene. The scene renders as a nested composition placed like a clip, but its effects were never wrapped around that composition, so every effect on it was silently dropped.
