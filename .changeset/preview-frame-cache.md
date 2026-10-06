---
"framefields": patch
---

Preview: drawn frames are cached, so stepping or scrubbing back to a frame you have already seen is a blit instead of a re-render. The cache is full-resolution and bounded by a byte budget, and is disabled for compositions that use vision (whose frames depend on the one before them).
