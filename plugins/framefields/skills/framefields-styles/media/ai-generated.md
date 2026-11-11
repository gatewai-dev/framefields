---
id: ai-generated
name: AI-generated
summary: Images, music and voice made through the framefields AI gateway, matched to the look and moved by the engine.
tags: [ai, gateway, generative]
credit: true
models:
  still: seedream/5.0-pro
  still-draft: seedream/5.0-flash
  edit: seedream/5.0-pro/edit
  cutout: birefnet/v2
  upscale: seedvr/upscale/image
  music: elevenlabs/music-v2.5
  voice: elevenlabs/v4
  transcribe: elevenlabs/speech-to-text/scribe-v2
  stems: demucs
  image-to-video: seedance/2.5/image-to-video
---

## Pipeline

Images, not video: generate stills and let framefields move them. Push-ins, pans, parallax and layering are exact, cheap and editable; a generated clip is none of these.

1. **Shot list from the genre's beats**: what each shot shows, how long it holds (from the format), and which ones need a generated image (the rest stay code-drawn).
2. **Estimate, then ask**: price the list with `estimate_generation_cost` and tell the user the total before generating anything.
3. **Prompts**: describe the picture like a photographer or illustrator would (subject, setting, era, lens and framing, light, medium), then end every prompt with the look's art direction, word for word: its direction, then "avoid: …". Ask for the aspect ratio the shot needs.
4. **Drafts, then finals**: draft with the still-draft model, two or three candidates per shot; show them to the user; make finals with the still model only for the approved ones.
5. **Move them in the engine**: a slow push or pan on every still, using the look's motion words. For depth, cut the subject out (cutout model) and move it against its background at a different speed.
6. **Audio**: music and voice from the gateway when the genre needs them; transcribe the voice for word timings.
7. **Composite**: framefields draws the type, captions and transitions, and applies the look's grade over everything (`comp.apply`), so generated and drawn parts share one surface.

Video generation (image-to-video) only when the user asks for real motion inside a shot, and only from an approved still.

All generation runs once, in its own script (`src/generate.ts`), into `assets/generated/`, pinned with `npx framefields assets add`; the composition reads local files and never calls the gateway.

## Cost

Every call spends credit. Drafts are cheap; finals cost more; video costs far more than either, which is one more reason to move stills in the engine.

## Consistency

One reference image (the character, product or place) generated first and passed as a reference image (`image_urls`) to every later still. The same art direction text in every prompt.

## Verify

Look at every image before it goes in; check that no text, logos or watermarks were invented, and that hands and faces hold up at the size they're shown.

## Build it with

`ai.subscribe` from `framefields` with a gateway key (`FRAMEFIELDS_API_KEY`); `Layer.video` and `Layer.image` for the results.
