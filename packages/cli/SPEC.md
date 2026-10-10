# `@framefields/cli` — the `ff` command

Status: **Draft v1** · Owner: engine team · Consumers: developers, coding agents (Claude, Codex), CI, Framefields Cloud

`ff` is the command line for Framefields projects. It does two jobs that today live in every
project's hand-written `src/render.ts`:

1. **Local work** — preview, inspect frames, render grids and videos of a project's compositions.
2. **Cloud work** — repositories, git auth, asset sync, cloud renders, issues and pull requests on
   Framefields Cloud, with `gh`-style ergonomics.

Both halves hinge on one new, small, static file: the project manifest `framefields.json`.

---

## 1. Why

Every example in `examples/` reimplements the same CLI by hand:

| Example | `render.ts` modes | Previewable compositions | Declared where |
|---|---|---|---|
| `19_framefields_film` | video, frames, grid, preview, track | `src/film.ts#buildFilm` | inside `render.ts` |
| `21_full_circle` | video, frames, grid, preview | `src/film.ts#buildFilm` | inside `render.ts` |
| `22_framefields_launch` | video, frames, grid, preview (+ fonts, song, images, precomp scripts) | `src/film.ts#buildFilm` | inside `render.ts` |
| `23_data_story` | video, frames, grid, preview | `src/film.ts#buildFilm` | inside `render.ts` |
| `24_audio_capabilities` | all / preview `<step>` | **8** builders in one file | a hard-coded `stepNames[]` array |

Consequences:

- **Nothing outside the project can tell what is previewable.** The cloud's Preview tab, render
  dispatch and agents see a tree of `.ts` files where most are scenes (`scenes/*.ts` return layers,
  not compositions), utilities (`theme.ts`, `grid.ts`), scripts (`generate-assets.ts`), tests, or
  dozens of `scratch/` probes.
- **Multi-composition projects need bespoke argument parsing** (`pnpm render preview 3` →
  `buildStep3FadedReverbAudio`).
- **The verification ladder** (typecheck → frames → grid → video, see the `framefields-render`
  skill) is re-typed in each project, with different output paths and flags.

## 2. Principles

1. **Agent-first, human-pleasant.** Every command has `--json`; output on stdout is data, progress
   and logs go to stderr. No prompts when stdin is not a TTY (or with `--yes`); a missing required
   value is an error with the exact flag to pass, never a hang.
2. **Static over executable configuration.** What the cloud and agents need to read lives in JSON
   that can be read from git at any commit without running code.
3. **Zero config for the common case.** A project with `src/film.ts` exporting `buildFilm` works
   with no manifest at all.
4. **`gh` parity where it maps.** Same nouns and verbs (`repo create`, `pr merge`, `issue list`,
   `auth login`, `api`), so muscle memory and agent priors transfer.
5. **The project's engine renders.** Local preview/render uses the `framefields` version installed
   in the project, never a copy bundled into the CLI, so output matches the project's lockfile.
6. **Idempotent and resumable.** `ff push`, `ff asset sync` and uploads can be re-run after any
   interruption and converge.

---

## 3. The project manifest: `framefields.json`

### 3.1 Format (v1)

```jsonc
{
  "$schema": "https://framefields.dev/schemas/project.v1.json",
  "version": 1,
  "compositions": {
    "showcase": {
      "entry": "src/audio-pipeline.ts",
      "export": "buildAudioShowcase",
      "title": "Audio showcase",
      "default": true
    },
    "step-1": {
      "entry": "src/audio-pipeline.ts",
      "export": "buildStep1InitialAudio",
      "title": "Initial audio",
      "group": "Steps",
      "description": "Clean baseline soundtrack without DSP"
    }
  },
  // Optional sections; all have defaults.
  "assets": { "directory": "assets", "exclude": ["**/.DS_Store", "scratch/**"] },
  "output": "output"
}
```

| Field | Type | Rules |
|---|---|---|
| `version` | `1` | Optional; defaults to 1. |
| `compositions` | `Record<id, Composition>` | ≥ 1 entry. Insertion order is display order. |
| `id` (key) | string | `^[a-z0-9][a-z0-9-]{0,62}$`. Stable: used in URLs, `ff` arguments, render jobs, notes. |
| `entry` | string | Repo-relative path, no `..`, ends in `.ts` `.tsx` `.mts` `.js` `.mjs`. |
| `export` | string | JS identifier. Defaults to `"default"`. The export is a function returning `Composition` or `Promise<Composition>`. |
| `title` | string ≤ 120 | Defaults to the id, humanised (`step-1` → `Step 1`). |
| `description` | string ≤ 500 | Optional. |
| `group` | string ≤ 60 | Optional. Groups compositions in pickers ("Steps", "Scenes", "Cutdowns"). |
| `default` | boolean | At most one. Without one, the first composition is the default. |
| `assets.directory` | string | Defaults to `assets`. What `ff asset sync` scans. |
| `assets.exclude` | glob[] | Defaults to `["**/.DS_Store"]`. |
| `output` | string | Local render output directory. Defaults to `output`. |

- **Unknown keys are preserved and ignored**, so newer manifests parse with older tools.
- **Only things that can't be computed belong here.** Size, fps and duration come from the
  composition when it loads (as `startPreview` already does), so they can't drift.
- **No manifest ⇒ one implicit composition**
  `{ "film": { "entry": "src/film.ts", "export": "buildFilm", "default": true } }`.
  This is what `ff init` scaffolds and what four of the five examples already use.

### 3.2 Composition references on the command line

Anywhere a command takes `<composition>`:

| Form | Meaning |
|---|---|
| *(omitted)* | The default composition. |
| `step-1` | A manifest id. |
| `src/probe.ts#buildProbe` | An ad-hoc reference to an unlisted builder — for `scratch/` probes. Local commands only; the cloud renders manifest ids or explicit entry/export. |
| `src/probe.ts` | Same, with `export` = `default`. |

### 3.3 Why JSON and not `framefields.config.ts`

The earlier cloud spec proposed `framefields.config.ts`. A TypeScript config can't be read by the
cloud from a git tree, by an agent without executing code, or by tools in another language. The
manifest only holds declarative data, so nothing is lost. Projects that want typed authoring can
generate it; `framefields.json` stays the artifact of record.

### 3.4 Ownership: `framefields/project`

The engine package owns the format so `ff`, `startPreview`, the renderers and the cloud agree:

```ts
// packages/framefields/src/project/index.ts  →  export "framefields/project"
export const MANIFEST_FILE = "framefields.json";
export const projectManifestSchema: z.ZodType<ProjectManifest>; // the rules in §3.1
export interface ResolvedComposition {
  id: string; entry: string; export: string; title: string;
  description: string | null; group: string | null; default: boolean;
}
export interface Project {
  root: string;                  // directory containing framefields.json (or package.json)
  source: "manifest" | "default";
  compositions: ResolvedComposition[];
  defaultId: string;
  assets: { directory: string; exclude: string[] };
  output: string;
}
/** Finds the project root from `cwd` upwards and resolves its manifest. Throws ProjectError with a path + message on invalid input. */
export function loadProject(cwd?: string): Promise<Project>;
/** Resolves `<composition>` (id, `file#export`, or undefined) against a project. */
export function resolveComposition(project: Project, ref?: string): ResolvedComposition;
/** Imports the entry and calls the export: the one place that turns a reference into a Composition. */
export function buildComposition(project: Project, ref?: string): Promise<Composition>;
```

- `startPreview` gains `startPreview({ project, composition })` alongside today's `{ entry, export }`.
- The JSON Schema at `https://framefields.dev/schemas/project.v1.json` is generated from the zod
  schema at build time (`scripts/`), so editors validate the file.
- **Framefields Cloud** already implements a compatible reader
  (`framefields-cloud/src/services/project-manifest.ts`) and serves
  `GET /v1/repos/:id/compositions`. When `framefields/project` ships, the cloud should import it
  instead of keeping a copy.

---

## 4. Package

| | |
|---|---|
| Name | `@framefields/cli` |
| Location | `packages/cli` (this folder) |
| Binary | `ff` |
| License | Apache-2.0 (open source, per the repository boundary model) |
| Runtime | Node ≥ 22, ESM. Built with `tsdown` like the other packages. |
| Argument parsing | `citty` or `commander` — subcommands, typed flags, generated `--help`. |
| Dependencies | `framefields/project` (manifest only — tiny), an HTTP client, `@clack/prompts` (TTY only). **Not** the engine. |
| Engine resolution | Local render/preview commands `import()` `framefields` resolved from the **project** directory. If it isn't installed: error `framefields is not installed in <dir> — run: pnpm add framefields`. |

Layout:

```
packages/cli/
  src/
    bin.ts                # entry: parses argv, dispatches
    commands/             # one file per noun: auth, init, repo, clone, push, pull, asset,
                          # ls, preview, frames, grid, render, check, issue, pr, api, config
    cloud/client.ts       # typed REST client for Framefields Cloud (§8)
    cloud/credentials.ts  # hosts.json + keychain
    git/                  # thin wrappers over the user's git binary
    output.ts             # --json, tables, colors, stderr progress
  test/                   # unit + golden-output tests; e2e against a local wrangler dev
```

---

## 5. Command reference

Global flags: `--json`, `--yes`, `-C <dir>` (run as if in `<dir>`), `--host <url>`
(default `https://framefields.dev`), `--quiet`, `--verbose`, `--no-color`.

### 5.1 Local (no account needed)

| Command | Does | Replaces |
|---|---|---|
| `ff ls` | Lists compositions: id, title, group, entry#export, default. `--json` emits `Project`. | — |
| `ff check [<composition>…]` | Ladder step 1: `tsc --noEmit` + builds each composition (all by default) and validates `toSpec()` against the program schema. Non-zero exit on any failure. | ad-hoc |
| `ff preview [<composition>]` | `startPreview` for the composition; prints the URL. `--open`, `--port`, `--no-audio`. In the player, compositions from the manifest are switchable. | `pnpm render preview` |
| `ff frames <composition> <frame…>` | Ladder step 2: PNGs to `<output>/frames/<id>/f0060.png`. Accepts frame numbers or timecodes (`2.5s`, `00:02:15`). | `render frames` |
| `ff grid [<composition>]` | Ladder step 3: contact sheet. `--count 16 --columns 4 --cell-width 480 --from --to`. Writes `<output>/<id>-grid.png`. | `render grid` |
| `ff render [<composition>] --local` | Ladder step 5: MP4 to `<output>/<id>.mp4`. `--quality`, `--fps`, `--range`. | `render video` |

All local commands print the files they wrote; with `--json`, `{ "files": [...] }`. Paths are
relative to the project root so agents can open them directly.

### 5.2 Project & repository

| Command | Does | Cloud API |
|---|---|---|
| `ff init [dir] [--template <slug>]` | Scaffolds `src/film.ts`, `framefields.json`, `framefields.assets.json`, `.gitignore`, `package.json` with `framefields`. Templates come from `examples/` (`--template data-story`). | — |
| `ff repo create [name] [--public\|--private] [--push]` | Creates the cloud repo, adds the `origin` remote, links the directory (§6.2). With `--push`, pushes. | `POST /v1/repos` |
| `ff repo view [repo] [--web]` | Name, visibility, default branch, remote, compositions. | `GET /v1/repos/:id`, `/compositions` |
| `ff repo list` | Repos in the active organization. | `GET /v1/repos` |
| `ff repo fork <repo> [--name] [--clone]` | Forks; shares assets server-side. | `POST /v1/repos/:id/fork` |
| `ff repo delete <repo> --yes` | Deletes. Requires `--yes` or typing the name. | `DELETE /v1/repos/:id` |
| `ff clone <repo> [dir]` | `git clone` with the credential helper, then `ff asset pull`. | `POST /v1/repos/:id/tokens`, `GET /v1/assets/:sha` |

### 5.3 Sync

| Command | Does | Cloud API |
|---|---|---|
| `ff push [remote] [branch]` | 1. `ff asset sync`. 2. If `framefields.assets.json` changed, commit it (`assets: sync external assets`). 3. `git push`. 4. Report the ref's lockfile. | `POST /v1/repos/:id/assets/diff`, upload endpoints, `PUT /v1/repos/:id/asset-refs` |
| `ff pull [remote] [branch]` | `git pull`, then `ff asset pull`. | `GET /v1/assets/:sha` |
| `ff asset sync [--dry-run]` | Hash `assets.directory`, upload what the cloud lacks (resumable multipart), rewrite the lockfile. No git. | as above |
| `ff asset pull [--force]` | Download lockfile entries missing on disk; verify SHA-256. | `GET /v1/assets/:sha` |
| `ff asset status` | Local vs lockfile vs cloud: new, modified, missing, unreferenced. | `POST /v1/assets/diff` |

Branch deletion: `ff push --delete <branch>` also calls `DELETE /v1/repos/:id/asset-refs?ref=…`.

### 5.4 Cloud renders

| Command | Does | Cloud API |
|---|---|---|
| `ff render [<composition>]` | Dispatches the composition at `HEAD` (must be pushed; otherwise error with `ff push` hint). `--ref`, `--type video\|frame\|sheet`, `--fps`, `--quality`, `--wait`, `--download`. Prints the job id (and URL). | `POST /v1/renders` with `composition` |
| `ff render status <job> [--watch]` | Status, progress, deliverable URL. | `GET /v1/renders/:id` |
| `ff render list [--status] [--composition]` | Jobs for the linked repo. | `GET /v1/renders?repositoryId=` |
| `ff render download <job> [-o file]` | Saves the deliverable. | `downloadUrl` from status |
| `ff render cancel <job>` | Cancels a queued/running job. | **gap** (§8.2) |

`--local` on `ff render` switches to §5.1 behaviour; the two never mix silently.

### 5.5 Issues & pull requests (`gh` parity)

Issues and pull requests share one number sequence per repository, as on GitHub.

| Command | Cloud API |
|---|---|
| `ff issue list [--state open\|closed\|all] [--search q]` | `GET /v1/repos/:id/issues` |
| `ff issue create --title --body [--label]…` (`--body-file -` reads stdin) | `POST /v1/repos/:id/issues` |
| `ff issue view <n> [--comments]` | `GET /v1/repos/:id/issues/:n` |
| `ff issue comment <n> --body` | `POST /v1/repos/:id/issues/:n/comments` |
| `ff issue close <n> [--comment]` / `reopen <n>` / `edit <n> --title --add-label --remove-label` | `PATCH /v1/repos/:id/issues/:n` |
| `ff pr create [--base] [--head] --title --body [--draft]` (head defaults to the current branch; pushes it first if needed) | `POST /v1/repos/:id/pulls` |
| `ff pr list` / `view` / `comment` / `close` / `reopen` / `ready <n>` | `/v1/repos/:id/pulls…` |
| `ff pr merge <n>` | Merges `head` into `base` with local git and pushes, **then** records it: `POST /v1/repos/:id/pulls/:n/merge`. Today the cloud only records merges, so the git half is the CLI's job. |
| `ff pr checkout <n>` | Fetches and checks out the head branch. |

### 5.6 Auth, config, escape hatch

| Command | Does |
|---|---|
| `ff auth login [--with-token]` | TTY: opens the browser to create an API key and pastes it back. Non-TTY: reads the key from stdin (`echo $KEY \| ff auth login --with-token`). Verifies with `GET /v1/organization`. |
| `ff auth status` | Host, organization, key prefix, scopes, expiry. |
| `ff auth logout` | Removes the stored key. |
| `ff auth setup-git` | Installs `ff` as git's credential helper for the cloud host (§6.3). |
| `ff config get\|set <key> [value]` | `host`, `editor`, `browser`, `prompt` (per user, `~/.config/framefields/config.json`). |
| `ff api <path> [-X method] [-f key=value] [--input file]` | Authenticated raw request, like `gh api`. |

---

## 6. Accounts, linking and git

### 6.1 Credentials

- Stored per host in `~/.config/framefields/hosts.json` (mode 0600), or the OS keychain when
  available. Shape: `{ "framefields.dev": { "apiKey": "ff_…", "organization": "org_…" } }`.
- `FF_TOKEN` and `FF_HOST` environment variables override the file — the CI and agent sandbox path.
- Keys are Framefields API keys (`ff_…`) with scopes (`repo:read`, `repo:write`, `render:create`,
  `assets:sync`, `admin`); a command needing a missing scope fails with the scope name.

### 6.2 Linking a directory to a cloud repo

`ff repo create` and `ff clone` write the repo id into **local git config**, not into the
manifest (the manifest is portable across hosts and forks):

```
git config framefields.repo repo_87123
git config framefields.host framefields.dev
```

Fallback when unset: look up `origin`'s URL among `GET /v1/repos` and offer to link.

### 6.3 Git authentication

Artifacts git tokens are short-lived, so they are never written to disk. `ff auth setup-git`
registers `ff auth git-credential` as a credential helper scoped to the Artifacts host; on each
git operation it mints a token (`POST /v1/repos/:id/tokens`, `scope` from the operation, 1 h TTL)
and hands it to git. `ff push`/`pull`/`clone` work without setup by passing the header for that one
invocation.

---

## 7. Output contract

- `--json` prints exactly one JSON value on stdout. Field names match the cloud API (camelCase).
- Human output: tables for lists, `key: value` for views, paths for written files.
- Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Command failed (composition error, render failed, API 4xx/5xx) |
| 2 | Usage error (unknown flag, bad composition reference) |
| 3 | Not authenticated / missing scope |
| 4 | Project problem (no project found, invalid `framefields.json`, engine not installed) |
| 130 | Interrupted |

- Errors on stderr: one line `error: <message>`, then an indented `hint:` with the exact command to
  run. With `--json`, also `{ "error": { "code", "message", "hint" } }` on stdout.

Example:

```
$ ff render step-9
error: unknown composition 'step-9'
  hint: compositions in framefields.json: showcase, step-1 … step-7 (ff ls)
```

---

## 8. Cloud API

### 8.1 Used as-is

`/v1/repos` (list, create, get, patch, delete, fork, tokens, branches, compositions, bundle),
`/v1/repos/:id/assets/diff`, `/v1/repos/:id/asset-refs`, `/v1/assets/*` (diff, upload parts,
confirm, download), `/v1/renders` (list, create with `composition`, get),
`/v1/repos/:id/{issues,pulls}/*`, `/v1/api-keys`, `/v1/organization`.

### 8.2 Gaps to add in Framefields Cloud

| Need | Proposed endpoint |
|---|---|
| `ff render cancel` | `POST /v1/renders/:id/cancel` |
| `ff render --wait` without polling | `GET /v1/renders/:id/events` (SSE) — polling `GET /v1/renders/:id` is the v1 fallback |
| Link by remote URL | `GET /v1/repos?remote=<url>` |
| Real compositions/bundles | The cloud's `readRepoFiles` currently returns starter files; it needs tree/blob reads from Artifacts at a ref. |
| Render download | `GET /v1/renders/:id/download` (302 to a signed URL) |

---

## 9. Migrating the examples

Each example gains a `framefields.json`; its `render.ts` becomes optional (keep it only for
project-specific steps such as asset generation).

- `19`, `21`, `22`, `23`: no manifest needed (default `film`). Add one only to set a title.
  `19`'s `render-track.ts` and `22`'s `precomp.ts` stay scripts — they aren't compositions.
- `24_audio_capabilities`:

```json
{
  "$schema": "https://framefields.dev/schemas/project.v1.json",
  "version": 1,
  "compositions": {
    "showcase": { "entry": "src/audio-pipeline.ts", "export": "buildAudioShowcase", "title": "Audio showcase", "default": true },
    "step-1": { "entry": "src/audio-pipeline.ts", "export": "buildStep1InitialAudio", "title": "Initial audio", "group": "Steps" },
    "step-2": { "entry": "src/audio-pipeline.ts", "export": "buildStep2FadedAudio", "title": "Fade in/out", "group": "Steps" },
    "step-3": { "entry": "src/audio-pipeline.ts", "export": "buildStep3FadedReverbAudio", "title": "Fade + reverb", "group": "Steps" },
    "step-4": { "entry": "src/audio-pipeline.ts", "export": "buildStep4DelayAudio", "title": "Delay", "group": "Steps" },
    "step-5": { "entry": "src/audio-pipeline.ts", "export": "buildStep5ParametricEqAudio", "title": "Parametric EQ", "group": "Steps" },
    "step-6": { "entry": "src/audio-pipeline.ts", "export": "buildStep6CompressorAudio", "title": "Compressor", "group": "Steps" },
    "step-7": { "entry": "src/audio-pipeline.ts", "export": "buildStep7StereoPanningAudio", "title": "Stereo panning", "group": "Steps" }
  }
}
```

  `pnpm preview 3` becomes `ff preview step-3`.

- Scenes (`scenes/*.ts`) are not compositions and should not be listed. A later manifest version
  may add `chapters` (named frame ranges) so scenes appear as timeline markers in players.

The agent plugin (`plugins/framefields`) updates its `framefields` and `framefields-render`
skills to use `ff check` / `ff frames` / `ff grid` / `ff render --local` for the verification
ladder instead of inline scripts.

---

## 10. Milestones

| # | Scope | Done when |
|---|---|---|
| M1 | `framefields/project` (schema, `loadProject`, `resolveComposition`, `buildComposition`), JSON Schema generation, `startPreview({ project, composition })` | Unit tests cover §3.1 rules; `24_audio_capabilities` has a manifest. |
| M2 | `ff` local: `ls`, `check`, `preview`, `frames`, `grid`, `render --local`, `init` | All five examples work via `ff` with no `render.ts` changes; golden tests for output and exit codes. |
| M3 | Auth + repos + sync: `auth *`, `repo *`, `clone`, `push`, `pull`, `asset *`, credential helper | E2E against `wrangler dev --env dev`: create → push with assets → clone elsewhere → assets restored, hashes verified. |
| M4 | Cloud renders + issues/PRs: `render` (cloud), `render status/list/download`, `issue *`, `pr *`, `api` | E2E: dispatch by composition id; PR create → merge with git push. |
| M5 | Cloud gaps from §8.2; plugin skills switched to `ff` | Agents complete the verification ladder and a cloud render using only `ff`. |

Testing: commands are thin over a core that takes `(args, io, env)`, so unit tests run without a
terminal; the cloud client is tested against the real worker via `wrangler dev`; local render
commands run on the existing headless renderer in CI.

## 11. Open questions

1. **Command name.** `ff` is short but collides with some shell aliases (e.g. fast-forward git
   aliases). Ship `framefields` as an alias binary.
2. **Ad-hoc refs in the cloud.** Should `POST /v1/renders` accept `file#export` for unlisted
   builders, or require manifest ids (keeps the cloud's view of a repo authoritative)? Draft: ids
   or explicit entry/export, no `#` parsing server-side.
3. **Per-composition render defaults** (fps, quality, poster frame) in the manifest — useful, but
   only once a real need appears; computed metadata must stay out.
4. **Monorepos.** One `framefields.json` per package, found by walking up from `-C`/cwd; the cloud
   assumes the manifest at the repo root for now.
