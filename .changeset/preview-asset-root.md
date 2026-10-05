---
"gitframes": patch
---

The preview now serves assets from the project that holds the entry (its nearest `.git`, else `package.json`), not just the entry's own directory. A project with no `.git`, where fonts and media live in a sibling `assets/` folder, previously failed to load them. `root` also accepts several paths now, for assets kept outside the project.
