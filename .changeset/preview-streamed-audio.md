---
"framefields": minor
---

The preview mixes its soundtrack in the browser, around the playhead. The page runs the export's mixer (same decoders, audio effects on its GPU, signals) on 2-second blocks as it plays, each mixed from 2 s earlier so reverbs, delays and compressors are warmed up, and plays them back to back on the AudioContext clock; the rest of the film mixes in the background for the waveform and the master gain. Sources are read in byte ranges, so pinned assets stream from their bucket and the server sends no WAV. The mixing runs in a module worker (the project's bundle, loaded as one) with its own GPU device, so it never stalls the picture; the page mixes if the worker can't, and the server only if neither can. `mixAudioTracks` and `renderAudio` take a `window` (the same samples as that stretch of a full mix) and `master: false`.
