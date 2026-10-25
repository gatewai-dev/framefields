---
"framefields": patch
---

- ChatThread lasts until a reaction on the last message has popped. Its natural length ended 0.8 s after the last bubble, but a reaction pops 0.6 s after its bubble and springs for longer, so with an `exit` or a fitted clip the pop was cut off and the reaction never showed.
- Fonts registered in the browser (the live preview, the docs lab) no longer warn `[registerHeadlessFont] … mkdtemp is not a function`: the Node-only local copy is skipped in a page, where text draws from the registered source. Headless `file://` font paths with spaces resolve too.
