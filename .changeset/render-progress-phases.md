---
"framefields": minor
---

Clearer render progress, sized for agents' context:
- `renderVideo` logs each phase (prepare, frames, audio mix, audio encode, mux, GIF conversion) and a summary with per-phase timings. Frames log at every 10% with fps and ETA instead of every 10 frames, so an export prints about 15 lines whatever its length.
- A phase that runs long logs `Still …` lines (after 10 s, then backing off to every 5 min) naming the phase and its progress, so the audio mix or the mux after the last frame no longer looks like a hang. A failed render names the phase it stopped in.
- `onProgress` reports the new phases `prepare`, `audio-encode`, `mux`, `convert` and `done` alongside `render` and `audio`, with `elapsedMs`, and `fps`, `etaSec`, `phaseProgress` and `detail` where they apply. The audio mix reports each clip it mixes (`mixAudioTracks` takes an `onProgress` option), which also keeps the render worker's stall detector from firing on long mixes.
- The engine's logs are one short `[framefields] …` line each on stderr instead of pino JSON, about a fifth of the size. `NODE_ENV=production` keeps JSON on stdout; `FRAMEFIELDS_LOG_FORMAT=json|text` picks either. The render worker keeps JSON.
- Removes the unused `video-worker` entry from `@framefields/renderer`.
