---
name: framefields-render
description: Render, inspect, test, and export high-performance WebGPU video and frame grids with the framefields headless engine, locally or on framefields cloud GPUs. Use when verifying compositions, diagnosing blank frames, profiling GPU pipelines, running visual frame grids, exporting final MP4 video, naming renders in framefields.json, rendering in the cloud (`framefields render --cloud`, `renderCloud`, the dashboard), or splitting a long film across several GPUs in framefields.
---

# framefields-render

## Setup
Import everything from the [`framefields`](https://www.npmjs.com/package/framefields) npm package. If the project doesn't have framefields set up yet, follow the `framefields` skill first (install, project scaffold, first render).

## Overview
`framefields` renders headlessly in Node.js on top of native WebGPU (Dawn), encoding through FFmpeg with a hardware encoder when one works (NVENC, VideoToolbox) and a software one otherwise. It does not run a browser, Puppeteer, or Chromium.

Because video rendering is resource-intensive and native GPU pipelines run asynchronously in worker pools, framefields workflows enforce a strict **verification ladder**: inspect inexpensive intermediate artifacts first before committing to a full video render.

---

## The Verification Ladder

Always proceed through the ladder in order. Catching a layout or timing bug at step 1 or 2 takes seconds; catching it after a 30-second 4K video render wastes minutes.

### Step 1: Static Typecheck & Schema Validation
Before touching the GPU, verify TypeScript types and parse the composition against the strict runtime schema:

```typescript
import { CompositorProgramSchema } from "framefields";

// 1. Compile spec
const spec = comp.toSpec();

// 2. Validate against strict schema
const parsed = CompositorProgramSchema.safeParse(spec);
if (!parsed.success) {
  console.error("Schema validation failed:", parsed.error.format());
  process.exit(1);
}

// 3. Lint: things that render without error but not as intended
for (const d of comp.lint()) console.log(`${d.severity} ${d.code}: ${d.message}`);
```

Typecheck the project:
```bash
npx tsc --noEmit -p .
```

In projects initialized with the current CLI, `pnpm check` runs typechecking and document preflight. For a named render, run `pnpm exec framefields check teaser --json`; with no argument it checks every render in `framefields.json`. For another module, `pnpm exec framefields check src/film.ts --export buildFilm --json`. The export is a `Composition` or a builder returning one; importing it executes project code, so keep rendering, generation and writes out of the builder. The CLI runs it in an isolated process, routes builder logs to stderr and writes one versioned JSON result to stdout. Errors fail the command; warnings fail with `--warnings-as-errors`. `--timeout 60000` bounds the worker lifetime.

`pnpm check:render` adds GPU verification, a frame and a three-point grid under `output/check`; `--output <dir>` changes the location. This smoke check does not replace targeted pixel assertions or video QA. A failed or unavailable GPU check is reported as a failure. Use `pnpm exec framefields api` for timing, grid and preflight type declarations generated from this SDK version.

---

### Step 2: Single Frame Inspection (`renderFrame`)
Render isolated keyframe points (e.g. entry, peak action, exit) directly to PNG files on disk to inspect alignment, typography, colors, and opacity:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "framefields";

const renderer = new HeadlessMediaRenderer();

// Render frame 45 (1.5s at 30fps)
const pngBuffer = await comp.renderFrame({
  frame: 45,
  renderer,
});

await fs.writeFile("output/frame-45.png", pngBuffer);
```

`atMs` takes precedence when both `frame` and `atMs` are supplied, including for frame hooks. Frame indices must be nonnegative safe integers; fractional timestamps and FPS are supported. A composition's FPS is authoritative: a different render/grid FPS override throws. Media pipelines can still select their rendering FPS.

---

### Step 3: Motion & Layout Stability Contact Sheets (`renderFrameGrid`)
To verify easing curves, cut points, kinetic sweeps, or text wrapping without encoding a full video, generate a sequential frame grid image:

```typescript
import fs from "node:fs/promises";

// Samples frames across the intro sweep (frames 0 to 60)
const gridPng = await comp.renderFrameGrid({
  frames: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
  columns: 4,
  cellWidth: 480, // Downscaled thumbnail size for rapid visual scanning
  showLabels: true, // frame number and timestamp under each cell
});

await fs.writeFile("output/intro-grid.png", gridPng);
```

Contact sheets immediately reveal:
- Motion hitches and non-smooth easing deceleration.
- Text clipping or wrapping jumps across keyframe boundaries.
- Bad layer z-indexing or missing cut transitions.

Grid frame ranges are inclusive, but the composition's duration is exclusive. Automatic sampling stops before the exported frame count (`max(1, round(durationMs * fps / 1000))`). Explicit points may sample beyond the export window for diagnostics. Sample order and duplicates are preserved. Frame steps must be positive safe integers, timestamp steps finite and positive. The sample limit is checked while generating points (64 by default, at most 120); invalid or excessive requests fail before creating a large list. Labels describe the actual selected frame, with timestamps formatted for display only.

---

### Step 4: Programmatic Conformance Probes in Vitest
Write automated headless vitest tests that assert pixel colors, transparency, or layout bounding boxes:

```typescript
import { describe, it, expect } from "vitest";
import { HeadlessMediaRenderer } from "framefields";
import { buildFilm } from "../film.js";

describe("Hero Scene Conformance", () => {
  it("renders non-black title text on frame 30", async () => {
    const comp = await buildFilm();
    const renderer = new HeadlessMediaRenderer();
    const png = await comp.renderFrame({ frame: 30, renderer });

    expect(png.length).toBeGreaterThan(1000);
    // Use skia-canvas or pixel probes to assert color at target coordinates
  });
});
```

---

### Step 5: Show the User Before Exporting (`preview`)
When a person is in the loop, let them watch the composition before you spend time on the final render. `startPreview` serves a localhost player with the soundtrack, a timeline with the waveform, and frame stepping. The page loads the composition's own code and renders it with WebGPU in the browser, in real time: a device that can't draw every frame in time skips some, and the sound keeps its speed; the server only serves that code and the project's files. The soundtrack is the export's own mix, made in the page around the playhead, so sound starts at once. Point it at the module that builds the composition:

```typescript
import { startPreview } from "framefields";

const session = await startPreview(
  { entry: new URL("./film.ts", import.meta.url), export: "buildFilm" },
  { title: "Launch film" },
);
console.log(`Preview at ${session.url}`);
await session.closed; // keep the process alive while the user watches
```

- **The export is a function returning the `Composition`** (it may be async), or a `Composition` itself. The browser calls it, so build-time Node code in it must stay simple: `node:path`, `fileURLToPath(import.meta.url)` and synchronous `fs` reads (JSON, text) work through shims; writes are skipped. Assets referenced by absolute path load from the server, limited to the project that holds the entry (its nearest `.git` or `package.json`); pass `root` with one or more paths for assets kept outside it (e.g. a shared fonts folder).
- **Run it in the background, and read its output.** Start the script as a background command with the longest timeout your harness allows, tell the user the URL, and ask for feedback in the chat. The command's output (stderr, prefixed `[framefields preview]`) says when the page opened, reports each distinct error from the page once (a build error, a frame that threw, a font or renderer that failed to load, no WebGPU), and says why it stopped. Check it after the page opens instead of assuming the film drew. `log` redirects or silences these lines, and `session.closed` resolves with the reason: `"idle"`, `"replaced"` or `"closed"`.
- **One tab for the whole loop.** The port is fixed per project directory. Running the preview again (after you've made changes) takes over from the one already running, and a tab left open reconnects and reloads into the new version by itself, at the moment it was showing. Don't ask the user to reopen anything. When the user closes the tab, the preview stops by itself about 5 s later (a reload doesn't stop it; `idleCloseMs` changes the delay). If the preview was stopped (tab closed, time limit, or you killed it), just start it again.
- **Notes pinned on the picture are the user's precise feedback.** Paused, the user clicks the frame (or drags an area) and writes what should change; the note keeps the frame, the spot as fractions of the frame (`x`, `y`, and `w`, `h` for an area) and the text. Each note prints in the output (`note 3 at 0:12.50 (frame 750), spot 42%,31%: …`) with the path of `note-<id>.jpg`, the frame with the spot marked, and all of them are in `.framefields/preview-notes/notes.json` (`.framefields` ignores itself in git; `notesDir` moves it, `false` turns notes off). To act on them: read `notes.json`, open each open note's picture to see exactly what it points at, find the layer in the code from the moment and the spot, make the change, and run the preview again. The tab comes back with the notes, so the user can check them and tick them off. You can also set `"done": true` in `notes.json` yourself. A chat that can't read files gets the same list from the **Copy** button in the Notes panel.
- **Point at a moment.** `#t=12.5` in the URL opens the player at 12.5 s (`#frame=750` by frame), and the address follows the playhead when it stops, so a link you give the user lands where you mean.
- **Drive it from a script, not with clicks.** If you can run JavaScript in the page (an agent browser), use `window.framefieldsPreview`: `await seek(seconds)` or `await seekFrame(n)` resolve once that frame is drawn (take the screenshot then), `play()` and `pause()` control playback, `notes()` lists the notes, and `state()` returns `{ state: "loading" | "ready" | "error", error, frame, time, playing, buffering, audio, connected, playbackFps, renderMs, meta }`. `<html data-preview="ready">` marks the first frame drawn. A hidden tab pauses playback, since browsers throttle it.
- **Show it where the user is.** `startPreview` only serves the page and returns the URL. If your app has a built-in browser, open the URL there. Otherwise give the user the link, or pass `open: true` to open their default browser (skipped when an open tab reconnects on its own). The page needs WebGPU (current Chrome, Edge or Safari).
- **Playback runs in real time.** A slow device skips frames to keep pace with the sound; `state()` reports the reached `playbackFps` and the last frame's `renderMs`. Paused, the page draws the exact frame. Vision effects analyse each frame from the one drawn before it, so check cutouts and tracking paused or in the export.

---

### Step 6: Full Video Export (`renderVideo`)
Once static frames and motion grids are verified, encode the final MP4/WebM video:

```typescript
const result = await comp.renderVideo({
  outputPath: "output/final-video.mp4",
  quality: "very_high", // "very_low" | "low" | "high" | "very_high" (default)
  codec: "h264",        // "h264" (default, MP4) | "vp9" | "vp8" (WebM) | "gif"; "aac" | "mp3" | "opus" render audio only
});
await result.cleanup?.(); // releases temporary files
```

There is no HEVC or AV1 output; an unknown `codec` falls back to H.264.

```typescript
```

Pass `qa: true` to have the engine check the output while it renders (see **Built-in Video QA** below) and return the findings as `result.qa`.

### Splitting a long render into chunks
To render on several GPUs at once, have each process render a range of frames without audio, render the audio once, then join the files without re-encoding:

```typescript
import { stitchChunks } from "framefields/renderer";

// On each worker (its own process and composition): frames start..end-1.
await comp.renderVideo({ outputPath: "out/chunk-0.mp4", frames: { start: 0, end: 900 }, audio: false });
// Once, anywhere: the whole timeline's audio.
await comp.renderVideo({ outputPath: "out/audio.mp4", codec: "aac" });
// On any machine (no GPU needed): chunks in timeline order.
await stitchChunks({ chunks: ["out/chunk-0.mp4", "out/chunk-1.mp4"], audio: "out/audio.mp4", outputPath: "out/final.mp4" });
```

- Trails, datamosh and particles rebuild their state before `start` by replaying earlier frames, so a chunk starting late costs extra time but renders the same picture.
- Render every chunk with the same framefields version, codec and quality on the same GPU type. `stitchChunks` refuses chunks with a different codec, size or encoder parameters.
- SAM 2 / SAM 3 tracks run in order from their first prompted frame. Run the vision analysis once and point every worker at the shared cache (`FRAMEFIELDS_VISION_CACHE_DIR`), so no chunk re-tracks the frames before it.
- `qa` checks each chunk on its own. Check the stitched file with ffmpeg (below).
- `planChunks({ totalFrames, samples, workers: "auto" })` picks the chunk count and cuts: it adds workers only while each chunk spends at least 85% of its time rendering (about 5.7× the per-worker start-up), and splits at equal render cost. `renderer.probeRender(comp)` measures the `samples`.

## Named Renders (`framefields.json`)

`framefields.json` at the project root names what the project renders. `init` writes a `film` render; add one per cut (teaser, vertical edit, language) instead of parameterizing `render.ts`. The cloud CLI, `renderCloud`, `framefields check` and the dashboard's New render dialog all pick renders by name, so nobody chooses files and exports.

```json
{
  "components": "src/components",
  "renders": {
    "film":   { "title": "Launch film", "entry": "src/film.ts", "export": "buildFilm", "workers": "auto", "output": "output/film.mp4" },
    "teaser": { "title": "15 s teaser", "description": "Vertical cut for socials", "entry": "src/film.ts", "export": "buildTeaser", "codec": "vp9" }
  }
}
```

| Field | Meaning |
|---|---|
| `entry` | Module that builds the composition, relative to the project root. Required. |
| `export` | A `Composition`, or a function returning one. Default `buildFilm`. |
| `title`, `description` | Shown in the dashboard and `framefields renders`. Write them for the user, not for code. |
| `args` | Passed to the export when it is a function. |
| `select` | When the export returns several compositions (a `Record`), the one to render. |
| `workers` | Cloud GPUs: `1` (default), a number, or `"auto"`. |
| `maxWorkers` | Upper bound for `"auto"`. |
| `codec` | `h264` (default, MP4) or `vp9` (WebM). |
| `quality` | `very_low`, `low`, `high` or `very_high` (default). |
| `output` | Where `framefields render <name> --cloud` downloads the video. |

- Names use letters, digits, `-`, `_` and `.` (at most 64). Errors name the render and field: `framefields.json: renders.teaser needs "entry"`.
- `npx framefields renders` lists them (`--json` for tools). `npx framefields check` with no argument checks every render; `npx framefields check teaser` checks one (artifacts under `output/check/<name>` when checking several).
- After adding a render, run `framefields check <name>`, then commit and push: the cloud and the dashboard read `framefields.json` from the pushed branch, and the dashboard greys out a render whose `entry` isn't on that branch.
- Named renders need framefields 2.12 or later. With older versions, render a module path (below).

## Rendering in the Cloud (`framefields render --cloud`)

api.framefields.dev renders the project on framefields' GPUs and splits a long film across several. It fetches the project from git, so it renders the **pushed commit**:

- Commit and push first. Uncommitted changes are not rendered (the CLI warns), a commit not on the remote is refused, and so is a folder outside a git repo or without a remote.
- Run it from the project folder (where `framefields.json` and `package.json` are). In a monorepo, the CLI sends that folder as the workdir.
- The worker installs the project from its lockfile and renders with **the project's own framefields version**, so commit the lockfile. Footage, audio and fonts must be pinned in `framefields.json` with `framefields assets add`, in Git LFS, or committed; other `.gitignore`d files don't exist on the worker.
- Pinned assets: before starting, the CLI (and `renderCloud`) uploads any the bucket lacks and signs reads of assets on remotes without a `publicUrl` (valid 24 h; the keys stay on the machine). Each worker downloads them (cached by hash for its next job); on R2 those downloads are free, unlike LFS bandwidth. Dashboard renders have nobody to sign, so they read only remotes with a `publicUrl`.
- Private repos: the user connects GitHub once at https://framefields.dev/dashboard/settings#connections (the framefields GitHub App, ideally on all repositories, so new repos render without another step). Public repos need nothing.
- It bills the account behind `FRAMEFIELDS_API_KEY` (keys at https://framefields.dev/dashboard/keys). If authentication is required, ask the user to set it in the process environment; never print, write or embed it.

```bash
npx framefields render film --cloud --plan   # workers, time and estimated cost; renders nothing
npx framefields render film --cloud          # render, then download to the render's output
npx framefields render --cloud               # the only named render
npx framefields render src/film.ts --cloud --export buildFilm --workers auto   # a module, without a manifest
```

- Flags override the named render's fields: `--workers <n|auto>`, `--max-workers <n>`, `--codec h264|vp9`, `--quality`, `--select <name>`, `--output <file>`, `--export`. `--json` prints the final status as JSON.
- `--workers` defaults to the render's `workers`, else 1 (one GPU, no planning step). `auto` measures frame costs on one worker, then uses as many workers as stay efficient: a 5-minute film stays on one, a 3-hour film spreads to `--max-workers` (API cap 10). A number splits into that many.
- Show the user `--plan` before a long or expensive render: it prints `Plan: 4 workers, 1 h 50 min of render work, ready in about 35 min, estimated $1.20.` and the command that renders it.
- The CLI prints one line per phase: measuring (`probing`), rendering N chunks and the audio in parallel, joining chunks (`stitching`), then `Done in …: <file>, <GPU seconds>, <cost>.` While rendering it prints progress at most every 10 s with the cost so far. Let it run; a split render of a long film takes minutes.
- Billing: a credit hold is placed when the render starts (raised to the estimate once planned); the final charge is the GPU seconds actually used, and the rest is released. Failed and cancelled renders charge the GPU time they used. `insufficient_credits` means the user must add funds at https://framefields.dev/dashboard/billing.
- Ctrl-C cancels the render; GPU time already used is charged.
- The dashboard (https://framefields.dev/dashboard/renders) shows every render, API or dashboard started, with live progress, cost so far, Cancel and the finished video. Its **New render** dialog lists the named renders of a connected repo's branch, with Plan and Render.

From code (no GPU needed locally):

```ts
import { CloudRenderError, renderCloud } from "framefields/cloud";

try {
  const result = await renderCloud({
    render: "film",                 // or { entry: "src/film.ts", export: "buildFilm", workers: "auto" }
    outputPath: "output/film.mp4",  // downloads the finished video
    onProgress: (s) => console.log(s.status, s.progress.frames, s.progress.totalFrames, s.costUsd),
    // dryRun: true                 // plan only: result.plan and result.estimateUsd
  });
  console.log(result.filePath, result.gpuSeconds, result.costUsd, result.output?.url);
} catch (err) {
  if (err instanceof CloudRenderError) console.error(err.code, err.message); // the worker's code, e.g. ASSET_NOT_FOUND
  else throw err;
}
```

Options passed to `renderCloud` override the named render's; `signal` cancels. `cloudClient({ apiKey })` (key defaults to `FRAMEFIELDS_API_KEY`) exposes `start`, `status` and `cancel` for callers that track renders themselves. The HTTP API is `POST /v1/render` (`source`, `target`, `render`, `workers`, `max_workers`, `dry_run`, optional `name` and `title`), `GET` and `DELETE /v1/render/:id`, with `Authorization: Bearer <key>`.

### Cloud render failures

The error carries the worker's code. Fix the project, commit, push and render again.

| Code | Cause | Fix |
|---|---|---|
| `REPO_NOT_FOUND`, `GIT_AUTH_FAILED` | Private repo the framefields GitHub App can't reach | Connect GitHub (Settings → Connections) with access to this repo. |
| `REF_NOT_FOUND`, `COMMIT_MISMATCH` | Branch or commit not on the remote | `git push`. |
| `LOCKFILE_MISSING`, `INSTALL_FAILED` | No committed lockfile, or it doesn't install | Commit `pnpm-lock.yaml` / `package-lock.json`; check it installs cleanly. |
| `ENTRY_NOT_FOUND`, `EXPORT_NOT_FOUND`, `EXPORT_INVALID` | `entry`/`export` in framefields.json or flags are wrong | `framefields check <name>` locally. |
| `COMPOSITION_BUILD_FAILED`, `EXPORT_SIDE_EFFECT` | The builder throws, or renders/writes while building | Keep builders pure; `framefields check` reproduces it. |
| `ASSET_NOT_FOUND`, `LFS_OBJECT_MISSING`, `LFS_POINTER_UNRESOLVED` | An asset isn't in the repo or its LFS object wasn't pushed | `git lfs ls-files`, `git lfs push --all origin`; un-ignore assets the film needs. |
| `ASSET_NOT_UPLOADED`, `ASSET_HASH_MISMATCH` | A pinned asset isn't on the bucket, or the bucket holds other bytes | `npx framefields assets push` from the machine with the right file. |
| `ASSET_PRIVATE`, `ASSET_FORBIDDEN` | The worker can't read the bucket: no `publicUrl` and no signature (a dashboard render), or the custom domain doesn't serve it | Render from the CLI, or give the remote a working `publicUrl`. |
| `ASSET_MANIFEST_INVALID` | `storage` or `assets` in framefields.json is malformed | `npx framefields assets status` shows the error locally. |
| `ENGINE_UNSUPPORTED` | The project's framefields is too old to render chunks | Upgrade framefields in the project (2.11+), or render with `--workers 1`. |
| `RENDER_TIMEOUT`, `RENDER_OOM` | One worker can't finish its part | Use `--workers auto` (or more workers) to split it. |

Retryable infrastructure errors (`GIT_NETWORK`, `RENDER_STALLED`, a lost worker) are retried by the API, and a straggling chunk gets a backup worker; they rarely reach the user.

---

## Rendering Without a GPU

Agents often run in sandboxes or CI runners with no GPU. framefields then renders on the CPU, with the same output for every feature (text, media, Lottie, effects, 3D, vision; vision inference moves to the CPU too).

- **Linux:** install Mesa lavapipe, `apt-get install -y libvulkan1 mesa-vulkan-drivers`. Without a Vulkan driver at all, nothing can render.
- **Windows:** Direct3D 12's WARP renderer is built in; lavapipe (e.g. from mesa-dist-win) works through Vulkan too.
- **macOS:** always has a Metal GPU, VMs included; framefields' WebGPU build has no Vulkan, so lavapipe isn't used there.
- **Confirm it:** `await describeGpu()` returns `software: true`.
- **Budget for speed:** about 12× slower than an Apple M1 Pro's GPU in our Linux test (the smoke project's three videos: 9.7 min against 49 s); it scales with CPU cores. Frames, grids and short exports are fine. Vision layers are the slowest part.
- **Long films:** push the project and render it in the cloud (`npx framefields render film --cloud`, above), or on a GPU machine of your own. To run the render worker yourself (Docker or RunPod, renders a git commit on a GPU), see its project checklist and job format: https://framefields.dev/docs/guides/render-service/

## Production Render Script Pattern

Production projects structure their `src/render.ts` to support both quick frame probes and full exports from the CLI:

```typescript
// src/render.ts
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer, startPreview } from "framefields";
import { buildFilm } from "./film.js";

const OUT = path.resolve(import.meta.dirname, "../output");
const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
  // The browser runs film.ts itself; no need to build the film here.
  const session = await startPreview({ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" });
  console.log(`Preview at ${session.url}`);
  await session.closed; // serves until its tab closes or the next preview replaces it
  process.exit(0);
}

const comp = await buildFilm();
await fs.mkdir(OUT, { recursive: true });

if (mode === "frames") {
  const renderer = new HeadlessMediaRenderer();
  await fs.mkdir(path.join(OUT, "frames"), { recursive: true });
  for (const f of args.map(Number)) {
    const png = await comp.renderFrame({ frame: f, renderer });
    const file = path.join(OUT, "frames", `f${String(f).padStart(4, "0")}.png`);
    await fs.writeFile(file, png);
    console.log(`Rendered frame: ${file}`);
  }
} else {
  const started = Date.now();
  const result = await comp.renderVideo({
    outputPath: path.join(OUT, "output.mp4"),
    quality: "high",
  });
  await result.cleanup?.();
  console.log(`Exported video: ${result.filePath} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// CRITICAL: Always explicitly exit process to prevent native WebGPU/mediabunny thread hangs
process.exit(0);
```

CLI Usage:
```bash
# Render specific keyframes for instant review:
tsx src/render.ts frames 0 18 36 72

# Live player for the user (run in the background; re-run after changes and the open tab reloads):
npx framefields preview film

# Render the full video on this machine, to the render's output in framefields.json:
npx framefields render film

# The same render on framefields cloud GPUs, to the same file:
npx framefields render film --cloud
```

`framefields render <name>` and `framefields preview <name>` load the module with the project's own tsx and framefields, like the cloud worker, and call the export with the render's `args` (and `select`); the preview calls it without them. A local render downloads pinned assets that are missing first; the preview streams them from their bucket.

### Reading render progress

`renderVideo` logs its own progress to stderr, one short `[framefields]` line per event. The log stays short however long the film is, about 15 lines for an export:

```text
[framefields] Preparing 1800 frames (60.0s) at 1920x1080, 30 fps, h264
[framefields] Rendering 1800 frames
[framefields] Rendered 10% (180/1800 frames) · 41.2 fps · eta 39.3s
…
[framefields] Rendered 100% (1800/1800 frames) · 41.8 fps · in 43.1s
[framefields] Mixing audio
[framefields] Encoding 60.0s of audio (aac)
[framefields] Muxing mp4
[framefields] Done in 51.4s (14.2 MB): prepare 1.2s · render 43.1s · audio 3.2s · audio-encode 1.1s · mux 0.8s
```

- **Work continues after the last frame.** "Mixing audio" decodes every audio and video clip in the film, then the soundtrack is encoded and "Muxing" writes the file. With many or long clips this takes a while. It is not a hang; wait for `Done in …`.
- **A quiet phase prints `Still …` lines**, e.g. `Still mixing audio (42%, 3/7 clips: music.mp3), 1m 10s in this phase`: after 10 s, 30 s, 70 s, then backing off to one every 5 min. Each says which phase is running and for how long. A render is stuck only when no line arrives for well over the last gap. Killing it at any point leaves no video.
- **A failure names its phase:** `Failed while mixing audio after 12.3s`, with the error.
- **Run long exports in the background** with the longest timeout your harness allows, and read the output when it finishes rather than polling it.
- `LOG_LEVEL=warn` silences these lines; `LOG_LEVEL=debug` adds per-stage detail. Warnings and errors read `[framefields] warn: …` / `error: …`.
- With `NODE_ENV=production` (or `FRAMEFIELDS_LOG_FORMAT=json`) the lines are pino JSON on stdout instead, with the text in `msg`; `FRAMEFIELDS_LOG_FORMAT=text` forces the short lines.
- For your own progress output, `onProgress` gets every event as `{ phase, frame, totalFrames, elapsedMs, phaseProgress?, fps?, etaSec?, detail? }`. `phase` runs `prepare`, `render` (audio-only output skips it), `audio`, `audio-encode`, `mux`, `convert` (GIF only), `done`.

---

## Built-in Video QA (`renderVideo({ qa })`)

The engine measures the video while it renders: every frame as it is read back for the encoder, and the audio as it is mixed. No second decode pass, and the numbers describe exactly what was encoded.

```typescript
import { formatQaReport } from "framefields";

const result = await comp.renderVideo({
  outputPath: "output/final-video.mp4",
  qa: { targetLufs: -14 }, // or `qa: true` for defaults (no loudness target)
});
console.log(formatQaReport(result.qa!));
if (!result.qa!.passed) process.exitCode = 1; // fail CI / the agent loop
```

`result.qa` is structured, so branch on it instead of parsing logs:

| `issues[].code` | Severity | Meaning |
|---|---|---|
| `frames_missing` | error | Fewer frames encoded than the composition has |
| `black_frames` | warning | ≥ `minBlackSec` (0.5 s) of black frames; has `startSec`/`endSec` |
| `audio_clipping` | warning | Samples at or beyond full scale |
| `loudness_off_target` | warning | Integrated loudness more than `lufsTolerance` (1 LU) from `targetLufs` |
| `animation_truncated` | warning | Keyframes past a layer's clip window never play; has `layerId` |
| `frozen_video` | info | Picture unchanged for ≥ `minFrozenSec` (2 s); fine for held title cards |
| `audio_silence` | info | ≥ `minSilenceSec` (2 s) below `silenceDbfs` (-60) |
| `audio_silent` | info | The whole track is silent |
| `invalid_gradient` | error | A `background` / `fill` gradient string that does not parse: it draws nothing |
| `unsupported_image_format` | error | An image layer receiving a `.json` / `.lottie` vector animation, video, or audio file |
| `unknown_color` | warning | A color string that is not a color: it draws transparent |
| `low_contrast_text` | warning | Text below 3:1 contrast against the solid color behind it (suggests a readable one) |
| `offscreen_layer` | warning | A static absolute layer entirely outside the canvas |
| `duplicate_id` | error | Two layers share an id: the renderer keeps one and drops the other |
| `shadow_unsupported_light` | warning | `castShadow` on a point or ambient light |
| `pbr_without_environment` | info | `roughness` / `metallic` set but no `Layer.environment()` (no physical shading) |
| `static_track` | info | Every keyframe on a track holds the same value |

The document checks also run on their own, before any render: `comp.lint()` returns the same `{ severity, code, message, layerId }` entries. Run it in Step 1, right after typechecking.

`passed` is false when any error or warning is present. `qa.audio.integratedLufs` is ITU-R BS.1770 loudness (streaming platforms normalize to about -14 LUFS); `qa.audio.peakDbfs` is the sample peak.

## Inspecting a Finished File with ffmpeg

For files rendered elsewhere, or to compare against a previous render, inspect with `ffmpeg`/`ffprobe`:

```bash
# 1. Check video and audio stream properties
ffprobe -v error -show_entries stream=codec_name,width,height,duration,r_frame_rate output/final-video.mp4

# 2. Detect unexpected black frames or dead transitions
ffmpeg -i output/final-video.mp4 -vf "blackdetect=d=0.5:pix_th=0.10" -f null -

# 3. Verify audio loudness levels (prevent clipping / silence)
ffmpeg -i output/final-video.mp4 -af "volumedetect" -f null -
```

---

## Common Rendering Failure Modes

| Symptom | Root Cause | Solution |
|---|---|---|
| Entire frame renders black | Missing font registration or `NaN` in a signal | Register every font `Layer.text` uses with `FontManager.register()` before building layers. Check signal outputs are finite numbers. |
| Media layer is invisible / blank | Wrong path, an LFS pointer file, or zero opacity | Check the path exists and is real media (`git lfs pull`, `framefields assets pull`), and `opacity > 0`. |
| Audio cuts out early | Missing `durationFrames` on audio layer | Explicitly assign `durationFrames: totalFrames` on `Layer.audio()`. |
| Vision cutout / mask is empty on a single `renderFrame` | Vision reads the previous rendered frame; frame 0 has none | Render two or more consecutive frames with the same `HeadlessMediaRenderer` and keep the last. `renderVideo` handles this automatically. |
| Ghosted double of the subject in a vision cutout | Frames rendered out of order (frame grid, or jumping from frame 3 to 48), so the cutout uses pixels from another frame | Verify vision layers with sequential frames or the exported MP4, not `renderFrameGrid`. |
| Output stops after `Rendered 100%` | Audio is being mixed, encoded or muxed | Not a hang: wait for `Still …` lines and `Done in …` (see **Reading render progress**). |
| Script hangs after `Done in …` | Background worker thread pool held open | Always include `process.exit(0)` at the end of render scripts. |
| Render very slow on a Linux server | Frames drawn on a CPU adapter (lavapipe) | `await describeGpu()` shows `software: true`; fix the GPU's Vulkan driver (`vulkaninfo --summary`). |
| Encoder fails to open (`h264_rkmpp`, NVENC) | framefields < 2.2 uses the hardware encoder untested | Use framefields 2.2+, which falls back to libx264 etc., or set `FRAMEFIELDS_HW_CODECS=off`. |
| Render worker or cloud render fails | Project not render-ready (lockfile, export, LFS) | Read the `code` and `hint`; see **Cloud render failures** above and https://framefields.dev/docs/guides/render-service/ |
| Stitched video has a jump at a chunk seam | Chunks rendered with different framefields versions, settings or GPU types, or a stateful effect that reads wall-clock time | Render all chunks from one commit and one job; keep effects deterministic in the frame number. |
| An effect shows no change | Value on the wrong scale (e.g. `Vignette` `strength: 0.4` on its 0–100 scale) | Look the prop up in the `framefields-effects` catalog. |
| Text looks misaligned or truncated | Layout node box smaller than text string | Set explicit wrapping `width` (e.g. `width: 1400`) or use `width: "fill"`. |
