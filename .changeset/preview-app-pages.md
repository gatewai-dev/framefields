---
"framefields": minor
---

`startPreview({ ... }, { page })` serves an HTML page of your own around the player instead of the preview UI: an app such as a simulator, which loads `/@framefields/player.js` and draws frames with `window.framefieldsPlayer` from its own loop. The browser engine now ships MuJoCo's WebAssembly, so `Physics.mujoco` worlds (live ones included) run in the preview and in such pages.
