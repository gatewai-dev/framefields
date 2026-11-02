---
"framefields": patch
---

Audio effects start every mix from silence. Effect state on the GPU (delay lines, reverb tails, envelopes) was keyed by render id and carried into the next mix that reused one, so mixing again under the same id (the preview, block by block) heard the previous mix's echoes: a ping-pong delay was off by up to 0.43. `mixAudioTracks` now resets it first (`WebGPUAudioProcessor.resetState`, which keeps compiled pipelines), `renderAudio` frees each mix's state, and the video export's cleanup, which passed no device and so freed nothing, now releases it.
