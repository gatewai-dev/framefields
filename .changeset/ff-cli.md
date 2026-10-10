---
"framefields": minor
"@framefields/cli": minor
---

Add `framefields.json`, the project manifest, and `ff`, the command line.

- `framefields/project`: `loadProject`, `resolveComposition` and `buildComposition` read a project's compositions from `framefields.json` (or the implicit `src/film.ts#buildFilm`); the JSON Schema ships as `framefields/schemas/project.v1.json`.
- `startPreview({ project, composition })` previews a project's composition, and the page switches between its compositions.
- `@framefields/cli` (`ff`): `ls`, `check`, `frames`, `grid`, `preview`, `render --local` and `init` locally; `auth`, `repo`, `clone`, `push`, `pull`, `asset`, cloud `render`, `issue`, `pr` and `api` for Framefields Cloud.
