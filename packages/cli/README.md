# @framefields/cli

`ff`: the command line for [framefields](https://www.npmjs.com/package/framefields) projects. It previews, inspects and renders a project's compositions with the `framefields` installed in the project, and works with Framefields Cloud (repositories, asset sync, cloud renders, issues and pull requests) with `gh`-style commands.

```bash
npm install --save-dev @framefields/cli
npx ff ls
```

Design and rationale: [SPEC.md](./SPEC.md).

## The project manifest

`framefields.json` names the compositions. Without one, a project with `src/film.ts` exporting `buildFilm` has a single composition, `film`.

```json
{
	"$schema": "https://framefields.dev/schemas/project.v1.json",
	"version": 1,
	"compositions": {
		"showcase": { "entry": "src/audio.ts", "export": "buildShowcase", "default": true },
		"step-1": { "entry": "src/audio.ts", "export": "buildStep1", "group": "Steps" }
	}
}
```

Wherever a command takes `<composition>`: omit it for the default, pass an id (`step-1`), or point at an unlisted builder with `src/probe.ts#buildProbe` (local commands only).

## Local: the verification ladder

| Command | Writes |
|---|---|
| `ff ls` | Lists compositions |
| `ff check [<composition>…]` | `tsc --noEmit`, then builds each composition and validates its spec |
| `ff frames [<composition>] <frame…>` | `output/frames/<id>/f0060.png`; frames or timecodes (`60`, `2.5s`, `1500ms`, `00:02:15`) |
| `ff grid [<composition>]` | `output/<id>-grid.png` (`--count`, `--columns`, `--cell-width`, `--from`, `--to`) |
| `ff preview [<composition>]` | Live player URL; the page switches between the manifest's compositions |
| `ff render [<composition>] --local` | `output/<id>.mp4` (`--quality`, `--fps`, `--range ..5s`) |

## Cloud

```bash
echo $FF_KEY | ff auth login --with-token   # or set FF_TOKEN (and FF_HOST) in CI
ff repo create --push                        # create, add origin, link, push with assets
ff clone my-film                             # git clone + verified asset download
ff push / ff pull                            # git plus framefields.assets.json
ff asset sync | pull | status
ff render step-1 --wait --download           # render HEAD (must be pushed) in the cloud
ff issue create --title "…" / ff pr create / ff pr merge 12
ff api /v1/repos
```

## Output contract

- `--json` prints exactly one JSON value on stdout; progress and logs (the engine's included) go to stderr.
- No prompts without a terminal or with `--yes`; a missing value is an error naming the flag to pass.
- Errors: `error: <message>` and `  hint: <command>` on stderr (plus `{ "error": { code, message, hint } }` with `--json`).
- Exit codes: `0` ok, `1` failed, `2` usage, `3` not authenticated or missing scope, `4` project problem, `130` interrupted.

## Files

- Credentials: `~/.config/framefields/hosts.json` (mode 0600). `FF_TOKEN` and `FF_HOST` override it.
- Settings (`ff config`): `~/.config/framefields/config.json`.
- A directory's cloud repository: `git config framefields.repo` and `framefields.host` (never the manifest).
