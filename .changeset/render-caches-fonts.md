---
"framefields": patch
"@framefields/renderer": patch
"@framefields/webgpu-renderers": patch
---

`resetRenderCaches()` also forgets registered font files and deletes fonts downloaded from URLs (`clearHeadlessFonts()`). Before, the first file registered for a family stayed in use for the life of the process. In a long-lived worker, the next project's "Inter" then loaded the previous project's file, and failed once that checkout was evicted. Downloaded fonts now go to a fresh temp folder per session instead of a shared `gatewai-fonts`.
