---
name: framefields
description: Start a new framefields video project, or add framefields to an existing Node.js project. Use when the user wants to make a video with framefields and the project has no framefields setup yet, or asks how to install framefields, scaffold a composition and render script, get from an empty folder to a first MP4, or generate images, video, music or voice for a film with AI models (`ai` from framefields, the framefields AI gateway, FRAMEFIELDS_API_KEY). Hands off to framefields-compose, framefields-effects, and framefields-render for the details.
---

# framefields

## Overview
`framefields` is a code-first video SDK. A video is a TypeScript `Composition` (a tree of layers with keyframed animation) that renders natively on WebGPU (Dawn) in Node.js, with no browser, Puppeteer, or Chromium. The engine is the [`framefields`](https://www.npmjs.com/package/framefields) npm package; everything below runs in the user's own project.

This skill takes a project from nothing to a verified first render. For anything past that, load the specialist skill:

| Task | Skill |
| --- | --- |
| Scenes, layout, typography, animation, beat grids, film structure | `framefields-compose` |
| Post-processing, color grading, VFX, on-device vision (tracking, cutouts, pose) | `framefields-effects` |
| Frame inspection, frame grids, pixel tests, video export and QA | `framefields-render` |
| Generating images, video, music, voice with AI models (`ai`) | this skill, section 6 |
| Reporting bugs or engine defects to GitHub | this skill, section 8 |

---

## 1. Check the environment

- **Node.js 22 or later.** Run `node --version`. Older versions fail at import.
- **A GPU, or a CPU renderer.** macOS uses Metal (every Mac and macOS VM has a Metal GPU). Linux uses Vulkan, Windows Direct3D 12 or Vulkan. Without a GPU, framefields renders on the CPU: on Linux (a sandbox, CI runner or container) through Mesa lavapipe, installed with `apt-get install -y libvulkan1 mesa-vulkan-drivers`; on Windows through WARP (built into Windows) or lavapipe. Every feature renders the same there (text, media, Lottie, effects, 3D, vision), only slower: about 12× slower than an M1 Pro's GPU in our Linux test. `describeGpu()` reports `software: true`. Fine for frames, grids and short exports; for long films, use a GPU machine or the render worker (`framefields-render`).
- **An ES module project.** The project's `package.json` needs `"type": "module"`.

## 2. Install

Use the package manager the project already uses (look for `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, or `package-lock.json`).

**Write `package.json` before installing.** npm 11, pnpm 10, and bun block dependency install scripts unless the project approves them, and framefields needs exactly one: `skia-canvas` downloads its native binary in its install script. Without it, `import "framefields"` fails with `Cannot find module '.../skia.node'`. The other packages that ship install scripts work without them, so deny them to keep installs quiet and skip downloads framefields never uses.

For a new project, create `package.json` with all three blocks. In an existing project, merge them into its `package.json`, keeping any entries it already has:

```json
{
  "name": "my-film",
  "private": true,
  "type": "module",
  "allowScripts": {
    "skia-canvas": true,
    "sharp": false,
    "webgpu": false,
    "onnxruntime-node": false,
    "node-av": false,
    "esbuild": false
  },
  "pnpm": {
    "onlyBuiltDependencies": ["skia-canvas"],
    "ignoredBuiltDependencies": ["sharp", "webgpu", "onnxruntime-node", "node-av", "esbuild"]
  },
  "trustedDependencies": ["skia-canvas"]
}
```

`allowScripts` is read by npm, `pnpm` by pnpm, and `trustedDependencies` by bun; each tool ignores the others' fields. Yarn runs install scripts by default and needs none of them. Also add `"packageManager"` with the exact manager and version you install with (e.g. `"pnpm@10.13.1"`), and commit the lockfile the install writes (pnpm, npm or yarn; bun lockfiles can't be rendered by the worker). Then install:

```bash
npm install framefields
npm install --save-dev tsx typescript @types/node
```

The install must finish without an `install-scripts` warning. If framefields was installed before the approval was in place, add it and rerun the skipped script with `npm rebuild skia-canvas` (`pnpm rebuild skia-canvas`). Never approve every script wholesale (`npm install-scripts approve --all`).

A minimal `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

## 3. Scaffold the project

Keep the composition separate from the script that renders it, so tests, the preview, the render script and the render worker all build the same film. `film.ts` must only build: no rendering, no `process.exit()`, no writes at import time.

```
src/
  theme.ts    # canvas size, fps, colors, fonts: the only place for magic numbers
  film.ts     # buildFilm(): assembles the Composition
  render.ts   # renders frames for review, a live preview, or the full video
assets/
  fonts/      # .ttf / .otf files the film uses
  footage/    # source videos (.mp4, .mov) and audio (.mp3, .wav) tracked in Git LFS
output/       # renders (add to .gitignore)
```

Text needs a real font file. Ask the user which font to use.

```typescript
// src/theme.ts
import { FontManager } from "framefields";

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const INK = "#0E0D0C";
export const PAPER = "#EEE9E0";
export const SANS = "Inter";

export async function registerFonts(): Promise<void> {
  await FontManager.register({ family: SANS, source: "assets/fonts/Inter.ttf" });
}
```

```typescript
// src/film.ts
import { Composition, Layer, LayerAnimation } from "framefields";
import { FPS, H, INK, PAPER, registerFonts, SANS, W } from "./theme.js";

const DURATION = 3 * FPS; // frames

export async function buildFilm(): Promise<Composition> {
  // Fonts must be registered before any text layer is built.
  await registerFonts();

  const film = new Composition({
    width: W,
    height: H,
    fps: FPS,
    durationMs: (DURATION / FPS) * 1000,
    backgroundColor: INK,
  });

  film.add(
    Layer.text("Hello, framefields", {
      id: "title",
      position: "absolute",
      x: 0,
      y: H / 2 - 60,
      width: W,
      height: 120,
      fontFamily: SANS,
      fontSize: 96,
      fontWeight: 700,
      fill: PAPER,
      align: "center",
    }).animate(
      LayerAnimation.create()
        .fadeIn(0, 20, "power2.out")
        .fromTo("y", H / 2 - 20, H / 2 - 60, { start: 0, end: 30, ease: "expo.out" }),
    ),
  );

  return film;
}
```

```typescript
// src/render.ts
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer, startPreview } from "framefields";
import { buildFilm } from "./film.js";

const OUT = path.resolve(import.meta.dirname, "../output");
const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
  // The page runs film.ts itself and renders it with WebGPU in the browser.
  const session = await startPreview({ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" });
  console.log(`Preview at ${session.url}`);
  await session.closed; // until its tab closes or the next preview replaces it
  process.exit(0);
}

const film = await buildFilm();
await fs.mkdir(OUT, { recursive: true });

if (mode === "frames") {
  const renderer = new HeadlessMediaRenderer();
  for (const frame of args.map(Number)) {
    const png = await film.renderFrame({ frame, renderer });
    await fs.writeFile(path.join(OUT, `f${String(frame).padStart(4, "0")}.png`), png);
  }
} else if (mode === "grid") {
  const png = await film.renderFrameGrid({
    frames: args.length ? args.map(Number) : [0, 10, 20, 30, 45, 60, 75, 89],
    columns: 4,
    cellWidth: 480,
    showLabels: true,
  });
  await fs.writeFile(path.join(OUT, "grid.png"), png);
} else {
  const result = await film.renderVideo({
    outputPath: path.join(OUT, "output.mp4"),
    quality: "high",
  });
  await result.cleanup?.();
  console.log(`Exported ${result.filePath}`);
}

// Native GPU and encoder threads keep Node alive; always exit explicitly.
process.exit(0);
```

Add scripts to `package.json`:

```json
"scripts": {
  "typecheck": "tsc --noEmit -p .",
  "frames": "tsx src/render.ts frames",
  "grid": "tsx src/render.ts grid",
  "preview": "tsx src/render.ts preview",
  "render": "tsx src/render.ts"
}
```

### Video assets & Git LFS

Video inputs (`Layer.video("assets/footage/clip.mp4")`), Lottie animations (`Layer.lottie(...)`), audio tracks (`Layer.audio(...)`), LUTs, and custom fonts belong in **Git LFS**, while render outputs in `output/` belong in `.gitignore`.

1. **Initialize Git LFS:**
   ```bash
   git lfs install
   ```

2. **Configure `.gitattributes` at the project root:**
   ```gitattributes
   assets/**/*.mp4 filter=lfs diff=lfs merge=lfs -text
   assets/**/*.mov filter=lfs diff=lfs merge=lfs -text
   assets/**/*.webm filter=lfs diff=lfs merge=lfs -text
   assets/**/*.mp3 filter=lfs diff=lfs merge=lfs -text
   assets/**/*.wav filter=lfs diff=lfs merge=lfs -text
   assets/**/*.cube filter=lfs diff=lfs merge=lfs -text
   assets/**/*.lottie filter=lfs diff=lfs merge=lfs -text
   assets/fonts/**/*.ttf filter=lfs diff=lfs merge=lfs -text
   assets/fonts/**/*.otf filter=lfs diff=lfs merge=lfs -text
   ```

3. **Hydrate pointers before rendering:** In freshly cloned or containerized agent environments, LFS media exist as ~130-byte text pointer files. Framefields' native WebGPU and WebCodecs demuxers cannot decode pointers and will fail or produce blank frames. Always ensure pointers are hydrated:
   ```bash
   git lfs pull
   ```

4. **Keep `.gitignore` targeted:** Never add `*.mp4` to `.gitignore` when tracking source footage with LFS. Ignore output directories (`output/`, `scratch/`) instead.

## 4. Verify, cheapest step first

Never go straight to a full video render. On a machine without a GPU every render runs on the CPU (lavapipe or WARP), so the cheap steps matter even more. Each step catches problems in seconds that a video render takes minutes to show:

1. `npm run typecheck`
2. `npm run frames -- 0 30 60` and look at the PNGs in `output/`. A black frame usually means a missing font, a layer outside the canvas, or opacity stuck at 0.
3. `npm run grid` and check the motion reads smoothly across the contact sheet.
4. `npm run preview` when a person is watching: they play the film with sound before you export (see below).
5. `npm run render` once frames and motion look right.

Show the user the frame PNGs or the grid before the full render. `framefields-render` covers pixel-probe tests, render QA (`renderVideo({ qa })`), and diagnosing blank frames. If you suspect an issue or defect in the engine itself or ai gateway, see [section 8](#8-report-engine-issues).

### Live preview

`npm run preview` serves a localhost player (picture, sound, timeline) and prints its URL. The page runs `film.ts` itself and renders with WebGPU in real time, so the user sees the real film; a slow device skips frames to keep up with the sound.

- Run it as a background command and read its output: it says when the page opened, prints errors from the page (a failed build, a frame that threw, a missing font), and says why it stopped. It stops 5 s after its last tab closes; just run it again.
- It doesn't open anything. If your app has a built-in browser (Claude Code, Codex), open the URL there; otherwise give the user the link. `startPreview(..., { open: true })` opens their default browser.
- **Reference assets from the file's URL.** The page runs `film.ts` itself, so asset paths must resolve in the browser too: build them from the module's own URL, `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/fonts")`, rather than `process.cwd()` or a bare relative path. The preview serves any file inside the project (the folder with `package.json`); pass `root` (one or more paths) to `startPreview` for fonts or media kept elsewhere.
- After changing the film, run it again. It takes over the same URL, and the open tab reloads by itself at the same moment.
- Link to a moment with `#t=12.5` (seconds). In a browser you can script, `window.framefieldsPreview` has `seek(seconds)`, `play()`, `pause()` and `state()`; `seek` resolves once the frame is drawn, so screenshot after it.
- **The user can pin notes on the picture.** Pausing and clicking (or dragging an area) adds a note at that spot and moment. Each one prints in the preview's output and is saved in `.framefields/preview-notes/`: `notes.json`, plus `note-<id>.jpg`, the frame with the spot marked. When the user says they left notes, read `notes.json` and look at each open note's picture before you edit. Then run the preview again so they can check the changes and tick them off. `framefields-render` has the details.

## 5. Render on a server

The framefields render worker (Docker, RunPod pod or serverless) renders a pushed commit: it pulls LFS assets, installs from the lockfile, imports `src/film.ts`, calls `buildFilm`, and uploads the result. A project built as above works unchanged if:

- `framefields` is 2.2+, the lockfile is committed and matches `package.json`, and `packageManager` is pinned;
- every input is under `assets/`, tracked by Git LFS and pushed (`git lfs ls-files` lists it);
- asset paths come from `import.meta.url`, never `process.cwd()`;
- nothing writes into `node_modules` while rendering (files are shared read-only).

A failed job returns `{ code, hint, retryable }`; resubmit unchanged only when `retryable` is true. Job format and error codes: https://framefields.dev/docs/guides/render-service/

## 6. Generate assets with AI

`framefields` exports `ai`: hundreds of AI models (images, video, music, sound effects, voice, upscaling, background removal) through the framefields AI gateway, each named by its catalog id and billed to the user's framefields account. `run`, `subscribe`, `stream`, `queue` and `storage` cover every model.

```typescript
import { ai } from "framefields";

const { data, requestId } = await ai.subscribe<{ images: { url: string }[] }>("flux/schnell", {
  input: { prompt: "Neon street at night, rain, 35mm", image_size: "landscape_16_9" },
});
console.log(data.images[0].url);
```

**The key.** Requests authenticate with `FRAMEFIELDS_API_KEY` (an `ff_live_…` key from https://framefields.dev/dashboard/keys). Put it in the project's `.env` (gitignored) and load it with `tsx --env-file=.env`, or call `ai.config({ apiKey })`. Never write the key into source, and never ask the user to paste it into chat: ask them to add it to `.env` themselves. Without a key, every call throws before any request is sent. Failures throw `ApiError` with the gateway's `type`: on `insufficient_credits` (status `402`) tell the user to top up at https://framefields.dev/dashboard/billing rather than retrying; `key_limit_reached` means the key's monthly cap; `rate_limited` and `too_many_inflight_requests` mean wait and retry. A `ValidationError` (`422`) lists the bad input fields in `fieldErrors`.

**Generate once, into `assets/`, in its own script.** Generation costs money and is not deterministic, so it never runs inside `buildFilm()`, the preview, tests or the render worker. Write `src/generate.ts`, run it on purpose, download every output into `assets/generated/` (tracked in Git LFS, as above), and reference the local file from the film. Generated output URLs expire, and the worker renders from the repository.

```typescript
// src/generate.ts — run with: tsx --env-file=.env src/generate.ts
import fs from "node:fs/promises";
import path from "node:path";
import { ai } from "framefields";

const OUT = path.resolve(import.meta.dirname, "../assets/generated");
await fs.mkdir(OUT, { recursive: true });

async function save(url: string, name: string): Promise<string> {
  const file = path.join(OUT, name);
  await fs.writeFile(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return file;
}

const still = await ai.subscribe<{ images: { url: string }[] }>("flux/schnell", {
  input: { prompt: "Neon street at night, rain, 35mm", image_size: "landscape_16_9", seed: 7 },
});
await save(still.data.images[0].url, "street.jpg");

// Feed a local file to a model: put a Blob in the input and it is uploaded for you
// (or call ai.storage.upload(blob) yourself and pass the URL).
const image_url = new Blob([await fs.readFile(path.join(OUT, "street.jpg"))], { type: "image/jpeg" });
const clip = await ai.subscribe<{ video: { url: string } }>("kling-video/v2.1/standard/image-to-video", {
  input: { prompt: "slow push in, rain falling", image_url, duration: "5" },
  logs: true,
  onQueueUpdate: (u) => u.status === "IN_PROGRESS" && u.logs.forEach((l) => console.log(l.message)),
});
await save(clip.data.video.url, "street.mp4");
process.exit(0);
```

Then `Layer.image("assets/generated/street.jpg")` / `Layer.video("assets/generated/street.mp4")` in the film.

- **Pick the model and its input from the catalog.** https://framefields.dev/models lists every model with its id, category, price per unit and input schema. Each model has its own input and output fields (`images[0].url`, `video.url`, `audio.url`, `audio_file.url` …): read the schema and pass the output shape as the type argument, or log `data` once, instead of guessing.
- **Long jobs** (video, music): `subscribe` waits and polls. For several at once, `ai.queue.submit(model, { input })` each, keep every `request_id`, then `ai.queue.result(model, { requestId })`; an interrupted script can collect the results instead of paying again. Reading a status or result is free and retried on transient errors; submitting is never retried, so it can't bill twice.
- **Ask before spending.** Before a batch, or before any video model, tell the user which models you will call, how many times, and the catalog price; generate a single draft first and show it.
- Pass a fixed `seed` where the model accepts one, and keep the prompts in `generate.ts`, so a result can be regenerated.
- Frame-rate and size: generated clips rarely match the composition's `fps` or aspect. Use `fit: "cover"` on the layer, and check the clip's real duration before cutting to it.

## 7. Grow the film

Once the first render works, move to the specialist skills: `framefields-compose` for splitting the film into scene modules on a beat grid, `framefields-effects` for grading, grain, and vision-driven effects, and `framefields-render` for tests and delivery checks. Keep `theme.ts` as the single source of sizes, colors, fonts, and timing as the project grows.

## 8. Report engine issues

When you encounter an unexpected crash, native WebGPU / Dawn failure, WGSL shader compilation error, compositor schema validation defect, or behavior bug in `framefields` itself (distinguishable from project-level configuration or asset errors):

1. **Ask the user first:** Never open an issue autonomously without explicit confirmation. Explain what went wrong, summarize the reproduction, and ask if they would like an issue reported to `gatewai-dev/framefields`.
2. **Collect diagnostic details:**
   - Operating system and architecture (`process.platform`, `process.arch`).
   - Node.js version (`node --version`) and `framefields` version.
   - GPU backend and device (run `describeGpu()` or note Metal, Vulkan, DX12, or CPU lavapipe/WARP).
   - Minimal reproduction code (the smallest composition or script that triggers it).
   - Exact error message, full stack trace, or validation failure log.
3. **Open the issue:** Once the user confirms, submit the issue via GitHub CLI:
   ```bash
   gh issue create --repo gatewai-dev/framefields --title "<concise summary>" --body "<diagnostic details and repro>"
   ```
   If `gh` is unavailable or not authenticated in the environment, output the title, formatted body, and a direct link for the user: https://github.com/gatewai-dev/framefields/issues/new.
