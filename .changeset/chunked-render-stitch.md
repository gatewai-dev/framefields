---
"framefields": minor
---

Split a long render across GPUs. `renderVideo({ frames: { start, end }, audio: false })` renders one chunk of frames: it starts on a keyframe, its timestamps start at 0, and trails, datamosh and particles rebuild their state before `start`. `stitchChunks({ chunks, audio, outputPath })` from `framefields/renderer` joins the chunks and a separate audio-only render (`codec: "aac"`) into one file without re-encoding or a GPU. It refuses chunks encoded with a different codec, size or encoder parameters. `planChunks({ totalFrames, samples, workers: "auto" })` decides how many chunks a render should use (more only while each chunk stays at least 85% efficient against the per-worker start-up) and cuts them at equal render cost; `renderer.probeRender(comp)` measures the frame costs it needs.

`framefields render <entry> --cloud [--workers auto] [--plan]` renders the pushed commit of the project's git repo on api.framefields.dev and downloads the video; `--plan` prints the workers, time and estimated cost without rendering. The same from code: `renderCloud()` from the new `framefields/cloud` entry, which needs no GPU. `framefields init` adds a `render:cloud` script.
