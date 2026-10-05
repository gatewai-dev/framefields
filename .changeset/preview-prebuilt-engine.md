---
"framefields": patch
---

The live preview now works from the published package. The browser engine (framefields, the player and the Node shims) is prebuilt into `dist/preview-engine` (about 3 MB) and served to the page as separate modules. At preview time only the project's own files are bundled, against that engine. onnxruntime-web, needed only for vision effects, comes from the project's install when present and otherwise from a pinned CDN build, so its WebAssembly isn't shipped. Fonts referenced by family only (`assets/fonts/<Family>.ttf`) are served from the project folder, as the export engine reads them.
