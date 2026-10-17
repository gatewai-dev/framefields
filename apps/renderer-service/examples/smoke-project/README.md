# framefields renderer smoke test

A test project for the framefields renderer worker. It exercises most of framefields in a few short videos, so one job shows whether a GPU host renders everything correctly.

| Export | Output | Covers |
|---|---|---|
| `film` | 12 s, 1280×720 | Scenes back to back with push / wipe / iris transitions, music, film grain |
| `title` | 4 s | Slug text with glyph animators (wave rise, kinetic sweep), matte reveal, flex layout, CSS gradients, star / circle / arrow / path shapes, trim-path draw-on, wiggle, layer style (drop shadow) |
| `media` | 4 s | JPEG image with a 3D LUT and curves, SVG, Lottie, video (color balance, vignette, rounded corners), video inside text (matte) |
| `effects` | 3 s | Blur (animated by a signal), halftone, gradient map, modulate, unsharp mask, flip symmetry, shadows/highlights, levels, selective color, tile offset |
| `charts` | 3 s | Bar, line and donut charts, SRT captions |
| `threeD` | 4 s | Studio environment (physically based shading, shadows, bloom), orbiting camera, chrome / satin / emissive primitives, extruded 3D text, glTF model |
| `vision` | 2 s | ONNX models on video: subject cutout with text behind it (segmentation), pose skeleton, tracked boxes |
| `all` | 3 files | `film`, `threeD` and `vision` from one job |

`film` includes `title`, `media`, `effects` and `charts`. Render a single scene when you need to isolate a failure.

Everything comes from `framefields` 2.2. The models for `vision` download on first use (about 80 MB) into `$FRAMEFIELDS_MODELS_DIR`, which the worker keeps on its cache volume. They run on the GPU through WebGPU (`onnxruntime-web`), and on the CPU when the adapter is a software one.

## Media files

The framefields repo keeps media out of git, so this folder ships with only the generated assets (`model.glb`, `badge.json`, `captions.srt`, `teal-orange.cube`) and the logo. Copy the rest from a framefields checkout (needs ffmpeg):

```bash
scripts/copy-media.sh            # from the checkout this folder is in
scripts/copy-media.sh ~/frameshop   # or from another checkout
```

This adds the fonts (Inter, Syne, JetBrains Mono, all under the SIL Open Font License) and, from `examples/19_framefields_film`, the portrait, a 6 s cut of the dancer video and the score.

## Run locally

```bash
scripts/copy-media.sh
pnpm install
pnpm render                 # all → output/film.mp4, threeD.mp4, vision.mp4
pnpm render title           # one export
pnpm render film --grid     # a frame grid PNG instead of a video
```

Inside the framefields monorepo (`apps/renderer-service/examples/smoke-project`), add `--ignore-workspace` to the pnpm commands so the project installs on its own.

On an Apple Silicon Mac, `film` renders in about 18 s, `threeD` in 2 s, and `vision` in about 24 s (three vision models per frame, on the GPU).

The project uses pnpm (`packageManager` in `package.json`), and the worker installs it with the same version. pnpm only runs the install scripts listed in `pnpm.onlyBuiltDependencies`, and framefields' native dependencies need theirs: skia-canvas, node-av (FFmpeg), webgpu and onnxruntime-node download or set up binaries, and esbuild checks its binary. `protobufjs` is listed under `ignoredBuiltDependencies`: its script only prints a version check.

## Use it as the worker's test repo

The worker renders from git, so push this folder as its own repository. Keep the media in Git LFS, which also tests the worker's LFS support:

```bash
scripts/copy-media.sh
cp -R . ~/framefields-smoke && cd ~/framefields-smoke
rm -rf node_modules output
git init -b main
git lfs install --local
git lfs track "*.mp4" "*.jpg" "*.mp3" "*.glb" "*.ttf" "*.cube"
git add -A && git commit -m "framefields smoke test"
git remote add origin https://github.com/<you>/framefields-smoke.git
git push -u origin main
```

Add `github.com/<you>/framefields-smoke` to the worker's `FF_REPO_ALLOWLIST`.

Keep the repo **private** unless you're sure the example media may be published: they aren't in the public framefields repo. A private repo also tests the worker's git auth: set `GIT_TOKEN` to a GitHub token that can read it (fine-grained, Contents: read-only).

## Jobs

`inline` works without storage: the videos come back base64-encoded in the result. The limit, `FF_INLINE_MAX_BYTES` (5 MB by default), applies to the job's outputs together:

- A single export (`film` about 3 MB, `threeD` about 1 MB, `vision` about 1 MB) fits the default.
- `all` returns about 7 MB, so set `FF_INLINE_MAX_BYTES=20971520` (20 MB) on the worker. Otherwise the job fails with `OUTPUT_TOO_LARGE` after rendering.
- With S3 storage configured, use `{"type": "s3", "key": "smoke/{jobId}/{name}.{ext}"}` instead; there's no size limit.

Everything:

```json
{
  "version": 2,
  "source": { "repo": "https://github.com/<you>/framefields-smoke", "ref": "main" },
  "target": { "entry": "src/film.ts", "export": "all" },
  "output": { "type": "inline" }
}
```

One part only, e.g. 3D:

```json
{
  "version": 2,
  "source": { "repo": "https://github.com/<you>/framefields-smoke", "ref": "main" },
  "target": { "entry": "src/film.ts", "export": "threeD" },
  "output": { "type": "inline" }
}
```

Over HTTP (a Pod), send it to the worker:

```bash
curl -s -X POST https://<pod-id>-8082.proxy.runpod.net/v2/jobs \
  -H "authorization: Bearer $RENDERER_API_KEY" -H "content-type: application/json" \
  -d @job.json
```

On RunPod Serverless, wrap it as `{"input": { ... }}` and send it to `/run`.

## What to check in the result

- `engine.gpu.software` is `false`, and the adapter name is the GPU (not `llvmpipe`).
- The worker log says `Using hardware video encoder` with `h264_nvenc` (on NVENC GPUs).
- `timings`: install time on a cold worker vs a warm one, and render time per output.
- `cache.lfs` is `miss` on the first job and `hit` after it.
- The videos: transitions between scenes, the logo spinning, the Lottie star, the glTF gem turning, the dancer drawn over "VISION".

## Files

- `src/film.ts`: the entry the worker loads, with all exports.
- `src/scenes/*.ts`: one file per scene.
- `src/theme.ts`: size, colors, fonts and asset paths. Paths resolve from the module, not the working directory.
- `scripts/make-assets.mjs`: generates `assets/model.glb` (a gem), `assets/badge.json` (a Lottie) and `assets/captions.srt`. The outputs are committed.
- `scripts/render.ts`: renders locally through the same exports.

## Assets

- Generated by `pnpm assets` (committed): `model.glb` (a faceted gem), `badge.json` (a Lottie star and ring), `captions.srt`, `teal-orange.cube` (a 17³ LUT).
- `logo.svg`: the framefields logo.
- Copied by `scripts/copy-media.sh` (not committed in the framefields repo): the fonts, `portrait.jpg`, `dancer.mp4` and `score.mp3`.
