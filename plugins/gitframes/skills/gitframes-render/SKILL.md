---
name: gitframes-render
description: Render, inspect, test, and export high-performance WebGPU video and frame grids with the gitframes headless engine. Use when verifying compositions, diagnosing blank frames, profiling GPU pipelines, running visual frame grids, or exporting final MP4 video in gitframes.
---

# gitframes-render

## Setup
These skills drive the [`gitframes`](https://www.npmjs.com/package/gitframes) npm package. If the project doesn't depend on it yet, add it with the project's package manager (`npm install gitframes`, or the `pnpm`/`yarn`/`bun` equivalent) and import from `"gitframes"`. It needs Node.js 22 or later and a WebGPU-capable GPU (Metal or Vulkan).

## Overview
`gitframes` renders headlessly in Node.js on top of native WebGPU (Dawn) and mediabunny WebCodecs hardware encoders. It does not run a browser, Puppeteer, or Chromium.

Because video rendering is resource-intensive and native GPU pipelines run asynchronously in worker pools, gitframes workflows enforce a strict **verification ladder**: inspect inexpensive intermediate artifacts first before committing to a full video render.

---

## The 5-Step Verification Ladder

Always proceed through the ladder in order. Catching a layout or timing bug at step 1 or 2 takes seconds; catching it after a 30-second 4K video render wastes minutes.

### Step 1: Static Typecheck & Schema Validation
Before touching the GPU, verify TypeScript types and parse the composition against the strict runtime schema:

```typescript
import { CompositorProgramSchema } from "gitframes";

// 1. Compile spec
const spec = comp.toSpec();

// 2. Validate against strict schema
const parsed = CompositorProgramSchema.safeParse(spec);
if (!parsed.success) {
  console.error("Schema validation failed:", parsed.error.format());
  process.exit(1);
}
```

Typecheck the project:
```bash
npx tsc --noEmit -p .
```

---

### Step 2: Single Frame Inspection (`renderFrame`)
Render isolated keyframe points (e.g. entry, peak action, exit) directly to PNG files on disk to inspect alignment, typography, colors, and opacity:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "gitframes";

const renderer = new HeadlessMediaRenderer();

// Render frame 45 (1.5s at 30fps)
const pngBuffer = await comp.renderFrame({
  frame: 45,
  renderer,
});

await fs.writeFile("output/frame-45.png", pngBuffer);
```

---

### Step 3: Motion & Layout Stability Contact Sheets (`renderFrameGrid`)
To verify easing curves, cut points, kinetic sweeps, or text wrapping without encoding a full video, generate a sequential frame grid image:

```typescript
import fs from "node:fs/promises";
import { renderFrameGrid } from "gitframes";

// Samples frames across the intro sweep (frames 0 to 60)
const gridPng = await comp.renderFrameGrid({
  frames: [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
  columns: 4,
  cellWidth: 480, // Downscaled thumbnail size for rapid visual scanning
  showFrameNumbers: true,
  showTimestamps: true,
});

await fs.writeFile("output/intro-grid.png", gridPng);
```

Contact sheets immediately reveal:
- Motion hitches and non-smooth easing deceleration.
- Text clipping or wrapping jumps across keyframe boundaries.
- Bad layer z-indexing or missing cut transitions.

---

### Step 4: Programmatic Conformance Probes in Vitest
Write automated headless vitest tests that assert pixel colors, transparency, or layout bounding boxes:

```typescript
import { describe, it, expect } from "vitest";
import { HeadlessMediaRenderer } from "gitframes";
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

### Step 5: Full Video Export (`renderVideo`)
Once static frames and motion grids are verified, encode the final MP4/WebM video:

```typescript
import path from "node:path";

const result = await comp.renderVideo({
  outputPath: "output/final-video.mp4",
  quality: "high", // "draft" | "medium" | "high" | "lossless"
  codec: "avc",    // "avc" (H.264) | "hevc" (H.265) | "vp9" | "av1"
  audioCodec: "aac",
  concurrency: 4,  // Parallel frame encoding threads
});

// Always invoke cleanup to release temporary frame cache and file handles
await result.cleanup?.();
```

Pass `qa: true` to have the engine check the output while it renders (see **Built-in Video QA** below) and return the findings as `result.qa`.

---

## Production Render Script Pattern

Production projects structure their `src/render.ts` to support both quick frame probes and full exports from the CLI:

```typescript
// src/render.ts
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "gitframes";
import { buildFilm } from "./film.js";

const OUT = path.resolve(import.meta.dirname, "../output");
const [mode = "video", ...args] = process.argv.slice(2);

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

# Render full master video:
tsx src/render.ts
```

---

## Built-in Video QA (`renderVideo({ qa })`)

The engine measures the video while it renders: every frame as it is read back for the encoder, and the audio as it is mixed. No second decode pass, and the numbers describe exactly what was encoded.

```typescript
import { formatQaReport } from "gitframes";

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
| Entire frame renders black | Missing font registration or `NaN` in uniform | Ensure every font used in `Layer.text` is registered via `FontManager.register()` and listed in `comp.fonts`. Verify all signal outputs are finite numbers. |
| Media layer is invisible / blank | Bad input handle binding or zero opacity | Check that the media path exists and `opacity > 0`. If using an effect or section, ensure `fit: "cover"` and valid container dimensions. |
| Audio cuts out early | Missing `durationFrames` on audio layer | Explicitly assign `durationFrames: totalFrames` on `Layer.audio()`. |
| Vision cutout / mask is empty on a single `renderFrame` | Vision reads the previous rendered frame; frame 0 has none | Render two or more consecutive frames with the same `HeadlessMediaRenderer` and keep the last. `renderVideo` handles this automatically. |
| Ghosted double of the subject in a vision cutout | Frames rendered out of order (frame grid, or jumping from frame 3 to 48), so the cutout uses pixels from another frame | Verify vision layers with sequential frames or the exported MP4, not `renderFrameGrid`. |
| Script hangs after rendering | Background worker thread pool held open | Always include `process.exit(0)` at the end of render scripts. |
| Text looks misaligned or truncated | Layout node box smaller than text string | Set explicit wrapping `width` (e.g. `width: 1400`) or use `width: "fill"`. |
| Colors appear washed out / dark edges | Unpremultiplied alpha blending | The engine operates with premultiplied alpha. Ensure custom shaders use `srcFactor: "one"`. |
