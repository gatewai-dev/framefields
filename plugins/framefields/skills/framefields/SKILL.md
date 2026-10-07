---
name: framefields
description: Start a new framefields video project, or add framefields to an existing Node.js project. Use when the user wants to make a video with framefields and the project has no framefields setup yet, or asks how to install framefields, scaffold a composition and render script, or get from an empty folder to a first MP4. Hands off to framefields-compose, framefields-effects, and framefields-render for the details.
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

---

## 1. Check the environment

- **Node.js 22 or later.** Run `node --version`. Older versions fail at import.
- **A WebGPU-capable GPU.** macOS uses Metal; Linux and Windows use Vulkan. Headless CI machines without a GPU can't render.
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

`allowScripts` is read by npm, `pnpm` by pnpm, and `trustedDependencies` by bun; each tool ignores the others' fields. Yarn runs install scripts by default and needs none of them. Then install:

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

Keep the composition separate from the script that renders it, so tests and the render script build the same film:

```
src/
  theme.ts    # canvas size, fps, colors, fonts: the only place for magic numbers
  film.ts     # buildFilm(): assembles the Composition
  render.ts   # renders frames for review, a live preview, or the full video
assets/
  fonts/      # .ttf / .otf files the film uses
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

## 4. Verify, cheapest step first

Never go straight to a full video render. Each step catches problems in seconds that a video render takes minutes to show:

1. `npm run typecheck`
2. `npm run frames -- 0 30 60` and look at the PNGs in `output/`. A black frame usually means a missing font, a layer outside the canvas, or opacity stuck at 0.
3. `npm run grid` and check the motion reads smoothly across the contact sheet.
4. `npm run preview` when a person is watching: they play the film with sound before you export (see below).
5. `npm run render` once frames and motion look right.

Show the user the frame PNGs or the grid before the full render. `framefields-render` covers pixel-probe tests, render QA (`renderVideo({ qa })`), and diagnosing blank frames.

### Live preview

`npm run preview` serves a localhost player (picture, sound, timeline) and prints its URL. The page runs `film.ts` itself and renders with WebGPU in real time, so the user sees the real film; a slow device skips frames to keep up with the sound.

- Run it as a background command and read its output: it says when the page opened, prints errors from the page (a failed build, a frame that threw, a missing font), and says why it stopped. It stops 5 s after its last tab closes; just run it again.
- It doesn't open anything. If your app has a built-in browser (Claude Code, Codex), open the URL there; otherwise give the user the link. `startPreview(..., { open: true })` opens their default browser.
- **Reference assets from the file's URL.** The page runs `film.ts` itself, so asset paths must resolve in the browser too: build them from the module's own URL, `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/fonts")`, rather than `process.cwd()` or a bare relative path. The preview serves any file inside the project (the folder with `package.json`); pass `root` (one or more paths) to `startPreview` for fonts or media kept elsewhere.
- After changing the film, run it again. It takes over the same URL, and the open tab reloads by itself at the same moment.
- Link to a moment with `#t=12.5` (seconds). In a browser you can script, `window.framefieldsPreview` has `seek(seconds)`, `play()`, `pause()` and `state()`; `seek` resolves once the frame is drawn, so screenshot after it.
- **The user can pin notes on the picture.** Pausing and clicking (or dragging an area) adds a note at that spot and moment. Each one prints in the preview's output and is saved in `.framefields/preview-notes/`: `notes.json`, plus `note-<id>.jpg`, the frame with the spot marked. When the user says they left notes, read `notes.json` and look at each open note's picture before you edit. Then run the preview again so they can check the changes and tick them off. `framefields-render` has the details.

## 5. Grow the film

Once the first render works, move to the specialist skills: `framefields-compose` for splitting the film into scene modules on a beat grid, `framefields-effects` for grading, grain, and vision-driven effects, and `framefields-render` for tests and delivery checks. Keep `theme.ts` as the single source of sizes, colors, fonts, and timing as the project grows.
