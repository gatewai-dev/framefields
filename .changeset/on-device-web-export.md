---
"framefields": minor
---

On-device export. `framefields bundle` (or `buildWebBundle`) writes a static folder (the browser engine, the composition's code, the files it reads under project paths, a manifest and an export page) that renders the film to MP4 on the viewer's own GPU, with no server: Safari and WKWebView on iOS 26+, current Chrome. `openBundle(base)` from the new `framefields/web` opens one; `exportVideo()` times frames, cuts the film into chunks by render time (`chunkSec`, `maxChunkFrames`), draws each with WebGPU straight into WebCodecs (`VideoFrame`s from the canvas, H.264 or HEVC), writes it to OPFS, frees caches between chunks, mixes and encodes the soundtrack apart and joins the pieces without re-encoding. An export that stops (app backgrounded or killed) resumes from its first missing chunk.

Split rendering shares this machinery with the cloud: `planChunksByBudget` plans chunks for one device by time and frame budgets, and `stitchSegments` is `stitchChunks` on any mediabunny source and target. Browser reads of local files (media, fonts, LUTs, the `fs` shim) now all go through one resolver, so a bundle maps them to its files; the preview keeps serving them under `/@fs`.
