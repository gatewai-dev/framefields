---
"framefields": minor
---

The `framefields preview` page is rebuilt as typed Lit elements, shipped prebuilt in `dist/preview-page` (Lit stays inside the page; nothing new reaches a project's imports). It seeks in place when its address fragment changes (`#t=12.5`, `#frame=750`), pausing first, and when embedded in a frame it posts `{ type: "framefields-preview:ready", seekByHash: true }` to its parent once the first frame shows, so an app can seek it without a reload. When the server reports the soundtrack itself (or none, with `audio: false`), the page no longer mixes it too.
