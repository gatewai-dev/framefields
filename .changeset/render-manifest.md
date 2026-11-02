---
"framefields": minor
---

Named renders in `framefields.json`: `renders.<name>` points at a module and export with its title, description and render defaults (workers, codec, quality, output). `framefields render <name> --cloud`, `framefields check <name>` (no name checks every render), `framefields renders` and `renderCloud({ render })` pick them by name, and the dashboard lists them so nobody selects files. `init` records a `film` render and its scripts use it.
