---
"framefields": minor
---

`framefields render <name>` renders a named render on this machine and `framefields preview <name>` plays it in the browser, reading the same `framefields.json` render as `--cloud`, so a render writes the same file wherever it runs. Both load the module with the project's own tsx and framefields. A local render first downloads pinned assets that are missing; the preview streams them from their bucket instead (redirecting the page to the remote's `publicUrl` or a signed URL, and mixing the soundtrack over HTTP), so an agent in a cloud sandbox previews footage without downloading it. `init`'s `render` and `preview` scripts now call the CLI.
