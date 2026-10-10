# `ff` roadmap

Status: **Draft** · Date: 2026-10-10 · Companion: `framefields-cloud/docs/ROADMAP.md`

## Direction

The cloud is moving to GitHub-hosted repositories with media in Git LFS (see the cloud roadmap).
That splits `ff` in two:

- **The local half is the product, and it stays.** `ls`, `check`, `frames`, `grid`, `preview`, `render --local` and `init` are the verification ladder agents and humans use on every change. They don't touch the cloud, and they're open source.
- **The cloud half shrinks to what Framefields uniquely does:** cloud renders and preview links. Git, auth for git, assets, issues and PRs belong to `git`, `git lfs` and `gh`.

Nothing in the cloud flow may *require* `ff`. A user with only `git` and a browser must be able to
connect, push, get PR previews and render. `ff` makes it faster, and makes it scriptable for agents.

| Command | Fate |
|---|---|
| `ls`, `check`, `frames`, `grid`, `preview`, `render --local`, `config` | Keep |
| `init` | Keep; also writes `.gitattributes` for LFS (phase 2) |
| `auth login/status/logout` | Keep (API key); add browser login (phase 1) |
| `auth setup-git`, hidden `git-credential` | **Remove** (GitHub credentials do this) |
| `repo create`, `repo fork`, `repo delete` | **Remove** → `repo connect` / `repo disconnect` |
| `repo view`, `repo list` | Keep, re-pointed at connected repos |
| `clone` | **Remove** (`git clone` + `git lfs` do it) |
| `push`, `pull` (`sync.ts`) | **Remove** (plain `git`) |
| `asset sync/pull/status`, `assets.ts`, `framefields.assets.json` | **Remove**; replaced by `lfs` checks (phase 2) |
| `issue *`, `pr *` | **Remove** (`gh`) |
| `render` (cloud), `render status/list/download/cancel` | Keep and extend |
| `api` | Keep |

Roughly 2,000 of the CLI's ~5,100 source lines go away (`issue.ts`, `pr.ts`, `sync.ts`,
`clone.ts`, `assets.ts`, `asset.ts`, most of `repo.ts`, the credential parts of `auth.ts` and
`git/index.ts`), with the matching parts of `test/cloud.test.ts` and `SPEC.md` §cloud.

---

## Phase 1 — Align with GitHub-hosted repos (ships with cloud phase 1)

- [ ] `ff repo connect`: resolve the GitHub remote of the current directory; if the App isn't installed on it, open the install/connect page and wait for it to finish; then write `git config framefields.repo`. `--json` and non-TTY paths print the URL to open instead of prompting.
- [ ] `ff repo disconnect`, and `ff repo view`/`list` against the new repo shape (GitHub full name, default branch, last push).
- [ ] `ff auth login` without `--with-token` opens a browser device-code flow (sign in with GitHub on the web, the CLI receives an API key). `FF_TOKEN` stays the CI/agent path.
- [ ] Remove `auth setup-git`, `git-credential`, `repo create/fork/delete`, `clone`, `push`, `pull`, `issue`, `pr`. In this release they print a one-line pointer ("use `git push`", "use `gh pr create`") and exit 2; delete them one release later.
- [ ] `render` (cloud) checks the commit is on GitHub (`git ls-remote`) instead of on the Framefields remote.
- [ ] Bump to 3.0.0: it's a breaking change for anyone scripting the cloud commands.

## Phase 2 — Assets through Git LFS (ships with cloud phase 2)

- [ ] `ff init` writes `.gitattributes` with LFS rules for the manifest's `assets.directory` and common media extensions (`*.mp4 *.mov *.wav *.mp3 *.png *.jpg *.exr *.ttf *.otf *.glb *.onnx`), and warns if `git lfs` isn't installed.
- [ ] `ff check` adds an **assets** step:
  - media files over a size threshold that aren't LFS-tracked → error, with the `git lfs track`/`git lfs migrate` command to run;
  - LFS objects referenced at `HEAD` but missing locally (not pulled) → error naming `git lfs pull`.
- [ ] `ff lfs setup` for existing projects: write the rules, and print (not run) the `git lfs migrate import` command, since rewriting history is the user's call.
- [ ] Remove `asset *`, `assets.ts` and every read/write of `framefields.assets.json`. Local rendering already reads files from disk, so nothing in the engine changes.

## Phase 3 — Cloud rendering (ships with cloud phase 3)

- [ ] `ff render --cloud` options matching the plans: `--resolution 4k`, `--fps`, `--format mp4|prores|webm-alpha`, `--chunks auto`.
- [ ] Clear errors for plan limits (exit 3 with the upgrade URL as the hint) and for compositions that fail on the server ("passes `ff check` locally?" hint).
- [ ] `ff render --wait` streams the server's progress events (already in the API) to a progress bar on stderr.
- [ ] Parity test in CI: one example rendered locally and in the cloud must match frame hashes (or a PSNR threshold for encoded output).

## Phase 4 — Preview links (ships with cloud phase 4)

- [ ] `ff open [<composition>]`: open the share page for the current branch's latest preview render; `--json` prints the URL. Agents use it to hand a human a link.
- [ ] `ff previews` (or `render list --previews`): preview renders for the current branch/PR with their check status.
- [ ] Engine-side: add an optional `previews` section to `framefields.json` (which compositions and quality to render on push/PR). The format lives in `framefields/project` (SPEC §3.4) so `ff`, the cloud and the engine agree; `ff check` validates it.

## Phase 5 — Agent-native (any time after phase 1; local parts can start now)

- [ ] `ff mcp`: an MCP server over stdio exposing `ls`, `check`, `frames`, `grid`, `render` (local and cloud), `open`. Frames and grids come back as images, so an agent can *see* its change and iterate. This is the differentiator in the pitch, and the local half needs no cloud at all.
- [ ] Ship a `framefields-render` skill/instructions file that teaches agents the verification ladder through `ff`, replacing per-project `render.ts` notes.

## Not planned

- Re-implementing `gh` (issues, PRs, reviews) or git transport. If a cloud feature needs a git operation, `ff` shells out to `git`.
- Any asset storage protocol of our own. If Framefields-hosted LFS ships (cloud phase 6), it's a standard LFS endpoint configured in `.lfsconfig`; `ff` only helps write that file.

## Related cleanup spotted while planning
- [x] `packages/webgpu-renderers/src/slug/slug-font-cache.ts`: removed hardcoded machine-specific font paths in favor of resolving against project font directories and upward traversal.
