# Renderer service: self-deployment plan & spec

Status: **draft, decisions recorded**, 2026-10-14. Branch: `feat/renderer-self-deploy`.

### Decisions (2026-10-14)

1. **Rendering runs in the main service process** (revised 2026-10-14; this replaces the earlier child-process design). The repo's entry module is imported into the long-lived worker and rendered with the worker's warm GPU device. Section 8 covers what this costs and how each cost is handled.
2. **Engine source: `bundled`.** This follows from decision 1, because one process can only hold one GPU stack. Imports of `framefields` and `@framefields/*` from repo code resolve to the worker's own copy. The project's lockfile version is still checked (section 7). The earlier `project` default, where each job used the framefields version in its lockfile, is dropped.
3. **Script mode is dropped.** A package script always runs as its own process, so it can't render in the main process. Its use cases (several outputs, contact sheets, parametrised variants) are covered by letting an export return several compositions or a render plan (section 4).
4. **The inline `virtualMedia` path is removed.** That covers the legacy input mapping, the v1 `/run` and `/status` routes, `cli.ts --job <json>`, `configureAssetUrls` and `BASE_URL`, and the `R2_*` env names. There are no callers left.
5. **Git hosts:** GitHub, GitLab, Bitbucket and self-hosted servers (GitLab self-managed, Gitea/Forgejo, plain git over HTTPS/SSH) are all in scope from the start (section 6.5).
6. **Image:** `ghcr.io/gatewai-dev/framefields-renderer`.
7. **RunPod worker:** a thin Python shim in front of a long-lived Node server.

## 1. Goal

Turn `@framefields/renderer-service` into a GPU render worker that anyone can deploy themselves:

- as a **RunPod template** (serverless endpoint or a long-running pod),
- or as a plain **Docker image** on any NVIDIA/Vulkan host.

A job tells the worker which **git repo + ref** holds a framefields project. The worker fetches the code, pulls the assets with **git LFS**, installs dependencies, builds the composition the job names, renders it, and uploads the result. Every knob that differs between deployments is configured by env vars or a config file, never by a code change.

### Non-goals (for this iteration)

- Splitting one render across several workers by frame range. Section 13 covers this as future work.
- A queue or scheduler of our own. RunPod or the caller does the queueing.
- Repo encryption filters such as `git-crypt`. These are detected and rejected with a clear error.
- Running untrusted third-party repos on a shared multi-tenant worker. The trust model is in section 9.

## 2. Current state (what exists today)

| Piece | State |
|---|---|
| `src/index.ts` | Hono HTTP server with `/run`, `/status/:id`, `/health` and `/ping`. Jobs are kept in an in-memory `Map` that is never pruned. There is **no auth**: `RENDERER_API_KEY` is set in `.env` but never read. |
| `src/cli.ts` | One-shot render that takes the job as **JSON in argv**. `ARG_MAX` limits that payload, so large `virtualMedia` inputs fail. |
| `runpod_worker.py` | Spawns a fresh `node cli.js` for each job, so every job pays the GPU init again. It finds the result by scanning stdout for a line that starts with `{"success":`. It points at the old path `apps/gatewai-renderer/...`. |
| `renderer-entrypoint.sh` | Also points at `apps/gatewai-renderer`. |
| `src/di-setup.ts` | Sets up an inversify container (`ServerMediaService`, `R2StorageService`, which is an alias of `S3StorageService`) that rendering doesn't need. The media service is optional, because `@framefields/media` falls back to `sharp` without it. |
| `Dockerfile.renderer` | The runtime image has no `git`, `git-lfs` or `openssh-client`. The user is named `gatewai`. |
| Job input | Only takes a pre-compiled `virtualMedia` AST plus `bucket`/`key`. It has no notion of a project or repo. |
| Storage | Assumes R2 (env names `R2_*`) and only supports the bucket/key output target. |

Phase 0 (section 13) fixes these before any new feature work, and removes the inline `virtualMedia` path (`job-processor.ts`, the `virtualMedia` branch of `render-upload.ts`, and `cli.ts`).

## 3. Architecture

```
            ┌──────────────── transport ────────────────┐
 RunPod ──▶ │ runpod_worker.py (thin shim)              │
 HTTP   ──▶ │ Hono server  (/v2/jobs, /health, ...)     │──┐
 CLI    ──▶ │ cli.ts  (--job-file / stdin)              │  │
            └───────────────────────────────────────────┘  │
                                                           ▼
                                     ┌──────── JobRunner (service process) ───────────┐
                                     │ validate → resolve → fetch → lfs → install →   │
                                     │ load → render → verify → upload → report       │
                                     └───┬───────────┬────────────┬──────────────┬────┘
                                         │           │            │              │
                                   GitWorkspace  Installer   InProcessRenderer  OutputSink
                                   (mirror cache,(pnpm/npm/  (tsImport entry,   (s3 / presigned
                                    worktrees,    yarn, store  engine alias hook, / local / inline)
                                    LFS, auth)    cache)       job sandbox,
                                                               warm GPU device)
```

Key decisions:

1. **One long-lived Node process per worker.** The RunPod Python shim talks to it over `localhost` HTTP instead of spawning `node` for every job. GPU and renderer init then happens once per worker, not once per job.
2. **Repo code is rendered in the service process.** The GPU device, compiled pipelines, the font and model caches, and the node registry all stay warm across jobs. Only git, LFS and the package manager run as subprocesses.
3. **One job at a time per worker.** `cwd`, `process.env` and the GPU are process-wide, so jobs can't safely overlap. Further jobs wait in a queue.
4. **A job sandbox wraps each job** (8.2). It sets `cwd` and the job env, traps `process.exit`, attributes stray rejections to the job, and restores everything afterwards.
5. **The worker recycles itself when it can't recover in-process:** a hard timeout, GPU device loss, heap growth past a limit, or N jobs done. It reports the job first, then exits, and the supervisor (RunPod, Docker `restart`, k8s) starts a fresh one. This replaces the child process's hard-kill guarantees.
6. **Everything is pinned to a commit SHA once it has been resolved.** A ref is resolved exactly once per job. Every later step uses the SHA, and the SHA is returned in the result.

## 4. Job API (v2)

There is one schema, validated with zod and shared by every transport. RunPod wraps it as `{ "input": <job> }`. HTTP posts it as the body.

```jsonc
{
  "version": 2,

  // Where the project comes from. Git is the only source type.
  "source": {
    "type": "git",
    "repo": "https://github.com/acme/promo-videos.git", // or git@github.com:acme/promo-videos.git; default: FF_DEFAULT_REPO
    "ref": "main",                 // branch | tag | full ref (refs/heads/x) | sha (>= 7 chars); default: FF_DEFAULT_REF
    "commit": "9f2c1e…",           // optional: fail with COMMIT_MISMATCH if ref no longer points here
    "workdir": "videos/launch",    // optional: package dir inside the repo (monorepos); default "."
    "lfs": {
      "enabled": true,             // default true when the repo has .gitattributes with filter=lfs
      "include": ["videos/launch/assets/**"], // only pull what this render needs
      "exclude": []
    },
    "submodules": false,
    "sparse": ["videos/launch", "shared/fonts"] // optional sparse checkout (cone mode)
  },

  // What to render. Same {entry, export} convention as startPreview().
  "target": {
    "entry": "src/film.ts",        // relative to workdir; .ts/.mts/.js/.mjs
    "export": "buildFilm",         // see "Export shapes" below; default "default"
    "args": { "locale": "tr" },    // optional: passed to the export when it is a function (parametrised renders)
    "select": ["main", "teaser"]   // optional: which named compositions to render when the export returns several
  },

  // Default render settings. A render plan from the export can override them per output.
  "render": {
    "kind": "video",               // video | frames | frameGrid | lut | audio
    "codec": "h264", "audioCodec": "aac", "quality": "high",
    "frames": [0, 80, 320],        // kind=frames
    "range": { "from": 0, "to": 240 }, // optional sub-range for video
    "qa": { "failOn": ["black", "frozen", "clipping"] } // optional; report always returned when set
  },

  "output": {
    "type": "s3",                  // s3 | presigned | local | inline
    "bucket": "renders",           // must be in FF_OUTPUT_BUCKETS allowlist; default STORAGE_BUCKET
    "key": "acme/{shortSha}/{jobId}.{ext}" // template vars below
    // presigned: { "type": "presigned", "urls": ["..."], "headers": {...} } (one URL per output, in plan order)
    // local:     { "type": "local", "path": "launch/{jobId}.{ext}" }       (under FF_OUTPUT_DIR)
    // inline:    { "type": "inline" }  base64 in the result, capped by FF_INLINE_MAX_BYTES
  },

  "env": { "LOCALE": "tr" },       // non-secret vars set in process.env for the job only; names must match FF_JOB_ENV_ALLOW
  "timeoutSec": 3600,              // capped by FF_JOB_TIMEOUT_MAX_SEC
  "idempotencyKey": "acme-launch-v12" // optional, see 8.6
}
```

**Export shapes.** The export, or the value its function returns (sync or async), can be one of three things:

- **A `Composition`.** It is rendered with `render` and becomes one output, named `main`.
- **A record of named compositions,** `{ main: Composition, teaser: Composition }`. Each entry becomes one output, named by its key, and `target.select` narrows which are rendered.
- **A render plan:** `{ outputs: [{ name, composition, render?: {...overrides} }] }`. This covers contact sheets (`render.kind = "frameGrid"`), frame stills, and different codecs per output.

Outputs are rendered one after another on the same warm device.

**Key template variables:** `{jobId}`, `{sha}`, `{shortSha}`, `{ref}` (slugified), `{date}` (UTC `YYYY-MM-DD`), `{ext}`, `{index}` (frames or outputs, from 0), `{name}` (the output name). Rendered keys are normalised. Any key that contains `..`, starts with `/`, or contains control characters is rejected.

A payload without `version: 2` is rejected with `JOB_INVALID`. There is no legacy mapping.

When a job has several outputs, the `output` key template is applied once per output. A template that would map two outputs to the same key is rejected before rendering starts (`JOB_INVALID`).

**Repo defaults file (optional).** The project root may contain `framefields.render.json` with the non-security fields of `source.workdir`, `source.lfs`, `target`, `render` and `install` (section 7). Precedence:

> job > repo file > env defaults > built-in defaults

Security-relevant settings (allowlists, credentials, limits, output buckets) can **never** come from the job or the repo file.

### 4.1 Result

```jsonc
{
  "status": "COMPLETED",
  "jobId": "…",
  "source": { "repo": "https://github.com/acme/promo-videos.git", "ref": "main", "sha": "9f2c1e…", "workdir": "videos/launch" },
  "engine": { "framefields": "2.1.3", "source": "bundled", "projectDeclared": "^2.1.0" },
  "outputs": [{ "key": "acme/9f2c1e4/….mp4", "url": "https://…", "bytes": 48213311, "sha256": "…", "contentType": "video/mp4", "durationMs": 12000, "frames": 720 }],
  "qa": { /* VideoQaReport when requested */ },
  "timings": { "resolveMs": 210, "fetchMs": 1830, "lfsMs": 9400, "installMs": 0, "loadMs": 900, "renderMs": 61000, "uploadMs": 3100 },
  "cache": { "mirror": "hit", "lfs": "partial", "install": "hit", "workspace": "warm" },
  "warnings": ["engine 2.0.9 is older than the image's tested range ^2.1.0"]
}
```

A failure returns `{ "status": "FAILED", "error": { "code", "message", "phase", "retryable", "hint", "details" } }`. The error codes are listed in section 10.

### 4.2 Progress

The worker emits phase events:

> `queued → resolving → fetching → lfs → installing → loading → rendering{frame,total,fps,etaSec} → encoding → uploading → done`

- **HTTP:** `GET /v2/jobs/:id` returns the latest event. `GET /v2/jobs/:id/events` streams them as SSE.
- **RunPod:** the shim forwards them with `runpod.serverless.progress_update`.

## 5. Transports & deployment modes

`FF_MODE` selects the mode:

| Mode | Process layout | Use |
|---|---|---|
| `runpod-serverless` | Entrypoint starts the Node server on `127.0.0.1:${RENDERER_PORT}` and waits for `/health` = ok, then `exec`s `runpod_worker.py`. The shim POSTs the job, polls or streams progress, and returns the result. | RunPod serverless endpoint |
| `http` | Node server on `0.0.0.0`. **Bearer auth with `RENDERER_API_KEY` is required.** The server refuses to start if `RENDERER_API_KEY` is unset, unless `FF_HTTP_INSECURE=true`. | RunPod GPU pod, docker compose, k8s |
| `cli` | `node dist/src/cli.js --job-file job.json` (or `--job -` for stdin). Writes the result JSON to `--result-file` or to fd 3. stdout is left free for logs. | CI, one-off renders, debugging |

**HTTP API v2:**

- `POST /v2/jobs` returns `202 {id}`.
- `GET /v2/jobs/:id` returns the job.
- `GET /v2/jobs/:id/events` streams events as SSE.
- `POST /v2/jobs/:id/cancel` cancels a job.
- `GET /health` reports readiness, including the git, git-lfs, disk, cache and GPU checks.
- `GET /ping` is the RunPod LB health check.

The v1 routes `/run` and `/status/:id` are removed.

Finished jobs are evicted from memory after `FF_JOB_TTL_SEC` (default 1h). At most `FF_JOB_HISTORY_MAX` jobs are kept.

**Concurrency.** There is exactly one active job per worker (section 3). Extra jobs queue in-process up to `FF_QUEUE_MAX`, and anything beyond that gets `429 BUSY`. To scale, run more workers.

**Cancellation is cooperative:**

- HTTP cancel, a RunPod job cancel, or SIGTERM aborts the job's `AbortSignal`.
  - Git, LFS and install subprocesses are killed straight away.
  - The renderer checks the signal between frames (phase 4 adds `signal` to `renderVideo`/`renderFrame`).
- If the render has not stopped within `FF_KILL_GRACE_SEC`, the job is reported as cancelled anyway. The worker then marks itself unhealthy and exits to recycle (8.3).
- Partial outputs are deleted.
- The job ends as `CANCELLED`, or as `SHUTDOWN` when the worker itself was stopped.

## 6. Git workspace manager

### 6.1 Layout

`FF_CACHE_DIR` defaults to `/runpod-volume/framefields` when that path exists, and to `/var/cache/framefields` otherwise.

```
$FF_CACHE_DIR/
  git/<worker-id>/<repo-hash>.git     # partial (blob:none) mirror per repo, per worker
  lfs/objects/…                       # shared LFS object store (content-addressed; lfs.storage)
  pnpm-store/ npm-cache/ yarn-cache/  # shared package caches (content-addressed)
  models/                             # FRAMEFIELDS_MODELS_DIR (pinned vision models, sha256-checked)
$FF_WORK_DIR/  (local container disk, default /tmp/framefields)
  ws/<repo-hash>/<slot>/              # warm checkout + node_modules, leased one job at a time
  jobs/<jobId>/{out,logs}
  inflight.json                       # the running job, so a crash can be reported after restart (8.3)
```

Why the files are split this way:

- **Mirrors are per worker.** RunPod network volumes can be mounted by several workers at once, and `flock` over the volume is not reliable. Git mirrors are not safe for concurrent writers.
- **LFS objects and package stores are content-addressed with tmp+rename writes, so sharing them is safe.**
- Checkouts and `node_modules` live on local disk. Network volumes are slow at many-small-file IO, and installs there would be the bottleneck.

### 6.2 Fetch sequence

1. **Validate the repo.** Normalise the URL to `host/owner/name` and match it against `FF_REPO_ALLOWLIST`. Reject `file://`, `ext::` and local paths unless `FF_ALLOW_LOCAL_REPOS=true` (used by tests).
2. **Resolve the ref** with `git ls-remote` (or the mirror after a fetch):
   - A full ref is used as is.
   - A bare name is checked against `refs/heads/` and `refs/tags/`. If it matches both, the job fails with `REF_AMBIGUOUS`.
   - A SHA prefix must be unique in the mirror (`REF_AMBIGUOUS` otherwise).
   - Annotated tags are peeled to the commit.
   - If `commit` is given and differs from the resolved SHA, the job fails with `COMMIT_MISMATCH`.
3. **Update the mirror** under an in-process mutex for that repo:
   - Run `git fetch --prune --filter=blob:none origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'`, or fetch only the one SHA when `FF_GIT_FETCH=single`.
   - If the mirror is unreadable (`rev-parse` or `fsck --connectivity-only` fails), delete it and re-clone **once**.
   - If the resolved SHA is still missing after the fetch, the job fails with `REF_NOT_FOUND`. This happens when a force-push between resolve and fetch makes the old SHA unreachable.
4. **Lease a workspace slot** for this repo.
   - **Warm slot:** run `git checkout --force --detach <sha>`, then `git clean -ffdx -e node_modules -e .ff-install-stamp`.
   - **Cold slot:** run `git worktree add --detach` from the mirror.
   - Apply sparse checkout and submodules (`--recursive`, same auth, same allowlist check per submodule URL) if they were requested.
5. **Pull LFS objects:**
   - The checkout runs with `GIT_LFS_SKIP_SMUDGE=1`.
   - Then run `git lfs pull --include=… --exclude=…` with `lfs.storage=$FF_CACHE_DIR/lfs` and `lfs.concurrenttransfers=$FF_LFS_CONCURRENCY`.
   - Transient failures are retried with backoff.
   - **Preflight:** `git lfs ls-files --size` gives the bytes to fetch. If that plus a margin exceeds free disk, the job fails with `DISK_FULL` before downloading anything. LRU eviction of the cache runs first (6.4).
   - **Postflight:** scan the included paths for files that are still LFS pointers (they start with `version https://git-lfs.github.com/spec/v1`). If any remain, fail with `LFS_POINTER_UNRESOLVED` and list the files. Otherwise the renderer would try to decode a 130-byte "video".
6. **Reject unsupported filters.** If `.gitattributes` declares a filter other than `lfs` (for example `git-crypt`) on a path the render needs, fail with `UNSUPPORTED_GIT_FILTER`.

### 6.3 Auth (never in URLs, logs, `.git/config` or `process.env` during a render)

- **HTTPS token:** `GIT_TOKEN` (+ optional `GIT_USERNAME`; the default depends on the host, see 6.5). A custom credential helper (`git -c credential.helper=…`) answers **only for hosts in the allowlist**. A `.lfsconfig` that points LFS at another host therefore never receives the token.

  Per-host tokens use `FF_GIT_CREDENTIALS` (JSON `{host: token}`) or the config file.
- **SSH:** `GIT_SSH_KEY` (base64 or raw PEM) is written to a `0600` tmpfs file. `GIT_SSH_KNOWN_HOSTS` holds the known hosts. Host key checking is `yes` by default; `FF_SSH_ACCEPT_NEW=true` relaxes it. `GIT_SSH_COMMAND` is built by us. LFS over SSH remotes uses `git-lfs-authenticate` automatically.
- **Per-job credentials** (`source.auth`) are **off** by default. When `FF_ALLOW_JOB_CREDENTIALS=true` enables them, they get the same host check and are redacted everywhere.
- **Hardening flags on every git call:**
  - `-c core.hooksPath=/dev/null`
  - `-c protocol.file.allow=never`
  - `-c protocol.ext.allow=never`
  - `-c submodule.recurse=false` (we recurse explicitly)
  - `-c core.symlinks=true`
  - `GIT_TERMINAL_PROMPT=0` (never hang waiting for a password prompt)
  - `GIT_ASKPASS=/bin/false`

### 6.4 Cache eviction

`FF_CACHE_MAX_GB` and `FF_WORK_MAX_GB` set the size limits. Eviction runs before each job, and again whenever a preflight needs space:

- Least-recently-leased workspaces are evicted first, then LFS objects by atime, then whole mirrors.
- A workspace that is currently leased is never evicted.

### 6.5 Git hosts

Git itself behaves the same everywhere; the hosts differ in their auth conventions, LFS endpoints and error messages. Each host gets a small `HostProfile` (`src/git/hosts.ts`). The profile is picked by hostname, or by `FF_GIT_HOSTS` for self-hosted servers (`{"git.acme.dev": "gitlab", "code.acme.dev": "gitea"}`).

| Host | HTTPS username default (token as password) | Token type | LFS notes | Host-specific errors we map |
|---|---|---|---|---|
| GitHub (`github.com`, GHES via `FF_GIT_HOSTS`) | `x-access-token` | fine-grained PAT, GitHub App installation token, classic PAT | LFS on `github.com`; separate bandwidth and storage quota | "This repository is over its data quota" → `LFS_QUOTA_EXCEEDED`; SAML SSO not authorized → `GIT_AUTH_FAILED` with an SSO hint |
| GitLab (`gitlab.com`, self-managed) | `oauth2` | project, group or personal access token, scope `read_repository` | LFS on the same host | 403 "LFS objects are not available" / project size limit → `LFS_QUOTA_EXCEEDED` |
| Bitbucket Cloud (`bitbucket.org`) | `x-token-auth` (access tokens); the Atlassian user for API tokens or app passwords | repository/workspace access token, API token | LFS served from a different host (`bbuseruploads`/media). The credential helper must allow it, and it does not need our token. | "Repository storage limit" → `LFS_QUOTA_EXCEEDED` |
| Gitea / Forgejo | the token owner's username (`GIT_USERNAME` required) | access token, scope `read:repository` | LFS on the same host, if the server has it enabled | LFS disabled on the server → `LFS_UNAVAILABLE` |
| Generic HTTPS / SSH | `GIT_USERNAME` required | anything git accepts | `.lfsconfig` `url`, which must also be an allowed host | generic mapping only |

Rules that apply to every host:

- **The allowlist covers every host we talk to**, including LFS endpoints and submodule remotes. Credentials are handed out per host. A CDN that the LFS API redirects to receives **no** credentials, because the credential helper only answers for allowed hosts and git-lfs only sends them where it asked.
- **SSH known hosts:** the image ships a pinned `known_hosts` for github.com, gitlab.com and bitbucket.org at `apps/renderer-service/deploy/known_hosts`. It is generated at image build with `ssh-keyscan`, and the build fails unless the fingerprints match the ones each host publishes. Self-hosted servers must supply `GIT_SSH_KNOWN_HOSTS`, or opt into `FF_SSH_ACCEPT_NEW=true`.
- **Self-signed TLS on a self-hosted server:** `FF_GIT_CA_BUNDLE` (PEM) is passed as `http.sslCAInfo`. Turning off TLS verification is not offered.
- **Ref resolution** uses only `git ls-remote` and `fetch`, never a host API. This keeps one code path for every host.
- **Test matrix:** an integration test against local bare repos for the generic path, plus a nightly opt-in smoke test against a real private repo on each of GitHub, GitLab and Bitbucket (tokens from CI secrets), and a Gitea container.

## 7. Dependency install

- **Package manager:**
  - The `packageManager` field wins, then the lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm), via corepack.
  - The install root is the nearest workspace root above `workdir`. pnpm installs only that package and its dependencies with `--filter ./<workdir>...`.
- **Lockfile** is always frozen (`--frozen-lockfile` / `npm ci` / `--immutable`). A missing lockfile fails with `LOCKFILE_MISSING`, unless `FF_ALLOW_UNLOCKED_INSTALL=true`.
- **Skip the install** when the slot's `.ff-install-stamp` matches the hash of (lockfile, package manager version, Node major, platform, install flags).
- **Caches:** shared stores on the volume (`--store-dir`, `--prefer-offline`).
- **Install scripts** are on by default, because the native GPU, skia and webcodecs modules need them. `FF_INSTALL_SCRIPTS=false` turns them off. The build toolchain is only present in the `-full` image (section 11).
- **Private registries:** `FF_NPMRC` (secret, file contents) is written to a temp `.npmrc` that is used only for the install.
- **Prepare steps (optional):** `install.prepare: ["fonts"]` in the repo file runs those package scripts after the install, under the same timeout. It is used for fetching fonts and similar setup.
- **Engine alias (always on).** A `module.register` resolve hook, installed once at boot, maps every `framefields` and `@framefields/*` import from inside a workspace to the worker's own copy. This happens however the project declares the dependency (npm range or `workspace:*`). Repo code therefore shares the worker's single, already-initialised GPU stack, and a second copy of Dawn or skia never gets loaded.
- **The project's own copy of framefields is installed but never loaded.** Leaving it out of the install would mean changing the overrides, which breaks the frozen-lockfile check, so the install runs as is and the alias wins at import time. The cost is mostly prebuild downloads, which the shared store absorbs after the first install.
- **Skip the install** entirely when the project's only runtime dependencies are framefields packages, which is the common case. This is the fast path.
- **Engine check:** compare the version range the project declares with the bundled version.
  - If the bundled version doesn't satisfy it, apply `FF_ENGINE_POLICY=warn|fail` (default `warn`, which adds `ENGINE_MISMATCH` to the warnings).
  - `engines.node` mismatches only produce a warning.

## 8. Render execution (in-process)

### 8.1 Loading the entry

1. Resolve `entry` with `realpath` and check that it lies inside the workspace (`PATH_ESCAPE` otherwise, which also covers symlink escapes).
2. Import it with tsx's `tsImport(entryUrl, { parentURL, tsconfig })`.
   - Every call gets its own module namespace, so job N+1 never sees job N's cached modules. A fix pushed to the same file is picked up even when the path is identical.
   - The project's `tsconfig.json` is honoured, including `paths`.
   - A missing module gives `ENTRY_NOT_FOUND`. A TS or syntax error gives `ENTRY_COMPILE_FAILED`, with the first frames of the error.
3. Read the export (`EXPORT_NOT_FOUND`). If it is a function, call it with `args`. A throw here gives `COMPOSITION_BUILD_FAILED`.
4. Normalise the result to a render plan (section 4). Anything that isn't a Composition, a record of compositions, or a plan gives `EXPORT_INVALID`.
5. **Composition from a different engine instance.** If the result was built by some other copy of framefields (the alias was bypassed, for example by a bundled `dist/` inside the repo), `instanceof` fails. The worker then falls back to `toVirtualMedia()` and renders that with its own renderer, adding the warning `ENGINE_FOREIGN_INSTANCE`.

### 8.2 Job sandbox

Repo code shares the worker's process, so every job runs inside a sandbox that is set up before loading and torn down in a `finally`:

| Shared state | What the sandbox does |
|---|---|
| `process.cwd()` | `chdir` to `<workspace>/<workdir>`, because relative asset paths resolve against it; restored afterwards. |
| `process.env` | Adds the filtered `job.env` and `FRAMEFIELDS_*` overrides; removed or restored afterwards. **Secrets are never in `process.env` while repo code runs:** at boot the config is parsed into a frozen object, and `GIT_*`, `STORAGE_*`, `RENDERER_API_KEY`, `FF_GIT_CREDENTIALS` and `FF_NPMRC` are deleted from `process.env`. Git subprocesses get credentials through their own env, never the shared one. |
| `process.exit` | Replaced with a trap that throws `EXPORT_SIDE_EFFECT` ("export a builder; don't render or exit at import time"), e.g. for the README quickstart pattern. It is restored afterwards. |
| `process.argv` | Set to `[node, entry]`, so scripts that parse argv don't see the worker's flags. |
| Unhandled rejections and uncaught exceptions | Process handlers attribute them to the active job. The job fails with `RENDER_FAILED` and the original stack, and the worker stays up. If one arrives when no job is active, it is logged and counted, and it triggers a recycle after `FF_STRAY_ERROR_LIMIT`. |
| Timers and handles left by repo code | They can't be cleaned up reliably in-process. After the job, active handles that the worker didn't own are counted (`process.getActiveResourcesInfo()`). Leaks above `FF_LEAKED_HANDLE_LIMIT` trigger a recycle. |
| Engine caches (fonts, textures, compiled timelines) | Cleared per job through the renderer's reset API (phase 4). The GPU device and pipeline cache are kept, because keeping them warm is the point of this design. |
| Console output | `console.*` from repo code is captured into the job log, tagged with the jobId. |

### 8.3 Limits, failure detection & recycling

- **Phase timeouts:** `FF_TIMEOUT_GIT_SEC`, `FF_TIMEOUT_LFS_SEC`, `FF_TIMEOUT_INSTALL_SEC`, `FF_TIMEOUT_LOAD_SEC` and `FF_TIMEOUT_RENDER_SEC`, plus the job's total `timeoutSec`. Git, LFS and install are subprocesses and are killed hard. Load and render are in-process, and are aborted through the job's `AbortSignal`.
- **Stalls:** if no progress event arrives for `FF_STALL_TIMEOUT_SEC` while rendering, the job fails with `RENDER_STALLED`.
- **Code that ignores the signal:** for example user code stuck in `await new Promise(() => {})` or a sync loop.
  - The job is reported `RENDER_TIMEOUT` or `CANCELLED` as soon as the grace period ends. The reporting runs on a separate timer; a sync loop is blocking the event loop, so it is detected by an event-loop watchdog instead (see below).
  - The worker then becomes unhealthy, stops accepting work, and exits to recycle.
- **Event-loop watchdog:** a `worker_threads` heartbeat checks the main loop. If the loop is blocked longer than `FF_EVENT_LOOP_BLOCK_SEC` (default 120), the watchdog writes the failure to `inflight.json` and kills the process.
- **Crash journal.** Before loading, the job's id, phase and input are written to `$FF_WORK_DIR/inflight.json`, and the file is removed when the job settles.
  - On boot, a leftover journal means the previous process died mid-job (OOM, native crash or watchdog). The job is recorded as `RENDER_CRASHED`, or `RENDER_OOM` when the exit reason is known. In HTTP mode `GET /v2/jobs/:id` still answers after the restart.
  - In RunPod serverless the platform itself sees the worker die and fails or retries the job, so the journal is only used for logs.
- **GPU device lost:** a `device lost` or VRAM allocation failure gives `GPU_DEVICE_LOST`, then a recycle.
- **Memory:** after each job, if `heapUsed` or RSS is above `FF_RECYCLE_HEAP_MB` or `FF_RECYCLE_RSS_MB`, the worker recycles. A V8 OOM kills the process, and the crash journal reports it.
- **Planned recycling:** `FF_MAX_JOBS_PER_WORKER` (default 25) bounds slow leaks from module graphs that can't be unloaded, and from native code.
- **What recycling does:** stop accepting jobs, let the queue drain to other workers (HTTP `503`, RunPod `refresh_worker`), report the current job, then exit 0. RunPod, Docker `restart: unless-stopped`, or k8s starts a fresh worker. In `cli` mode the process exits after one job anyway.

### 8.4 Render

Each output in the plan is rendered into `jobs/<jobId>/out/`, in plan order, according to its `render.kind`:

- `renderVideo({ outputPath, codec, quality, qa, signal, onProgress })`,
- `renderFrame` per frame,
- `renderFrameGrid`,
- or LUT/audio.

Progress callbacks become the phase events in 4.2.

### 8.5 Output verification & upload

- **Check the output:**
  - It must exist, be non-empty, and be at most `FF_OUTPUT_MAX_BYTES`.
  - The container is probed (ffprobe) for duration, frames and streams.
  - If the probe fails or the duration differs from the expected value by more than 1 frame, the job fails with `OUTPUT_INVALID`.
  - If `render.qa.failOn` matches a QA finding, the job fails with `QA_FAILED` and the report is attached. The output is still uploaded unless `FF_QA_BLOCK_UPLOAD=true`.
- **Upload targets:**
  - **s3:** multipart upload with retries. The bucket must be in `FF_OUTPUT_BUCKETS`. Object metadata `x-ff-sha`, `x-ff-job` and `x-ff-idempotency` is set.
  - **presigned:** PUT with the given headers. A 403/400 on an expired signature gives `UPLOAD_URL_EXPIRED`, which is not retryable. The hint is to sign with an expiry ≥ the job timeout.
  - **local:** an atomic rename into `FF_OUTPUT_DIR`.
  - **inline:** base64, only up to `FF_INLINE_MAX_BYTES` (default 5 MB, below RunPod's payload limits); above that the job fails with `OUTPUT_TOO_LARGE`.
- The job dir is deleted afterwards. Set `FF_KEEP_FAILED_JOBS=true` to keep failed ones for debugging.

### 8.6 Idempotency & retries

RunPod delivers jobs at least once, and callers retry. With an `idempotencyKey` and an s3 output, the worker `HEAD`s the key before resolving. If the object exists with the same `x-ff-idempotency` **and** the same resolved SHA, the worker returns the existing output with `cache.output = "hit"` and does not render. Without a key, the output is overwritten (last writer wins).

## 9. Trust & security model

The worker **executes code from the repo**. Anyone who can submit a job and point it at a repo they control gets code execution on the GPU host, and that host can reach whatever its network can. The defaults are therefore closed:

- `FF_REPO_ALLOWLIST` is **required** in git mode (e.g. `github.com/acme/*`). With `FF_DEFAULT_REPO` set and no allowlist, only that repo is allowed.
- HTTP mode requires `RENDERER_API_KEY`. RunPod endpoints already require the RunPod API key.
- **Repo code runs in the same process as the worker's credentials.** Secrets are removed from `process.env` before any repo code runs (8.2), and they are never written to disk in the workspace. Even so, code running in-process can in principle reach anything in memory. **The repos on the allowlist must be trusted to the same degree as the worker image.** Use a storage key scoped to the output bucket, and a read-only git token scoped to the allowed repos. With a `presigned` output the worker needs no storage credentials at all.
- The process runs as non-root user `framefields`. The workspace and cache are owned by it, and nothing outside them is writable.
- Logs and results go through a **redactor**. It strips tokens, URL userinfo, presigned query strings, and the `job.env` values the config marks secret.
- Documented risk: install scripts and repo code have network access. Self-hosters who need more can run with egress firewalling; that is out of scope here.

## 10. Error model

Every failure maps to a stable `code`. `retryable` is what RunPod or the caller should act on. Boot-time failures make `/health` return 503 and, in serverless mode, exit non-zero so RunPod recycles the worker.

| Phase | Code | Retryable | Typical cause / hint |
|---|---|---|---|
| boot | `CONFIG_INVALID` | – | Bad or missing env. The message lists every invalid key. |
| boot | `GPU_UNAVAILABLE` | – (worker recycled) | No Vulkan device, or the driver doesn't match the image's CUDA/Vulkan. |
| boot | `TOOL_MISSING` | – | `git` or `git-lfs` is not on PATH (custom image). |
| validate | `JOB_INVALID` | no | Schema error, with zod paths. |
| validate | `REPO_NOT_ALLOWED` / `BUCKET_NOT_ALLOWED` / `PATH_ESCAPE` | no | |
| validate | `BUSY` | yes | The queue is full (HTTP 429). |
| resolve | `GIT_AUTH_FAILED` | no | Bad or expired token, or a missing SSH key or known_hosts entry. |
| resolve | `REPO_NOT_FOUND` | no | Also returned for private repos without credentials. |
| resolve | `REF_NOT_FOUND` / `REF_AMBIGUOUS` / `COMMIT_MISMATCH` | no | A branch was deleted, force-pushed, or a short SHA matches several commits. |
| resolve | `GIT_TLS_FAILED` | no | Certificate verification failed, usually a self-signed server. The hint points to `FF_GIT_CA_BUNDLE`. |
| fetch | `GIT_NETWORK` | yes | Timeouts, 5xx, connection reset. Retried internally first. |
| fetch | `GIT_CACHE_CORRUPT` | yes | Raised only if the automatic re-clone also fails. |
| lfs | `LFS_AUTH_FAILED` | no | |
| lfs | `LFS_QUOTA_EXCEEDED` | no | The host's LFS bandwidth or storage quota (GitHub, GitLab or Bitbucket, see 6.5). The hint points to an alternative LFS server. |
| lfs | `LFS_UNAVAILABLE` | no | The server has LFS turned off (common on self-hosted Gitea). |
| lfs | `LFS_OBJECT_MISSING` | no | A pointer was committed without its object being pushed. The message lists the paths. |
| lfs | `LFS_POINTER_UNRESOLVED` | no | The include patterns didn't cover a needed asset, or LFS is disabled. |
| lfs | `UNSUPPORTED_GIT_FILTER` | no | `git-crypt` and similar. |
| any | `DISK_FULL` | yes (other worker) | Raised by the preflight or by ENOSPC. |
| install | `LOCKFILE_MISSING` / `INSTALL_FAILED` / `INSTALL_TIMEOUT` | no / no / yes | The tail of the install log is attached. |
| install | `ENGINE_INCOMPATIBLE` | no | Only with `FF_ENGINE_POLICY=fail`. |
| load | `ENTRY_NOT_FOUND` / `ENTRY_COMPILE_FAILED` / `EXPORT_NOT_FOUND` / `EXPORT_INVALID` / `EXPORT_SIDE_EFFECT` / `COMPOSITION_BUILD_FAILED` | no | The user's stack trace is attached and trimmed to the project's files. |
| render | `ASSET_NOT_FOUND` | no | A referenced file is missing. Often an LFS include that is too narrow, so the hint says so. |
| render | `RENDER_FAILED` / `RENDER_STALLED` / `RENDER_TIMEOUT` | no / yes / no | |
| render | `RENDER_OOM` / `GPU_DEVICE_LOST` / `RENDER_CRASHED` | yes (fresh worker) | The worker recycles. A crash is reported from the crash journal after the restart (8.3). |
| verify | `OUTPUT_MISSING` / `OUTPUT_INVALID` / `OUTPUT_TOO_LARGE` / `QA_FAILED` | no | |
| upload | `UPLOAD_FAILED` | yes | Retried internally first. |
| upload | `UPLOAD_URL_EXPIRED` | no | |
| any | `CANCELLED` / `SHUTDOWN` | no / yes | `SHUTDOWN` means the worker was preempted or scaled down mid-job. |

Warnings don't fail a job; they are listed in the result's `warnings`. They include `ENGINE_MISMATCH` (the declared framefields range isn't satisfied by the bundled engine, under `warn` policy), `ENGINE_FOREIGN_INSTANCE` (8.1), and `NODE_ENGINE_MISMATCH`.

## 11. Configuration reference (env)

The config is one zod schema (`src/config/schema.ts`). `FF_CONFIG_FILE` can point at a JSON or YAML file for structured values, such as per-host credentials or allowlists. Env vars override the file.

On boot the service validates **all** keys and fails with the complete list of problems. It then logs the effective config with secrets redacted.

| Group | Vars (defaults) |
|---|---|
| Mode | `FF_MODE` (`runpod-serverless` if `RUNPOD_POD_ID` is set, else `http`), `RENDERER_PORT` (8082), `RENDERER_API_KEY`, `FF_HTTP_INSECURE` (false), `LOG_LEVEL` (info), `LOG_FORMAT` (json) |
| Source | `FF_DEFAULT_REPO`, `FF_DEFAULT_REF` (`main`), `FF_REPO_ALLOWLIST` (comma globs), `FF_ALLOW_LOCAL_REPOS` (false), `FF_GIT_FETCH` (`mirror`\|`single`), `FF_LFS_CONCURRENCY` (8), `FF_LFS_DEFAULT_INCLUDE` |
| Git auth & hosts | `GIT_TOKEN`, `GIT_USERNAME`, `FF_GIT_CREDENTIALS` (`{host: token \| {username, token}}`), `FF_GIT_HOSTS` (`{host: github\|gitlab\|bitbucket\|gitea\|generic}`), `FF_GIT_CA_BUNDLE`, `GIT_SSH_KEY`, `GIT_SSH_KNOWN_HOSTS`, `FF_SSH_ACCEPT_NEW` (false), `FF_ALLOW_JOB_CREDENTIALS` (false) |
| Install | `FF_INSTALL_SCRIPTS` (true), `FF_ALLOW_UNLOCKED_INSTALL` (false), `FF_NPMRC`, `FF_ENGINE_POLICY` (`warn`) |
| Storage | `STORAGE_DRIVER` (`s3`\|`local`\|`none`), `STORAGE_ENDPOINT`, `STORAGE_REGION` (`auto`), `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`, `STORAGE_PUBLIC_BASE_URL`, `STORAGE_FORCE_PATH_STYLE` (MinIO), `FF_OUTPUT_BUCKETS`, `FF_OUTPUT_DIR`, `FF_INLINE_MAX_BYTES`, `FF_OUTPUT_MAX_BYTES`. The `R2_*` names are gone, with no aliases. |
| Paths & cache | `FF_CACHE_DIR`, `FF_WORK_DIR`, `FF_CACHE_MAX_GB` (50), `FF_WORK_MAX_GB` (40), `FRAMEFIELDS_MODELS_DIR` (`$FF_CACHE_DIR/models`), `FRAMEFIELDS_FONTS_DIR` |
| Limits | `FF_QUEUE_MAX` (8), `FF_JOB_TIMEOUT_MAX_SEC` (7200), `FF_TIMEOUT_{GIT,LFS,INSTALL,LOAD,RENDER}_SEC`, `FF_STALL_TIMEOUT_SEC` (300), `FF_KILL_GRACE_SEC` (20), `FF_JOB_TTL_SEC` (3600), `FF_JOB_HISTORY_MAX` (500) |
| Recycling | `FF_MAX_JOBS_PER_WORKER` (25; 0 = unlimited), `FF_RECYCLE_HEAP_MB` (4096), `FF_RECYCLE_RSS_MB` (0 = off), `FF_EVENT_LOOP_BLOCK_SEC` (120), `FF_STRAY_ERROR_LIMIT` (3), `FF_LEAKED_HANDLE_LIMIT` (50). `NODE_OPTIONS=--max-old-space-size` is set by the image. |
| Job env | `FF_JOB_ENV_ALLOW` (`*` minus a reserved denylist), `FF_KEEP_FAILED_JOBS` (false), `FF_QA_BLOCK_UPLOAD` (false) |

`BASE_URL`, `R2_*` and `R2_CUSTOM_DOMAIN` are removed together with the inline path. Repo assets are local files in the checkout, so `configureAssetUrls` is no longer called. A project that loads assets over HTTP uses absolute URLs.

The service no longer uses `S3StorageService` from `@framefields/server-utils`, which reads `R2_*`. Its output sink (phase 6) has its own S3 client configured from `STORAGE_*`.

## 12. Image, RunPod template, docs

**Image** (`Dockerfile.renderer`, renamed to `apps/renderer-service/Dockerfile`, with the build context still at the repo root):

- **Runtime packages added:** `git`, `git-lfs`, `openssh-client`, `ca-certificates`, `tini` (PID 1, reaps git and install subprocesses), `jq`. Corepack is pre-warmed for pnpm, yarn and npm, and `tsx` ships in the service's prod dependencies (its `tsImport` API is used in-process).
- **Two variants:**
  - `:<ver>` (slim) has no compiler. It relies on prebuilds and the bundled native modules.
  - `:<ver>-full` adds `build-essential` and `python3-dev`, for projects whose native dependencies need compiling.
- The user is renamed from `gatewai` to `framefields`. The `HEALTHCHECK` hits `/health`.
- **Entrypoint fixes:**
  - correct paths (`apps/renderer-service`);
  - `xvfb-run` is used only when `FF_XVFB=auto` and no headless Vulkan/EGL is available;
  - pre-boot checks: GPU visible (`nvidia-smi`, warn only), cache dirs writable, `git lfs install --skip-repo`.
- **Published to** `ghcr.io/gatewai-dev/framefields-renderer` by a release workflow, tagged from the package version. Multi-arch is not needed because RunPod is amd64.

**RunPod template:** `apps/renderer-service/deploy/runpod/`.

- `template.json` holds the image, `containerDiskInGb` (40), `volumeMountPath` (`/runpod-volume`), and the env with `{{ RUNPOD_SECRET_* }}` references for `GIT_TOKEN`, `GIT_SSH_KEY`, `STORAGE_*` and `RENDERER_API_KEY`. The template is created through the UI or the GraphQL API.
- `README.md` covers:
  - the serverless vs pod choice;
  - **setting the endpoint execution timeout** (the RunPod default is far below a long render);
  - network volume sizing, and keeping it in the same data center as the GPUs;
  - FlashBoot;
  - sample `curl` calls for `/run`, `/status` and `/stream`;
  - recommended GPU types.
- `deploy/docker-compose.yml` runs the service with a local MinIO for self-hosting off RunPod.

**Docs:** a "Self-hosted rendering" page on the docs site, plus a `framefields.render.json` schema reference.

## 13. Implementation phases

Each phase is its own PR-sized step with tests.

0. **Unbreak and remove the inline path.** ✅ Done.
   - Drop the DI container (`di-setup.ts`, inversify, `ServerMediaService`, `R2StorageService`). Storage returns in phase 6 as the service's own output sink.
   - Delete the `virtualMedia` path: `job-processor.ts`, `render-upload.ts`, `cli.ts --job <json>`, the `/run` and `/status` routes, `configureAssetUrls`/`BASE_URL`, and the old `render.test.ts` cases. Keep `/health`, `/ping`, readiness and graceful shutdown.
   - Fix the `gatewai-renderer` paths in the entrypoint and the Python shim.
   - Get `pnpm --filter @framefields/renderer-service typecheck test` green.
1. **Config + job schema v2 + error model.** ✅ Done.
   - `src/config/` (frozen config, secrets scrubbed from `process.env`), `src/jobs/schema.ts`, `src/errors.ts` (`RenderError` with `code`/`phase`/`retryable`), and the redactor.
   - API-key auth on HTTP, the job store with TTL eviction, and the single-slot queue.
2. **GitWorkspace.** ✅ Done, except that the LFS download is untested locally because git-lfs isn't installed.
   - Mirror cache, ref resolution, workspace leasing, auth helpers and host profiles (6.5), LFS pull with pre- and postflight, eviction.
   - Integration tests use local bare repos and a file-based LFS remote (`lfs.standalonetransferagent`), so no network is needed.
3. **Installer.** ✅ Done: package manager detection (via `packageManager` or the lockfile, run through corepack), frozen install, skipping the install when nothing else is needed, the stamp check, shared stores, the engine range check, and install error classification. `install.prepare` steps are deferred until the repo defaults file (`framefields.render.json`) is implemented.
4. **Engine hooks (in `@framefields/renderer` and `framefields`).** ✅ Done:
   - `signal: AbortSignal` and `onProgress` on `renderVideo`, checked between frames and before the audio mix. Single-frame renders don't need either.
   - `resetRenderCaches()` (`@framefields/renderer`) clears media inputs and decoders, textures, LUTs and fonts. The worker calls it plus `FontManager.clear()` before each job. The GPU device and pipelines stay warm.
   - A GPU test (`src/engine.gpu.test.ts`, run with `FF_GPU_TESTS=1`) confirmed that without the reset, a changed file at the same workspace path is served stale.
   - Not yet verified: re-opening a *video* file at the same path after the reset. A comment in `renderImage` says a mediabunny `Input` can only be created once per URL. Phase 5 needs a GPU test that renders a video layer in two jobs back to back.
5. **InProcessRenderer.**
   - The engine alias resolve hook, `tsImport` loading, export-shape normalisation, the job sandbox (8.2), the watchdog, the crash journal, and recycling.
6. **Outputs.** The s3, presigned, local and inline sinks, verification (ffprobe), multi-output keys, and idempotency.
7. **Transports.**
   - HTTP v2 with SSE progress and cancel.
   - New `runpod_worker.py` (localhost client, `progress_update`, error passthrough with `retryable`, `refresh_worker` on recycle).
   - CLI `--job-file` and `--result-file`.
8. **Image + template + compose + docs.**
   - Release workflow.
   - GPU smoke test: render the fixture repo on a RunPod pod. Run it by hand first, then as a nightly job.
   - Nightly host smoke test against GitHub, GitLab, Bitbucket and a Gitea container (6.5).
9. **(Later)**
   - Chunked distributed rendering: split a frame range across N jobs and concat with a stream copy.
   - Webhooks on completion (`output.webhook` with an HMAC signature).

## 14. Test plan

- **Unit tests:**
  - config parsing;
  - ref classification;
  - host profile selection and per-host credential answers, including no credentials for unlisted LFS/CDN hosts;
  - key templates and path guards;
  - the redactor (tokens in URLs, presigned queries);
  - error classification from git, LFS (per host), pnpm and subprocess exit signatures, using captured stderr fixtures;
  - export-shape normalisation;
  - the job sandbox restoring `cwd`, env, `process.exit` and argv after success, a throw and a timeout.
- **Integration (no GPU):** `test/fixtures/project/` is a tiny framefields project with one LFS-tracked PNG. Tests build a bare repo and a file-based LFS store at test time, then cover:
  - branch, tag, SHA, ambiguous ref, force-push between resolve and fetch, deleted branch;
  - LFS include too narrow, an object missing on the server;
  - a corrupt mirror that gets re-cloned;
  - a missing lockfile, and a warm-slot install skip;
  - every `EXPORT_*` failure;
  - the engine alias: the fixture declares `framefields@^2` and must get the worker's instance;
  - two jobs back to back on the same path with different code, which must not hit the module cache;
  - secrets absent from `process.env` inside repo code;
  - `process.exit` in user code, a never-resolving promise (timeout, then recycle flag), a sync infinite loop (watchdog kill and crash journal report on restart), and cancel mid-render.

  The GPU render is stubbed behind an injected renderer interface.
- **GPU (CI optional, manual on RunPod):** an end-to-end render of the fixture to MinIO, with a QA report; a cold vs warm timing comparison; worker recycling after `GPU_DEVICE_LOST`, simulated with a debug hook.
- **Image:** a `docker run … --version` and a `/health` check in CI. `hadolint`.

## 15. Open questions

None at the moment. The decisions are recorded at the top of this document.
