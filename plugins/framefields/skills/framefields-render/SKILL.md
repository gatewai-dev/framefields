---
name: framefields-render
description: Render, inspect, test, preview and export WebGPU video and frame grids with the framefields headless engine. Use when verifying compositions, diagnosing blank frames, running frame grids or pixel tests, showing the user a live preview, exporting MP4/WebM, reading render progress, running video QA, naming renders in framefields.json, rendering without a GPU, or splitting a render into chunks in framefields. Cloud GPU rendering is in framefields-cloud.
---

# framefields-render

`framefields` renders headlessly in Node.js on native WebGPU (Dawn), encoding through FFmpeg with a hardware encoder when one works (NVENC, VideoToolbox), else software. No browser. Project setup is in `framefields`; rendering on framefields' GPUs is in `framefields-cloud`.

## The verification ladder

Go in order: a layout or timing bug costs seconds at step 1–3 and minutes after a full export.

### 1. Typecheck, schema, lint

```typescript
import { CompositorProgramSchema } from "framefields";

const parsed = CompositorProgramSchema.safeParse(comp.toSpec());
if (!parsed.success) { console.error(parsed.error.format()); process.exit(1); }
for (const d of comp.lint()) console.log(`${d.severity} ${d.code}: ${d.message}`); // renders, but not as intended
```

- `npx tsc --noEmit -p .` typechecks.
- `npx framefields check [name] --json` imports the render's export in an isolated process and writes one versioned JSON result (no name: every render; a module: `check src/film.ts --export buildFilm`). Errors fail it; warnings with `--warnings-as-errors`; `--timeout 60000` bounds it. The export must only build: importing it runs project code.
- `--render` (or `pnpm check:render` in scaffolded projects) adds a GPU smoke check: a frame and a three-point grid under `output/check` (`--output <dir>`). Not a substitute for pixel assertions or video QA.
- `npx framefields api` prints timing, grid and preflight type declarations for the installed version.

### 2. Single frames (`renderFrame`)

```typescript
import { HeadlessMediaRenderer } from "framefields";

const renderer = new HeadlessMediaRenderer();
await fs.writeFile("output/f45.png", await comp.renderFrame({ frame: 45, renderer }));
```

`atMs` wins over `frame`. Frames are nonnegative safe integers; fractional timestamps and FPS are fine. The composition's FPS is authoritative: a different render/grid FPS throws.

### 3. Contact sheets (`renderFrameGrid`)

```typescript
const png = await comp.renderFrameGrid({
  frames: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
  columns: 4, cellWidth: 480, showLabels: true,
});
```

Shows hitches, easing, text wrap jumps, z-order and missing cuts at a glance. Automatic sampling stops before the exported frame count (`max(1, round(durationMs * fps / 1000))`); explicit frames may go past it. Order and duplicates are kept. At most 64 samples by default, 120 max.

### 4. Pixel tests (vitest)

```typescript
it("renders the title on frame 30", async () => {
  const comp = await buildFilm();
  const png = await comp.renderFrame({ frame: 30, renderer: new HeadlessMediaRenderer() });
  expect(png.length).toBeGreaterThan(1000); // decode and probe pixels at known coordinates
});
```

### 5. Show the user (`preview`)

When a person is in the loop, let them watch before the export. `npx framefields preview <name>` or `startPreview` serves a localhost player (sound, waveform timeline, frame stepping). The page runs the composition's own code with WebGPU in the browser in real time; a slow device skips frames to keep the sound in time. The soundtrack is the export's own mix.

```typescript
import { startPreview } from "framefields";

const session = await startPreview({ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" }, { title: "Launch film" });
console.log(`Preview at ${session.url}`);
await session.closed; // "idle" | "replaced" | "closed"
```

- **The export runs in the browser.** It may be a `Composition` or a (async) function returning one. `node:path`, `fileURLToPath(import.meta.url)` and synchronous `fs` reads work through shims; writes are skipped. Build asset paths from `import.meta.url`, not `process.cwd()`. Files inside the project (nearest `.git` or `package.json`) are served; pass `root: [...]` for others (e.g. a shared fonts folder).
- **Run it in the background and read its output.** Stderr lines (`[framefields preview]`) say when the page opened, each distinct page error once (build error, frame threw, missing font, no WebGPU), and why it stopped. Check them instead of assuming the film drew.
- **One tab for the whole loop.** The port is fixed per project. Running it again replaces the running one and the open tab reloads at the same moment. It stops ~5 s after its last tab closes (`idleCloseMs`); just start it again.
- **Show it where the user is.** It opens nothing: use the app's built-in browser if there is one, else give the link, or pass `open: true`. Needs current Chrome, Edge or Safari.
- **Notes.** Paused, the user clicks (or drags an area) and writes a note. Each prints (`note 3 at 0:12.50 (frame 750), spot 42%,31%: …`) and is saved in `.framefields/preview-notes/notes.json` with `note-<id>.jpg` (the frame, spot marked; `notesDir` moves it, `false` disables). To act: read `notes.json`, open each open note's picture, find the layer from the moment and spot, change it, rerun the preview. You may set `"done": true` yourself.
- **Links and scripting.** `#t=12.5` or `#frame=750` opens at a moment. `window.framefieldsPreview` has `seek(seconds)` / `seekFrame(n)` (resolve once drawn: screenshot then), `play()`, `pause()`, `notes()`, `state()` (`{ state, error, frame, time, playing, buffering, audio, connected, playbackFps, renderMs, meta }`). `<html data-preview="ready">` marks the first frame. Hidden tabs pause.
- Vision effects analyse each frame from the one drawn before: check cutouts paused or in the export.

### 6. Export (`renderVideo`)

```typescript
const result = await comp.renderVideo({
  outputPath: "output/film.mp4",
  quality: "very_high", // very_low | low | high | very_high (default)
  codec: "h264",        // h264 (default) | vp9 | vp8 | gif; aac | mp3 | opus = audio only
  qa: true,             // see Video QA
});
await result.cleanup?.();
```

No HEVC or AV1; an unknown codec falls back to H.264. Or from the CLI: `npx framefields render <name>` uses the project's own tsx and framefields, calls the export with the render's `args`/`select`, downloads missing pinned assets first, and writes the render's `output`.

Always end render scripts with `process.exit(0)`: native GPU and encoder threads keep Node alive.

## Named renders (`framefields.json`)

`framefields.json` names what the project renders. Add one per cut (teaser, vertical, language) rather than flags in `render.ts`; the CLI, `framefields check`, the cloud and the dashboard pick them by name.

```json
{
  "renders": {
    "film":   { "title": "Launch film", "entry": "src/film.ts", "export": "buildFilm", "workers": "auto", "output": "output/film.mp4" },
    "teaser": { "title": "15 s teaser", "description": "Vertical cut", "entry": "src/film.ts", "export": "buildTeaser", "codec": "vp9" }
  }
}
```

| Field | Meaning |
|---|---|
| `entry` | Module that builds the composition (required) |
| `export` | A `Composition` or a function returning one (default `buildFilm`) |
| `title`, `description` | Shown to the user in the dashboard and `framefields renders` |
| `args` / `select` | Arguments for a function export / which composition when it returns a `Record` |
| `workers`, `maxWorkers` | Cloud GPUs: `1` (default), a number, or `"auto"` |
| `codec`, `quality` | `h264` / `vp9`; `very_low` … `very_high` |
| `output` | Where the video is written |

Names: letters, digits, `-`, `_`, `.` (≤ 64). `npx framefields renders [--json]` lists them. After adding one, run `framefields check <name>`. Needs framefields 2.12+.

## Reading render progress

`renderVideo` logs about 15 short `[framefields]` lines to stderr however long the film:

```text
[framefields] Preparing 1800 frames (60.0s) at 1920x1080, 30 fps, h264
[framefields] Rendered 10% (180/1800 frames) · 41.2 fps · eta 39.3s
[framefields] Mixing audio
[framefields] Muxing mp4
[framefields] Done in 51.4s (14.2 MB): prepare 1.2s · render 43.1s · audio 3.2s · audio-encode 1.1s · mux 0.8s
```

- **Work continues after `Rendered 100%`:** mixing decodes every clip's audio, then encode and mux. Not a hang; wait for `Done in …`.
- Quiet phases print `Still …` lines after 10 s, 30 s, 70 s, then every 5 min. It's stuck only when no line arrives well past the last gap. Killing it leaves no video. Failures name their phase.
- Run long exports in the background with the longest timeout available and read the output when done.
- `LOG_LEVEL=warn|debug`; `NODE_ENV=production` or `FRAMEFIELDS_LOG_FORMAT=json` gives pino JSON on stdout.
- `onProgress` receives `{ phase, frame, totalFrames, elapsedMs, phaseProgress?, fps?, etaSec?, detail? }`; phases `prepare`, `render`, `audio`, `audio-encode`, `mux`, `convert` (GIF), `done`.

## Video QA (`renderVideo({ qa })`)

The engine measures every frame as it's read back and the audio as it's mixed: no second decode.

```typescript
import { formatQaReport } from "framefields";

const result = await comp.renderVideo({ outputPath: "output/film.mp4", qa: { targetLufs: -14 } });
console.log(formatQaReport(result.qa!));
if (!result.qa!.passed) process.exitCode = 1;
```

| `issues[].code` | Severity | Meaning |
|---|---|---|
| `frames_missing` | error | Fewer frames encoded than the composition has |
| `black_frames` | warning | ≥ `minBlackSec` (0.5 s) of black; `startSec`/`endSec` |
| `audio_clipping` | warning | Samples at or beyond full scale |
| `loudness_off_target` | warning | More than `lufsTolerance` (1 LU) from `targetLufs` |
| `animation_truncated` | warning | Keyframes past a layer's window never play |
| `frozen_video` | info | Unchanged for ≥ `minFrozenSec` (2 s) |
| `audio_silence` / `audio_silent` | info | ≥ 2 s below `silenceDbfs` (-60) / whole track silent |

`result.qa` also includes every `comp.lint()` finding (`invalid_gradient`, `unknown_color`, `low_contrast_text`, `offscreen_layer`, `duplicate_id`, `unsupported_image_format`, `shadow_unsupported_light`, `pbr_without_environment`, `static_track`, …). `passed` is false on any error or warning. `qa.audio.integratedLufs` is BS.1770 (platforms normalize to about -14); `qa.audio.peakDbfs` is the sample peak.

For files rendered elsewhere:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,duration,r_frame_rate out.mp4
ffmpeg -i out.mp4 -vf "blackdetect=d=0.5:pix_th=0.10" -f null -
ffmpeg -i out.mp4 -af volumedetect -f null -
```

## Splitting a long render

Each process renders a frame range without audio, the audio renders once, then the files join without re-encoding:

```typescript
import { stitchChunks } from "framefields/renderer";

await comp.renderVideo({ outputPath: "out/chunk-0.mp4", frames: { start: 0, end: 900 }, audio: false }); // per worker
await comp.renderVideo({ outputPath: "out/audio.mp4", codec: "aac" });                                   // once
await stitchChunks({ chunks: ["out/chunk-0.mp4", "out/chunk-1.mp4"], audio: "out/audio.mp4", outputPath: "out/final.mp4" }); // no GPU
```

- Trails, datamosh and particles replay earlier frames before `start`: same picture, extra time.
- Same framefields version, codec, quality and GPU type for every chunk; `stitchChunks` refuses mismatched codec, size or encoder parameters.
- Run SAM tracking once and share `FRAMEFIELDS_VISION_CACHE_DIR` so no chunk re-tracks earlier frames.
- `qa` checks each chunk alone; check the stitched file with ffmpeg.
- `planChunks({ totalFrames, samples, workers: "auto" })` picks count and cuts (adds workers while each spends ≥ 85% of its time rendering; splits at equal cost). `renderer.probeRender(comp)` measures `samples`.

The cloud does all of this for you: `framefields-cloud`.

## Rendering without a GPU

framefields falls back to the CPU with identical output for every feature (vision inference too).

- **Linux:** `apt-get install -y libvulkan1 mesa-vulkan-drivers` (lavapipe). Without any Vulkan driver nothing renders.
- **Windows:** WARP (built in) or lavapipe. **macOS:** always has Metal.
- `await describeGpu()` reports `software: true`.
- About 12× slower than an M1 Pro GPU, scaling with cores. Fine for frames, grids and short exports; render long films in the cloud (`framefields-cloud`) or on a GPU machine.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Whole frame black | Unregistered font or `NaN` in a signal | `FontManager.register()` every font before building; keep signals finite. |
| Media layer blank | Wrong path, LFS pointer, zero opacity | Check the file is real (`git lfs pull`, `framefields assets pull`). |
| Audio cuts out early | No `durationFrames` on `Layer.audio()` | Set it to the film's length. |
| Vision cutout empty on a single frame | Vision reads the previous frame | Render ≥ 2 consecutive frames with one renderer; `renderVideo` handles it. |
| Ghosted double in a cutout | Frames rendered out of order (grids, jumps) | Check vision with sequential frames or the export. |
| Pause after `Rendered 100%` | Audio mix / encode / mux | Wait for `Still …` and `Done in …`. |
| Script hangs after `Done in …` | Worker threads hold Node | `process.exit(0)`. |
| Very slow on a Linux server | CPU adapter (lavapipe) | `describeGpu()`; fix the Vulkan driver (`vulkaninfo --summary`). |
| Encoder fails to open (NVENC, `h264_rkmpp`) | framefields < 2.2 | Upgrade, or `FRAMEFIELDS_HW_CODECS=off`. |
| Jump at a chunk seam | Mismatched chunk settings, or an effect reading wall-clock time | One commit and settings for all chunks; deterministic effects. |
| Effect shows no change | Value on the wrong scale | Look it up in the `framefields-effects` catalog. |
| Text truncated | Box narrower than the text | Set `width` or `width: "fill"`. |
