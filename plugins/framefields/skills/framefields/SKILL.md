---
name: framefields
description: Start a new framefields video project, or add framefields to an existing Node.js project. Use when the user wants to make a video with framefields and the project has no framefields setup yet, or asks how to install framefields, scaffold a composition and render script, get from an empty folder to a first MP4, store footage (asset buckets, Git LFS), generate images, video, music or voice for a film with AI models (`ai` from framefields, the framefields AI gateway), or add ready-made components (pointers, captions, title cards, device frames …) with `npx framefields add`. Hands off to framefields-compose, framefields-effects, framefields-vision, framefields-render and framefields-cloud for the details.
---

# framefields

A video is a TypeScript `Composition` (a layer tree with keyframed animation) rendered natively on WebGPU (Dawn) in Node.js, no browser. The engine is the [`framefields`](https://www.npmjs.com/package/framefields) npm package. This skill takes a project to a verified first render; then load the specialist:

| Task | Skill |
| --- | --- |
| Scenes, layout, typography, animation, 3D, physics, film structure | `framefields-compose` |
| Post-processing, grading, stylized looks | `framefields-effects` |
| Detection, cutouts, pose, tracking a specific person (SAM 2.1 / SAM 3) | `framefields-vision` |
| Frames, grids, pixel tests, live preview, export, QA | `framefields-render` |
| Rendering on framefields' cloud GPUs or a self-hosted worker | `framefields-cloud` |

## 1. Environment

- **Node.js 22+** and an ES module project (`"type": "module"`).
- **A GPU or a CPU renderer.** macOS: Metal. Linux: Vulkan, or Mesa lavapipe on the CPU (`apt-get install -y libvulkan1 mesa-vulkan-drivers`). Windows: D3D12/Vulkan, or WARP. On the CPU everything renders the same, ~12× slower (`describeGpu()` reports `software: true`).

## 2. Install: `npx framefields init`

```bash
npx framefields init my-film --install      # or `init` inside an existing project
```

It writes `package.json` (install-script approvals, scripts, dependencies, `packageManager`), `tsconfig.json`, `src/theme.ts` / `film.ts` / `render.ts`, `assets/`, LFS `.gitattributes`, `.gitignore`, `.env.example`, and `framefields.json` (components folder, fonts, a `film` render). It downloads Inter, JetBrains Mono and Noto Color Emoji (pinned, OFL), registers them in `src/components/fonts.ts`, and runs `git init`. It never prompts or overwrites: existing files are kept and `package.json`, `.gitignore`, `.gitattributes` only gain what they lack (a `"type": "commonjs"` package is refused). Options: `--pm npm|pnpm|yarn|bun`, `--no-fonts`, `--no-emoji`, `--no-git`, `--name`.

**By hand**, use the project's package manager and write `package.json` *before* installing. npm 11, pnpm 10 and bun block install scripts; framefields needs exactly one (`skia-canvas`, else `Cannot find module '.../skia.node'`). Deny the rest:

```json
{
  "type": "module",
  "allowScripts": { "skia-canvas": true, "sharp": false, "webgpu": false, "onnxruntime-node": false, "node-av": false, "esbuild": false, "protobufjs": false },
  "pnpm": {
    "onlyBuiltDependencies": ["skia-canvas"],
    "ignoredBuiltDependencies": ["sharp", "webgpu", "onnxruntime-node", "node-av", "esbuild", "protobufjs"]
  },
  "trustedDependencies": ["skia-canvas"]
}
```

`allowScripts` is npm's, `pnpm` pnpm's, `trustedDependencies` bun's; yarn needs none. Pin `"packageManager"` and commit the lockfile. Then `npm install framefields` and `npm install -D tsx typescript @types/node`. The install must finish without an `install-scripts` warning; if it didn't, add the approval and `npm rebuild skia-canvas`. Never approve every script wholesale. `tsconfig.json`: `module`/`moduleResolution` `NodeNext`, `target` `ES2022`, `strict`, `skipLibCheck`, `noEmit`, `types: ["node"]`, `include: ["src/**/*"]`.

## 3. Project shape

```
src/theme.ts    # size, fps, colors, fonts: the only place for magic numbers
src/film.ts     # buildFilm(): builds the Composition, nothing else
src/render.ts   # frames and contact sheets for quick looks
assets/         # fonts/, footage/ (bucket or Git LFS)
output/         # renders (git-ignored)
framefields.json
```

`film.ts` must only build (no rendering, `process.exit()` or writes at import): tests, preview, CLI and the cloud all import it. Text needs a real font file; ask the user which.

```typescript
// src/theme.ts
import { FontManager } from "framefields";
export const W = 1920, H = 1080, FPS = 30;
export const INK = "#0E0D0C", PAPER = "#EEE9E0", SANS = "Inter";
export async function registerFonts() {
  await FontManager.register({ family: SANS, source: "assets/fonts/Inter.ttf" });
}
```

```typescript
// src/film.ts
import { Composition, Layer, LayerAnimation } from "framefields";
import { FPS, H, INK, PAPER, registerFonts, SANS, W } from "./theme.js";

export async function buildFilm(): Promise<Composition> {
  await registerFonts(); // before any text layer
  const film = new Composition({ width: W, height: H, fps: FPS, durationMs: 3000, backgroundColor: INK });
  film.add(
    Layer.text("Hello, framefields", {
      position: "absolute", x: 0, y: H / 2 - 60, width: W, height: 120,
      fontFamily: SANS, fontSize: 96, fontWeight: 700, fill: PAPER, align: "center",
    }).animate(LayerAnimation.create().fadeIn(0, 20, "power2.out").fromTo("y", H / 2 - 20, H / 2 - 60, { start: 0, end: 30, ease: "expo.out" })),
  );
  return film;
}
```

```typescript
// src/render.ts: `tsx src/render.ts frames 0 30 60` or `tsx src/render.ts grid`
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "framefields";
import { buildFilm } from "./film.js";

const OUT = path.resolve(import.meta.dirname, "../output");
const [mode = "frames", ...args] = process.argv.slice(2);
const film = await buildFilm();
await fs.mkdir(OUT, { recursive: true });
if (mode === "grid") {
  const frames = args.length ? args.map(Number) : [0, 10, 20, 30, 45, 60, 75, 89];
  await fs.writeFile(path.join(OUT, "grid.png"), await film.renderFrameGrid({ frames, columns: 4, cellWidth: 480, showLabels: true }));
} else {
  const renderer = new HeadlessMediaRenderer();
  for (const frame of (args.length ? args : ["0"]).map(Number))
    await fs.writeFile(path.join(OUT, `f${String(frame).padStart(4, "0")}.png`), await film.renderFrame({ frame, renderer }));
}
process.exit(0); // native threads keep Node alive
```

Scripts: `typecheck` (`tsc --noEmit -p .`), `frames`, `grid`, `check` (`framefields check`), `check:render`, `preview` (`framefields preview film`), `render` (`framefields render film`), `render:cloud` (`framefields render film --cloud`). All three CLI commands read the `film` render in `framefields.json`, so local and cloud renders write the same file. For another cut (teaser, vertical, language) add an export and a named render (`framefields-render`), not a flag.

### Assets: a bucket, or Git LFS

Footage, audio, Lottie, LUTs and generated media don't belong in plain git; small files (logos, a LUT) can be committed.

**Preferred: `framefields assets` on an S3-compatible bucket** (suggest Cloudflare R2: no egress fees). Files stay out of git; `framefields.json` pins each by sha256.

```json
"storage": { "remotes": { "media": {
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com", "bucket": "films", "prefix": "launch/",
  "publicUrl": "https://media.example.com"
} } }
```

- `publicUrl` (optional) lets reads skip keys; objects upload `immutable`. AWS needs `region`. Several remotes: `default` names where new assets go, `--remote` picks another.
- Keys come from the environment only: `FRAMEFIELDS_STORAGE_MEDIA_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` (remote name upper-cased) or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Ask the user to set them; never print or write them.
- `npx framefields assets add assets/footage` hashes, uploads what's missing, records under `assets`, git-ignores them. Commit `framefields.json` and `.gitignore`. `assets pull` (verified; `--overwrite` replaces local edits), `assets status` (`ok` / `missing` / `changed`), `assets push`.
- Code uses ordinary paths. Where files are missing, `framefields preview` streams them from the bucket (needs a CORS rule: https://framefields.dev/docs/guides/assets/#preview-from-the-bucket), `framefields render` pulls them first, `framefields check` says to pull.

**Or Git LFS** (init writes `.gitattributes`). Fresh clones hold ~130-byte pointers that render blank: `git lfs pull` first, and never git-ignore LFS-tracked media. LFS bandwidth is billed to the repo owner on every clone and cloud render.

## 4. Verify, cheapest first

1. `npm run typecheck`, then `npm run check`.
2. `npm run frames -- 0 30 60` and look at the PNGs. Black usually means a missing font, a layer off canvas, or opacity stuck at 0.
3. `npm run grid` for motion.
4. `npm run preview` when a person is watching (background command; give them the URL; read their pinned notes). Details in `framefields-render`.
5. `npm run render` in the background with a long timeout. A pause after the last frame is audio mix/mux, not a hang.

Show the user frames or the grid before the full render. For long films or no GPU, `npm run render:cloud` (`framefields-cloud`).

## 5. Generate assets with AI

The Framefields MCP server (when connected) answers `list_models`, `get_model_schema` and `estimate_generation_cost`; in Claude Code they're `mcp__plugin_framefields_framefields__*`. It does not run jobs: generation runs through `ai` from `framefields`, authenticated by a gateway key (`FRAMEFIELDS_API_KEY`, `ff_live_…` from https://framefields.dev/dashboard/keys), not the MCP connection.

**The key:** ask the user to set it in the environment themselves (init writes `.env.example`; `render.ts` loads `.env`). Never ask for it in chat, print it, inspect env or credential files, embed or commit it.

**Generate once, into `assets/`, in its own script.** It costs money and isn't deterministic, so never call `ai` from `buildFilm()`, the preview, tests or the worker. Download outputs (their URLs expire) into `assets/generated/`, pin them (`framefields assets add`), reference the local files.

```typescript
// src/generate.ts
import fs from "node:fs/promises";
import path from "node:path";
import { ai } from "framefields";

const apiKey = process.env.FRAMEFIELDS_API_KEY;
if (!apiKey) throw new Error("Set FRAMEFIELDS_API_KEY before generating assets.");
ai.config({ apiKey });
const OUT = path.resolve(import.meta.dirname, "../assets/generated");
await fs.mkdir(OUT, { recursive: true });
const save = async (url: string, name: string) =>
  fs.writeFile(path.join(OUT, name), Buffer.from(await (await fetch(url)).arrayBuffer()));

const still = await ai.subscribe<{ images: { url: string }[] }>("seedream/4.5", {
  input: { prompt: "Neon street at night, rain, 35mm", image_size: "landscape_16_9", seed: 7 },
});
await save(still.data.images[0].url, "street.jpg");

// A Blob in the input is uploaded for you (or ai.storage.upload(blob) and pass the URL).
const image_url = new Blob([await fs.readFile(path.join(OUT, "street.jpg"))], { type: "image/jpeg" });
const clip = await ai.subscribe<{ video: { url: string } }>("seedance/2.0/image-to-video", {
  input: { prompt: "slow push in, rain falling", image_url, duration: "5" },
});
await save(clip.data.video.url, "street.mp4");
process.exit(0);
```

- **Models and inputs come from the catalog** (https://framefields.dev/models or `get_model_schema`). Output shapes differ (`images[0].url`, `video.url`, `audio.url` …): read the schema or log `data` once.
- **Audio:** `elevenlabs/v4` (or the cheaper `elevenlabs/v4-turbo`) for voiceover takes `{ text, voice_id? }` and returns `audio.url`, plus `alignment`: per-character start and end seconds, which you can use for captions and lip sync without transcribing. `elevenlabs/music-v2.5` takes `{ prompt, music_length_ms?, force_instrumental? }` or a section-by-section `composition_plan`. `elevenlabs/sound-effects-v3` takes `{ text, duration_seconds?, loop? }`. Each returns an MP3 at `audio.url`, with its length in `audio.duration`.
- **Many long jobs:** `ai.queue.submit` each, keep the `request_id`s, collect with `ai.queue.result`. Status and result reads are free and retried; submits never retry, so nothing bills twice.
- **Costs:** quote the estimate tool or catalog rate; don't invent a total from a unit rate. Use a fixed `seed` and keep prompts in `generate.ts`.
- Generated clips rarely match the film's fps or aspect: `fit: "cover"`, check real durations.
- **Errors** throw `ApiError` with `type`: `insufficient_credits` (402: user tops up at https://framefields.dev/dashboard/billing; don't retry), `key_limit_reached` (monthly cap), `rate_limited` / `too_many_inflight_requests` (wait, retry). `ValidationError` (422) lists `fieldErrors`.

**Agent payments.** `GET https://framefields.dev/.well-known/agent-payment.json` describes auth, packs and endpoints. `GET https://framefields.dev/api/v1/agent/balance` (bearer `FRAMEFIELDS_API_KEY`) returns `{ balance_usd, held_usd, available_usd }`: check it before big batches. A 402 carries `action_required.url`, a checkout link: pass it to the user. `POST https://framefields.dev/api/v1/agent/top-up` with `{"amount": 10 | 25 | 50 | 100}` creates one on demand.

## 6. Ready-made components

A registry of parametric motion components (mouse pointer with clicks, click zoom, window and device frames, word-timed captions, text reveals, counters, annotations, terminal, code blocks, title cards, lower thirds, chat threads, toasts, callouts, confetti, logo reveals, waveforms, before/after splits …). `framefields add` copies their source into the project, where it's ordinary code to read and change. **Run `npx framefields list` before hand-writing a common motion piece.**

```bash
npx framefields list [--json]                   # one line each, or props, deps, fonts, examples
npx framefields add mouse-pointer focus-zoom    # writes src/components/<name>/
npx framefields fonts add emoji                 # color emoji for plain Layer.text
```

```typescript
import { MousePointer } from "./components/mouse-pointer/index.js";
const pointer = MousePointer({ path: [{ to: [400, 300], at: 0 }, { to: [960, 540], at: 30, click: true }] });
film.add(pointer); // pointer.cues.clicks[0].frame: key a sound or press to the click
```

- Every component takes base props (`x`, `y`, `width`, `height`, `at`, `duration`, `hold`, `theme`, `enter`, `exit`, `seed`, `fps`, `canvas`; time in frames) and returns a box layer with `cues`, `span` and `parts`. Props are validated at build; each `index.ts` documents itself at the top.
- Files go to the folder saved in `framefields.json` (`--dir` on first use); dependencies come along. Installed code imports only `framefields` and `framefields/components`. After upgrading framefields, `add <name> --overwrite` refreshes; without it, edited files are `skipped`.
- Components needing emoji (`chat-thread`, `captions`) download Noto Color Emoji (pinned, ~10.7 MB) into `assets/fonts/` and write `src/components/fonts.ts`: call its `registerFonts()` before building. Emoji without an emoji font draw nothing (`lint` reports `missing_emoji_font`): install the font, don't remove the emoji.

## 7. Report engine issues

For a crash, Dawn/WebGPU failure, WGSL compile error, schema defect or behavior bug in framefields itself (not project config or assets):

1. **Ask the user first.** Summarize the problem and repro; never file autonomously.
2. Collect OS/arch, Node and framefields versions, GPU backend (`describeGpu()`), a minimal repro, the exact error and stack.
3. On confirmation: `gh issue create --repo gatewai-dev/framefields --title "…" --body "…"`. Without `gh`, give the user the title, body and https://github.com/gatewai-dev/framefields/issues/new.
