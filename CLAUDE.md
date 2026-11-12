# Framefields

Code-first video engine on native WebGPU (Dawn) in Node, no browser. pnpm + turbo monorepo, Node >=22, ESM, Biome (tabs, double quotes), tsdown builds, vitest tests. Rendering needs a GPU. Our aim is to improve the engine harness: no cheating or workarounds.

## Working rules
- Be brave; we can change anything. Aim for engineering elegance, not just goal completion.
- Debug to the root cause. If a workaround is the only option, stop and ask.
- No `any`. Named exports unless a default is required. Top-of-file imports (no `await import` unless required). Pass the cyclomatic complexity lint.
- pnpm only; never hand-edit `pnpm-lock.yaml`.
- Never run bare `tsc` (it emits into source). Use the package script (`tsdown`, or `tsc --noEmit -p .`).
- Render scripts end with `process.exit`.
- Plain console output, no colors. Don't use the user's name. Final answers concise.
- Keep this file current when structure or dev patterns change but do not bloat it.

## Repo map
- `packages/framefields`: public SDK. `Composition`, `Layer.*`, `LayerAnimation`, `Signal`, effects (`src/effects/classes.ts`), `FontManager`, `renderFrameGrid`. `src/index.ts` is the export surface. CLI in `src/cli/` (`init`, `add`, `list`, `fonts add|list`, `assets add|push|pull|status`, `check`, `renders`, `render [--cloud]`, `preview`; local render and preview run `cli/local-worker.ts` with the project's own tsx and framefields; the preview page is Lit source in `src/preview/ui/`, built by esbuild into `dist/preview-page`, or on first use when running from `src`); `framefields.json` (`cli/config.ts`) holds the components folder, fonts, named `renders` that the CLI, `renderCloud` and the dashboard pick by name, and `storage` remotes plus sha256-pinned `assets`; `framefields/cloud` (`renderCloud`) is the GPU-free client for api.framefields.dev; `init` never prompts or overwrites, and its file templates are strings in `templates.ts` (a test parses them).
- Style library: `plugins/framefields/skills/framefields-styles` (looks, formats, genres, media, presets as markdown with frontmatter; each kind owns its `##` sections) is the source; `pnpm run sync:style-library` generates `packages/framefields/src/style-library/catalog.json` (exported as `framefields/styles` with `combineStyles`) and the skill's tables (drift test). `examples/42_style_library` renders one reference per look at 16:9, 9:16 and 1:1 for the cards (published by the API repo's `scripts/publish-style-frames.mjs`, served by `GET /v1/styles/frames`).
- `packages/components`: the component registry `framefields add` copies into user projects (shadcn-style). `defineComponent`/`bind` contract in `src/core/contract.ts`, shared helpers in `src/core/` (keys, color, layout, surface, theme). Components import only `framefields` and `../core`. Registry items declare font needs (e.g. emoji); CLI fonts are pinned by URL, size and SHA-256 in `cli/fonts.ts`. Prop docs in `components.json` are generated (drift test). Tree-shake size budgets are tested.
- `packages/compositions`: Yoga layout (`utils/layout/resolve-layout.ts`), program schema (`program/schema.ts`), lint (`program/lint.ts`), animation/evaluator, the audio mixer (`utils/audio-extractor.ts`; a `window` mixes one stretch, which the preview streams around its playhead).
- `packages/webgpu-renderers`: WGSL shaders, 2D/3D pipelines, Slug text (`src/slug/`), audio DSP. `src/pathtracer/` is `environment.pathTrace` (`Renderer3D.pathTrace`): two-level BVH (ported from MuTracer/TinyBVH, see `framefields/NOTICE.md`), compute kernel reusing `lighting3d` lights and tone mapping, à-trous denoiser, quality presets and the preview time budget (`quality.ts`).
- `packages/renderer`: headless Node renderer (Dawn, WebCodecs/mediabunny).
- `packages/vision-sam`: SAM 2.1 Tiny/Small and SAM 3 trackers (Apache-2.0 code; SAM 3 weights need runtime SAM License acceptance), private; `framefields` bundles it as a lazy chunk (`clip-vision.ts` imports it dynamically for `comp.vision(..., { sam2 | sam3 })`; `index.ts` re-exports types only) and exposes the trackers as `framefields/sam`. No weights ship; `packages/framefields/NOTICE.md` covers their licenses. Pins in `src/models/registry.ts`.
- `packages/storage`: content-addressed assets on any S3-compatible bucket (R2 first): manifest format, SigV4 client (aws4fetch), verified downloads, and the locator the preview uses to redirect missing pinned files to their bucket. Shared by the CLI (`framefields/storage`), the preview and the render worker, which fetches pinned assets after LFS.
- `packages/gltf-fixtures`: private test fixtures (never exported or bundled): `GltfDocument` GLB writer (materials + KHR extensions, textures, skins, sparse morphs, clips) and `Skeleton`, used by the model import tests; its own tests check output with the Khronos validator and read it back through the engine loader.
- `packages/core`: shared types, `Effect` base, signals, `emojiPresentation` (the one UTS #51 rule used by layout, preload and lint).
- Others: `renderers`, `media`, `node-sdk`, `server-utils`, `client-utils`, `tensor-webgpu`, `vision`, `tsconfig`.
- `nodes/node-*`: one VFX/audio/layout node each (`src/shared/`, `src/renderers/`, `src/index.ts`). `node-shader` is the renderer behind `Layer.shader` (author-supplied WGSL fragment, named uniforms). Only `node-compositor` has a `SKILL.md`; update it when Compositor behavior changes (guarded by `skillmd-check.test.ts`). Effect renderers declare `reach` and `maxPixelScale` (node-sdk) when they can: without `maxPixelScale` a scaled-up leaf using the effect stays at layout resolution.
- `apps/renderer-service`: HTTP render service (Docker, RunPod). It renders single jobs, including the pieces of a split render (`probe`, `range` chunks, `stitch`); the API repo (`/Users/okanaslankan/framefields-dev/api`, `src/render/`) plans, dispatches and bills them.
- `examples/NN_*`: reference films. Study `19_framefields_film` (structure), `22_framefields_launch` (lyric sync), `28_physics_dancer` (physics, vision, GPU particles) before writing one.
- `plugins/framefields/skills/framefields{,-compose,-effects,-render,-vision,-cloud}`: agent skills, symlinked from `.agents/skills` and `.claude/skills`, and copied into `framefields`' `dist/skills` at build (`scripts/copy-skills.mjs`), so each release ships the guides for its own API.
- `framefields` is the only published package: it bundles every `@framefields/*` workspace package, and its build fails if `dist` still imports one (`scripts/check-bundled-imports.mjs`).
- Package `exports` have a `development` condition pointing at `src/`; otherwise `dist/`, so `pnpm build` after changing a dependency.
- Docs site is a separate repo: `/Users/okanaslankan/framefields-dev/docs` (Astro Starlight). `docs/lab` pins the published `framefields` version and builds the component demos; deploy with `pnpm run deploy`.

## Commands
- Build: `pnpm build`, or `pnpm --filter <name> build`.
- Test: `pnpm --filter <name> test` (`packages/renderer`: `test:vitest`). Root `pnpm test` is slow.
- Lint: `pnpm exec biome check --write <files>` (lefthook runs it on commit).
- Example: `pnpm --filter @framefields/example-19-framefields-film assets|render|test|typecheck`.
- Component gallery: `pnpm --filter framefields gallery`.
- Skills: after engine API changes update the owning skill; `pnpm --filter framefields test` fails on stale generated effects or catalog. `effects-catalog.md` is generated by `pnpm run sync:effects-catalog`; never hand-edit.
- Releases: changesets (`.changeset/`).

## Local-only files
Gitignored, never commit: `assets/fonts`, `*.mp4/mp3/wav/png/jpg`, `*.onnx`, `scratch*/`, `examples/output/`, `.hermes/`, `.env*` (never print secrets). Put probes and logs under `scratch/` or `output/`.
