---
"framefields": minor
---

The framefields library: `framefields library [words]` searches curated items on framefields.dev (SFX and HDRIs so far; components stay with `framefields list`) by kind, tags, length, tempo, loop and license, and `framefields add <kind>/<name>` installs them: code is copied in as before, media is pinned by sha256 in `framefields.json`, downloaded verified to `assets/library/` and gitignored, with a module that exports its path and measured duration, onset, beats and tempo. `framefields/library` exports the registry format and search. `framefields add` now resolves items lazily and refuses registry items whose paths would leave the project.
