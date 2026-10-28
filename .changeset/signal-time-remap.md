---
"@framefields/core": minor
"@framefields/compositions": minor
"framefields": minor
---

Drive media `timeRemap` from a signal: `{ kind: "signal", mode: "speed" | "source-time", signal }` accepts a signal instance or a named composition signal. Without frame hooks the signal is sampled up front; with hooks it is recorded live after each frame's hooks, replayed for seeks, audio, vision and the preview, and its source bounds are checked as it records.
