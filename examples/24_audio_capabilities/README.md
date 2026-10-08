# Framefields Audio Capabilities Example (`24_audio_capabilities`)

Demonstrates code-first WebGPU audio DSP, multi-track mixing, and procedural sound design in Framefields:

1. **Step 1: Baseline / Initial Audio** — Unprocessed score soundtrack loaded with explicit timing (`durationFrames`, `volume`).
2. **Step 2: Faded Audio** — WebGPU compute `AudioFade` DSP shader performing smooth envelope gain modulation (2.0s linear fade-in and 2.0s s-curve fade-out).
3. **Step 3: Faded + Reverb Audio** — Multi-stage WebGPU audio DSP pipeline chaining `AudioFade` directly into `AudioReverb` (room size 0.85, wet mix 0.6, stereo damping 0.2).
4. **Step 4: Ping-Pong Delay** — WebGPU compute `AudioDelay` creating spatial bouncing stereo reflections (0.28s delay time, 45% feedback, 55% wet mix).
5. **Step 5: Parametric EQ Filter** — WebGPU compute `AudioParametricEq` biquad low-pass filter (750 Hz cutoff, Q factor 1.2).
6. **Step 6: Dynamics Compressor** — WebGPU compute `AudioCompressor` punchy dynamics control (-22 dB threshold, 6:1 ratio, 8 dB soft knee, +4 dB makeup gain).
7. **Step 7: Stereo Panning** — WebGPU compute `StereoPanning` with dynamic `Signal` modulation smoothly sweeping the soundstage from full left to full right across the clip (pan: -1.0 → +1.0).

Each stage is exported both as uncompressed **16-bit PCM WAV** audio and as high-quality **MP4 video** with synchronized audio.

---

## Quick Start

```bash
# Render all 7 audio steps (.wav) and encoded videos (.mp4)
pnpm --filter @framefields/example-24-audio-capabilities render

# Render only WAV audio files
pnpm --filter @framefields/example-24-audio-capabilities render wav

# Run automated tests
pnpm --filter @framefields/example-24-audio-capabilities test

# Typecheck
pnpm --filter @framefields/example-24-audio-capabilities typecheck
```

---

## Output Files

When running `pnpm render`, files are written to `examples/24_audio_capabilities/output/`:
- `output/step1_initial_audio.wav` & `output/step1_initial.mp4`
- `output/step2_faded_audio.wav` & `output/step2_faded.mp4`
- `output/step3_faded_reverb_audio.wav` & `output/step3_faded_reverb.mp4`
- `output/step4_delay_audio.wav` & `output/step4_delay.mp4`
- `output/step5_parametric_eq_audio.wav` & `output/step5_parametric_eq.mp4`
- `output/step6_compressor_audio.wav` & `output/step6_compressor.mp4`
- `output/step7_stereo_pan_audio.wav` & `output/step7_stereo_pan.mp4`

---

## Code Example

```ts
import { Composition, Layer, Effect } from "framefields";

const comp = new Composition({ width: 1280, height: 720, fps: 30, durationMs: 6000 });

// Add audio soundtrack with chained WebGPU DSP effects
comp.addAudio(
  Layer.audio("assets/score.mp3", { durationFrames: 180, volume: 1.0 })
    .apply(Effect.audioFade({ fadeInDuration: 2.0, fadeOutDuration: 2.0 }))
    .apply(Effect.audioReverb({ roomSize: 0.85, damping: 0.2, wet: 0.6, dry: 0.7 }))
    .apply(Effect.audioDelay({ delayTime: 0.28, feedback: 0.45, pingPong: true }))
);

// Render video with audio
await comp.renderVideo("output/video.mp4");
```
