# framefields renderer worker

A GPU worker that renders framefields projects straight from git. You send it a job naming a repo, a branch/tag/commit and an exported composition. It then does the following, and returns where the output went:

1. Fetches the code and pulls the assets with git LFS.
2. Installs dependencies.
3. Renders the composition on its warm GPU.
4. Checks the output.
5. Uploads it.

It runs as a **RunPod serverless endpoint**, a **RunPod pod**, or a **Docker container** on any NVIDIA host. The design, edge cases and error codes are in [PLAN.md](PLAN.md).

## Contents

- [How it works](#how-it-works)
- [Quick start (Docker + MinIO)](#quick-start-docker--minio)
- [RunPod](#runpod)
- [GPU and CPU rendering](#gpu-and-cpu-rendering)
- [Jobs](#jobs)
- [Configuration](#configuration)
- [Errors](#errors)
- [Security](#security)
- [Development](#development)

## How it works

```
job ─▶ resolve ref → fetch (mirror cache) → checkout → git LFS pull
        → install (skipped when only framefields is needed, or the lockfile is unchanged)
        → import your entry → render on the warm GPU → verify (ffprobe) → upload
```

- **Your repo picks the framefields version.** The worker image contains no engine. Each repo depends on `framefields` in its `package.json` (with a committed lockfile), and the worker renders with exactly that install.
- **Your code runs inside the worker process.** The first job loads its project's framefields and initialises the GPU. Later jobs on the same version reuse that warm engine, even from other repos. A job that needs a different version fails with retryable `ENGINE_SWITCH`, and the worker restarts so the retry loads it. Keep a worker (or endpoint) per framefields version if your projects pin different ones.
- **Everything is pinned to one commit.** A branch is resolved once per job, and the result reports the SHA it rendered.
- **Caches survive between jobs:** git mirrors, LFS objects and package stores live on the cache volume, and checkouts and `node_modules` are reused. A warm job spends almost all its time rendering.
- **The worker protects itself.** It recycles after N jobs, high memory, GPU device loss, or code that won't stop. If it crashes, the job is still reported after the restart.

## Quick start (Docker + MinIO)

Use an NVIDIA GPU with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/). Without a GPU the worker still runs, but renders on the CPU, which is much slower (see [GPU and CPU rendering](#gpu-and-cpu-rendering)).

```bash
cd apps/renderer-service/deploy
cp env.example .env        # set RENDERER_API_KEY, FF_REPO_ALLOWLIST, GIT_TOKEN, MINIO_ROOT_PASSWORD
docker compose up -d
curl localhost:8082/health
```

Submit a job and follow it:

```bash
curl -s localhost:8082/v2/jobs \
  -H "authorization: Bearer $RENDERER_API_KEY" -H "content-type: application/json" \
  -d '{
    "version": 2,
    "source": { "repo": "https://github.com/your-org/films.git", "ref": "main", "workdir": "videos/launch" },
    "target": { "entry": "src/film.ts", "export": "buildFilm" },
    "output": { "type": "s3", "key": "launch/{shortSha}/{name}.{ext}" }
  }'
# → {"id":"…","status":"IN_QUEUE"}

curl -sN localhost:8082/v2/jobs/<id>/events -H "authorization: Bearer $RENDERER_API_KEY"   # live progress (SSE)
curl -s  localhost:8082/v2/jobs/<id>        -H "authorization: Bearer $RENDERER_API_KEY"   # status + result
curl -s -X POST localhost:8082/v2/jobs/<id>/cancel -H "authorization: Bearer $RENDERER_API_KEY"
```

### Images

CI ([`renderer-image.yml`](../../.github/workflows/renderer-image.yml)) publishes `ghcr.io/gatewai-dev/framefields-renderer` (linux/amd64):

| Tag | When |
|---|---|
| `latest`, `1.2.3`, `1.2` | A `renderer-v1.2.3` git tag. Use these in production. |
| `main`, `sha-<commit>` | Each push to `main` that touches the renderer or the packages. |
| `<tag>-full` | The same tags, `full` variant. |

Pull requests only build and smoke-test the image. A manual run (**Actions → renderer-image → Run workflow**) publishes the selected branch.

Building the image yourself, from the repo root:

```bash
docker build -f apps/renderer-service/Dockerfile -t framefields-renderer .
docker build -f apps/renderer-service/Dockerfile --build-arg VARIANT=full -t framefields-renderer:full .
```

The `full` variant adds a C/C++ toolchain, for projects whose native dependencies have no prebuilt binaries. The image is based on Debian trixie, because the prebuilt WebGPU (Dawn) binaries need glibc 2.38 or newer.

## RunPod

The templates are in [`deploy/runpod/`](deploy/runpod). Edit the env values (allowlist, storage), create the secrets they reference under **RunPod → Secrets**, then create the template:

```bash
RUNPOD_API_KEY=… deploy/runpod/create-template.sh deploy/runpod/serverless.template.json
```

| | Serverless (`serverless.template.json`) | Pod (`pod.template.json`) |
|---|---|---|
| API | RunPod's `/run`, `/status`, `/stream`, `/cancel` | This service's HTTP API on port 8082 |
| Scaling | RunPod scales workers 0→N | One long-running worker |
| Cache | Attach a **network volume** to the endpoint (mounted at `/runpod-volume`) | Pod volume at `/runpod-volume` |

Checklist for serverless endpoints:

- **Set the endpoint's execution timeout** above your longest render. RunPod's default is much shorter than a long video.
- **Attach a network volume** in the same data centre as the GPUs. Without one, every worker starts cold: a full clone, LFS download and install.
- **FlashBoot** keeps warm workers around between jobs, which is what makes the caches pay off.
- **Choose GPUs with a hardware video encoder (NVENC):** L4, L40S, A40, RTX A4000/A5000/A6000, RTX 4090/5090. A100 and H100 are built for AI training and have no NVENC: they render, but encode on the CPU, and cost more. VRAM needs grow with resolution and effects.
- The templates set `FF_GPU=require`, so a RunPod worker never renders on the CPU. A worker whose GPU is unusable reports `GPU_UNAVAILABLE` and asks RunPod for a fresh worker.

A serverless job is the same JSON as above, wrapped as `{"input": …}`:

```bash
curl -s https://api.runpod.ai/v2/<endpoint-id>/run \
  -H "authorization: Bearer $RUNPOD_API_KEY" -H "content-type: application/json" \
  -d '{"input": {"version": 2, "source": {"ref": "main"}, "target": {"entry": "src/film.ts", "export": "buildFilm"}, "output": {"type": "s3", "key": "{jobId}.{ext}"}}}'
```

How results come back:

- A failed job's `error` is the JSON of a [structured error](#errors), including `retryable`.
- Progress events appear in `/status` and `/stream`.
- The worker asks RunPod for a fresh worker (`refresh_worker`) when it recycles.

## GPU and CPU rendering

framefields draws frames with WebGPU, which runs on Vulkan on Linux. Video is then encoded with FFmpeg. The two steps choose their hardware separately.

**Drawing frames.** `FF_GPU` decides where frames are drawn:

| `FF_GPU` | Machine with a GPU | Machine without a GPU |
|---|---|---|
| `auto` (default) | Renders on the GPU. Fails with `GPU_UNAVAILABLE` if the GPU is unusable, instead of falling back to the CPU. | Renders on the CPU (Mesa lavapipe, included in the image). |
| `require` (RunPod templates) | Renders on the GPU. | The worker fails its health check with `GPU_UNAVAILABLE`. |
| `cpu` | Renders on the CPU. | Renders on the CPU. |

At startup the worker looks for the GPU's device files (`/dev/nvidia*`, or `/dev/dri` render nodes for AMD and Intel) and limits Vulkan to that GPU's driver, so it can't fall back to the CPU driver silently. After the first job loads framefields, the worker checks which adapter WebGPU actually picked.

For NVIDIA GPUs in Docker, the NVIDIA Container Toolkit must mount the Vulkan driver. The image sets `NVIDIA_DRIVER_CAPABILITIES=graphics,utility,video,compute`, which does that. Keep `graphics` in the list if you override it, or the worker reports that the GPU has no Vulkan driver.

**Encoding video.** framefields (2.2.0 and later) tests the hardware encoder once per codec, and uses it only if it works:

- NVENC on NVIDIA, VideoToolbox on macOS.
- Otherwise software: libx264 (H.264), libx265 (HEVC), libvpx (VP9), SVT-AV1.

Older framefields versions always try the hardware encoder. That fails on GPUs without NVENC and on Linux ARM (`h264_rkmpp`). Set `FRAMEFIELDS_HW_CODECS=off` to always encode in software.

**Where to see it.** `/health` reports the GPU under `components.gpu`, and each result reports it under `engine.gpu`:

```json
"gpu": {"mode": "auto", "hardware": "NVIDIA L4", "renderer": "gpu",
        "adapter": {"name": "NVIDIA L4", "software": false}}
```

Here `renderer` is `gpu` or `cpu`. `hardware` is `null` when the machine has no GPU.

## Jobs

```jsonc
{
  "version": 2,
  "source": {
    "repo": "https://github.com/acme/films.git",   // or git@host:owner/repo.git; default FF_DEFAULT_REPO
    "ref": "main",                                 // branch, tag, refs/…, or a commit SHA (≥ 7 chars)
    "commit": "9f2c1e4",                           // optional: fail if the ref moved elsewhere
    "workdir": "videos/launch",                    // package dir inside the repo
    "lfs": { "include": ["videos/launch/assets/**"] }, // only pull what this render needs
    "sparse": ["videos/launch", "shared/fonts"],   // optional sparse checkout
    "submodules": false
  },
  "target": {
    "entry": "src/film.ts",
    "export": "buildFilm",           // a Composition, a function returning one, a record, or a plan
    "args": { "locale": "tr" },      // passed to the export when it's a function
    "select": ["teaser"]             // pick named outputs from a record / plan
  },
  "render": { "kind": "video", "codec": "h264", "quality": "high", "qa": { "failOn": ["black_frames", "error"] } },
  "output": { "type": "s3", "bucket": "renders", "key": "{ref}/{shortSha}/{name}.{ext}" },
  "env": { "LOCALE": "tr" },
  "timeoutSec": 1800,
  "idempotencyKey": "launch-v12"     // a retry of the same commit returns the earlier upload
}
```

### What the export can return

Your entry exports a builder, using the same `{ entry, export }` convention as `startPreview()`:

```ts
import { Composition } from "framefields";

// One video:
export function buildFilm(args?: { locale?: string }) {
  const comp = new Composition({ width: 1920, height: 1080, fps: 30, durationFrames: 300 });
  // …
  return comp;
}

// Several named outputs:
export const cuts = () => ({ main: buildFilm(), teaser: buildTeaser() });

// Or a plan, with per-output render settings:
export const deliverables = () => ({
  outputs: [
    { name: "film", composition: buildFilm() },
    { name: "sheet", composition: buildFilm(), render: { kind: "frameGrid", grid: { step: 30 } } },
  ],
});
```

Don't render or call `process.exit()` at import time: the job fails with `EXPORT_SIDE_EFFECT`. Your repo files load as ES modules even without `"type": "module"`.

Versions of `framefields` released before worker support (2.1.3 and older) still render. They report no progress, and the worker restarts after each of their jobs to keep caches correct. Newer versions keep the worker warm between jobs.

### Render kinds

`render.kind` is one of:

- `video`, with codecs `h264` (default), `vp9`, `vp8` or `gif`;
- `audio` (`aac`, `mp3`, `opus`);
- `frames` (`frames: [0, 120]` → PNGs);
- `frameGrid` (a contact sheet);
- `lut`.

### Output targets

| `output.type` | Fields | Notes |
|---|---|---|
| `s3` | `key` (template), `bucket` | The bucket must be in `FF_OUTPUT_BUCKETS` (defaults to `STORAGE_BUCKET`). Any S3-compatible store works: R2, MinIO, AWS. |
| `presigned` | `urls` (one per output), `headers` | The worker needs no storage credentials. Sign with an expiry longer than the job timeout. |
| `local` | `path` (template) | Written under `FF_OUTPUT_DIR`. |
| `inline` | — | Base64 in the result, up to `FF_INLINE_MAX_BYTES`. |

Key and path templates can use `{jobId}`, `{sha}`, `{shortSha}`, `{ref}`, `{date}`, `{name}`, `{index}` and `{ext}`.

### CLI

To run one job without the HTTP server (for CI or debugging):

```bash
node apps/renderer-service/dist/src/cli.js --job-file job.json --result-file result.json
docker run --gpus all -e FF_MODE=cli -v $PWD:/jobs … framefields-renderer --job-file /jobs/job.json
```

Exit codes: 0 completed, 1 failed, 2 bad invocation or job.

## Configuration

Everything is set by environment variables. The worker checks them all at startup and lists every problem at once. The full reference is [PLAN.md §11](PLAN.md#11-configuration-reference-env). The ones you'll set:

| Variable | Purpose |
|---|---|
| `FF_REPO_ALLOWLIST` | **Required.** Repos this worker may render, e.g. `github.com/acme/*`. `*` matches one path segment, `**` any number. |
| `FF_DEFAULT_REPO`, `FF_DEFAULT_REF` | Defaults for jobs that leave out `source.repo` / `source.ref`. |
| `RENDERER_API_KEY` | Bearer token for the HTTP API. Required in `http` mode. |
| `GIT_TOKEN`, `GIT_USERNAME` | HTTPS token for the job's repo host. The username defaults per host: GitHub `x-access-token`, GitLab `oauth2`, Bitbucket `x-token-auth`. |
| `FF_GIT_CREDENTIALS` | Per-host tokens: `{"git.acme.dev": {"username": "bot", "token": "…"}}`. |
| `FF_GIT_HOSTS` | Host kinds for self-hosted servers: `{"git.acme.dev": "gitea"}`. Values: `github`, `gitlab`, `bitbucket`, `gitea`, `generic`. |
| `GIT_SSH_KEY`, `GIT_SSH_KNOWN_HOSTS` | For SSH remotes. Keys for github.com, gitlab.com and bitbucket.org are built in and verified at build time. |
| `FF_GIT_CA_BUNDLE` | A PEM CA certificate for self-hosted servers with a private CA. |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | S3-compatible output storage. |
| `STORAGE_PUBLIC_BASE_URL` | Turns output keys into public URLs in results. |
| `FF_CACHE_DIR`, `FF_CACHE_MAX_GB`, `FF_WORK_MAX_GB` | Cache location and size limits. Eviction runs automatically. |
| `FF_JOB_TIMEOUT_MAX_SEC`, `FF_STALL_TIMEOUT_SEC` | Time limits. |
| `FF_MAX_JOBS_PER_WORKER` | Recycle after N jobs (default 25). |
| `FF_GPU` | `auto` (default), `require` or `cpu`. See [GPU and CPU rendering](#gpu-and-cpu-rendering). |
| `FRAMEFIELDS_HW_CODECS` | `off` encodes video in software even when a hardware encoder works. |
| `FF_NPMRC` | `.npmrc` contents, for private registries. |

## Errors

A failed job returns:

```json
{ "code": "LFS_POINTER_UNRESOLVED", "message": "…", "phase": "lfs", "retryable": false, "hint": "…", "details": { … } }
```

`retryable` tells you whether running the same job again can succeed (network errors, a recycled worker) or not (a bad ref, a missing export, an exhausted LFS quota). Every code is listed in [PLAN.md §10](PLAN.md#10-error-model). The common ones:

| Code | Usual cause |
|---|---|
| `REPO_NOT_ALLOWED` | The repo isn't in `FF_REPO_ALLOWLIST`. |
| `GIT_AUTH_FAILED` / `REPO_NOT_FOUND` | The token can't read the repo. Private repos also report "not found". |
| `REF_NOT_FOUND` / `REF_AMBIGUOUS` | Typo, deleted branch, or a name that's both a branch and a tag. |
| `LFS_POINTER_UNRESOLVED` | An asset wasn't downloaded. Widen `source.lfs.include`. |
| `LFS_QUOTA_EXCEEDED` | The host's LFS bandwidth or storage is used up. |
| `LOCKFILE_MISSING` / `INSTALL_FAILED` | Commit a lockfile that matches `package.json`. |
| `EXPORT_NOT_FOUND` / `EXPORT_INVALID` / `EXPORT_SIDE_EFFECT` | The entry doesn't export a builder the worker can use. |
| `ASSET_NOT_FOUND` | A file the composition references is missing; often an LFS include that's too narrow. |
| `RENDER_TIMEOUT` / `RENDER_STALLED` | The render took too long, or stopped making progress. |
| `ENGINE_NOT_FOUND` | The project doesn't depend on `framefields`, so there is nothing to render with. |
| `ENGINE_SWITCH` | Retry. The project needs another framefields version, or new dependencies; the worker restarts to load them. |
| `GPU_DEVICE_LOST` / `RENDER_OOM` | Retry. The worker replaces itself. |
| `GPU_UNAVAILABLE` | The machine has no usable GPU (`FF_GPU=require`), or has one that WebGPU couldn't use. Retry on another worker; on RunPod this happens automatically. Check the GPU's Vulkan driver with `vulkaninfo --summary`. |
| `QA_FAILED` | `render.qa.failOn` matched. The outputs are still uploaded and listed. |

## Security

The worker **runs code from the repos you allow**. That code runs in the same process as the worker's credentials. Secrets are removed from the environment before your code runs, but in-process code could still reach them in memory. Therefore:

- Only allowlist repos you trust as much as the worker image itself.
- Give the worker a **read-only** git token scoped to those repos, and storage credentials scoped to the output bucket.
- Better still, use `presigned` outputs, so the worker has no storage credentials at all.
- Credentials are only sent to allowlisted hosts (never to an LFS CDN). They are never written into URLs or `.git/config`, and they are redacted from logs and results.

## Development

```bash
pnpm --filter @framefields/renderer-service dev        # watch mode (set FF_HTTP_INSECURE=true, FF_REPO_ALLOWLIST)
pnpm --filter @framefields/renderer-service test       # unit + integration tests (no GPU needed)
FF_GPU_TESTS=1 pnpm --filter @framefields/renderer-service test   # also the GPU render tests
apps/renderer-service/deploy/known-hosts.sh --refresh  # re-pin SSH host keys (review the diff!)
```

Integration tests use local bare git repos, an in-memory S3, and subprocess harnesses (`test/*.ts`). The harnesses exist because vitest's sandbox bypasses Node's loader hooks.
