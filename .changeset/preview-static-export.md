---
"framefields": minor
---

Preview: `exportPreview(source, { outDir, basePath })` writes the live preview as a static site that any host can serve under a path, with no server: the page, the composition's code, the browser engine, the project files it loads and the soundtrack. Several compositions can share one export. The browser engine is now built as `.js` modules, which every static host serves as JavaScript.

`startPreview`'s `open` also takes a function, to open the page in a browser of the project's choosing.
