---
"framefields": minor
---

The preview page can be embedded and driven by an app. In a frame it talks to its parent over `postMessage` (protocol 1, types exported from `framefields/preview`): `ready` with the film's size and timing, `state` on play, pause, each seek and up to 4 times a second while playing, `build` before it reloads into a rebuilt preview and when a build or frame fails, and replies to `seek`, `seekFrame`, `play`, `pause` and `state` commands from the parent. `?embed=1` drops the page's header. The page is redesigned on framefields' palette (graphite or paper and ink, a signal-yellow playhead): a ruler that adapts to the film's length, the soundtrack as a filled waveform with the played part marked, a playhead and hover position with their times, numbered note markers, and keys for stepping (←/→ a frame, ⇧←/→ a second), Space to play and Home/End. It fits from phone width up.
