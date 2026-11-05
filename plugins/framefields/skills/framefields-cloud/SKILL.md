---
name: framefields-cloud
description: Render framefields projects on framefields cloud GPUs (api.framefields.dev) or a self-hosted render worker. Use when running `framefields render --cloud`, calling `renderCloud` from `framefields/cloud`, planning cost and workers, splitting a long film across several GPUs, starting renders from the framefields dashboard, getting a project render-ready (push, lockfile, pinned assets, private repos), or fixing a cloud render error code such as ASSET_NOT_FOUND or LOCKFILE_MISSING.
---

# framefields-cloud

The cloud renders the **pushed commit** of a project on framefields' GPUs and can split a long film across several. Local rendering, checks and named renders in `framefields.json` are in `framefields-render`; project setup is in `framefields`.

## Make the project render-ready

The worker clones the repo, installs from the lockfile, fetches assets and calls the render's export. So:

- **Commit and push first.** Uncommitted changes aren't rendered (the CLI warns); a commit not on the remote, a folder outside git, or a repo without a remote is refused.
- **Commit the lockfile** and pin `packageManager`. The worker renders with the project's own framefields version (2.11+ for split renders, 2.12+ for named renders). bun lockfiles can't be installed by the worker.
- **Every input must reach the worker:** pinned with `framefields assets add` (preferred), tracked in Git LFS and pushed, or committed. Other `.gitignore`d files don't exist there.
- Build asset paths from `import.meta.url`, never `process.cwd()`. Nothing may write into `node_modules` while rendering.
- **Builders stay pure:** no rendering, generation or writes while building. `npx framefields check <name>` runs the same import locally; run it before every cloud render.
- **Private repos:** the user connects GitHub once at https://framefields.dev/dashboard/settings#connections (the framefields GitHub App, ideally on all repositories). Public repos need nothing.
- **Key:** it bills the account behind `FRAMEFIELDS_API_KEY` (https://framefields.dev/dashboard/keys), the same key as the AI gateway. Ask the user to set it in the environment; never print, write or embed it.

Pinned assets: the CLI and `renderCloud` upload any the bucket lacks and sign reads for remotes without a `publicUrl` (24 h; keys stay local). Workers download and cache them by hash; R2 downloads are free, unlike LFS bandwidth. Dashboard renders have nobody to sign, so they only read remotes with a `publicUrl`.

## CLI

Run from the project folder (where `framefields.json` and `package.json` are; in a monorepo that folder is sent as the workdir).

```bash
npx framefields render film --cloud --plan   # workers, time, estimated cost; renders nothing
npx framefields render film --cloud          # render, then download to the render's output
npx framefields render --cloud               # the only named render
npx framefields render src/film.ts --cloud --export buildFilm --workers auto   # a module, no manifest
```

- Flags override the named render's fields: `--workers <n|auto>`, `--max-workers <n>`, `--codec h264|vp9`, `--quality`, `--select`, `--output`, `--export`, `--json` (final status as JSON).
- `--workers` defaults to the render's `workers`, else 1. `auto` measures frame cost on one worker, then adds workers only while they stay efficient: a 5-minute film stays on one, a 3-hour film spreads to `--max-workers` (API cap 10).
- **Show the user `--plan` before a long or expensive render.** It prints e.g. `Plan: 4 workers, 1 h 50 min of render work, ready in about 35 min, estimated $1.20.`
- Output is one line per phase (`probing`, rendering N chunks and the audio, `stitching`, `Done in …: <file>, <GPU seconds>, <cost>.`), with progress and cost so far at most every 10 s. Run it in the background and let it finish; Ctrl-C cancels (used GPU time is charged).

## From code

No GPU needed locally:

```ts
import { CloudRenderError, renderCloud } from "framefields/cloud";

try {
  const result = await renderCloud({
    render: "film",                 // or { entry: "src/film.ts", export: "buildFilm", workers: "auto" }
    outputPath: "output/film.mp4",
    onProgress: (s) => console.log(s.status, s.progress.frames, s.progress.totalFrames, s.costUsd),
    // dryRun: true                 // plan only: result.plan, result.estimateUsd
  });
  console.log(result.filePath, result.gpuSeconds, result.costUsd);
} catch (err) {
  if (err instanceof CloudRenderError) console.error(err.code, err.message);
  else throw err;
}
```

Options override the named render's; `signal` cancels. `cloudClient({ apiKey })` exposes `start`, `status`, `cancel`. HTTP: `POST /v1/render` (`source`, `target`, `render`, `workers`, `max_workers`, `dry_run`, `name`, `title`), `GET` / `DELETE /v1/render/:id`, `Authorization: Bearer <key>`.

## Billing and the dashboard

- A credit hold is placed at start (raised to the estimate once planned); the charge is the GPU seconds used, the rest is released. Failed and cancelled renders charge what they used.
- `insufficient_credits`: the user adds funds at https://framefields.dev/dashboard/billing. Don't retry.
- https://framefields.dev/dashboard/renders shows every render with live progress, cost, Cancel and the video. **New render** lists the named renders of a connected repo's branch (greyed out when `entry` isn't on that branch), with Plan and Render.

## Errors

The error carries the worker's code. Fix the project, commit, push, render again.

| Code | Fix |
|---|---|
| `REPO_NOT_FOUND`, `GIT_AUTH_FAILED` | Connect GitHub (Settings → Connections) with access to this repo. |
| `REF_NOT_FOUND`, `COMMIT_MISMATCH` | `git push`. |
| `LOCKFILE_MISSING`, `INSTALL_FAILED` | Commit a lockfile that installs cleanly. |
| `ENTRY_NOT_FOUND`, `EXPORT_NOT_FOUND`, `EXPORT_INVALID` | Fix `entry`/`export`; `framefields check <name>`. |
| `COMPOSITION_BUILD_FAILED`, `EXPORT_SIDE_EFFECT` | The builder throws or renders/writes; `framefields check` reproduces it. |
| `ASSET_NOT_FOUND`, `LFS_OBJECT_MISSING`, `LFS_POINTER_UNRESOLVED` | `git lfs ls-files`, `git lfs push --all origin`; un-ignore needed assets. |
| `ASSET_NOT_UPLOADED`, `ASSET_HASH_MISMATCH` | `npx framefields assets push` from the machine with the right file. |
| `ASSET_PRIVATE`, `ASSET_FORBIDDEN` | Dashboard render of a remote without a working `publicUrl`: render from the CLI or fix `publicUrl`. |
| `ASSET_MANIFEST_INVALID` | `npx framefields assets status` shows the error. |
| `ENGINE_UNSUPPORTED` | Upgrade framefields (2.11+) or use `--workers 1`. |
| `RENDER_TIMEOUT`, `RENDER_OOM` | `--workers auto` or more workers. |

Infrastructure errors (`GIT_NETWORK`, `RENDER_STALLED`, a lost worker) are retried by the API, and a straggling chunk gets a backup worker.

A stitched video with a jump at a chunk seam means a stateful effect reads wall-clock time; keep effects deterministic in the frame number.

## Self-hosted render worker

The same worker runs on your own GPU (Docker, RunPod pod or serverless): it renders a pushed commit with the rules above and uploads the result. A failed job returns `{ code, hint, retryable }`; resubmit unchanged only when `retryable` is true. Job format: https://framefields.dev/docs/guides/render-service/

To split a render yourself, see **Splitting a long render** in `framefields-render`.
