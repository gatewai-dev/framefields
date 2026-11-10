# 43 · Collage explainer

"The city that moved its river": a 37-second explainer made from one preset of the style library and nothing else. `src/direction.ts` takes the Collage explainer preset (Collage look, Widescreen format, Explainer genre, Code-drawn + AI-generated media). The palette, fonts, frame and art direction come from there, and the six scenes follow the genre's five beats. `pnpm brief` prints the combined brief, exactly as an agent receives it in the desktop app or from `combineStyles`.

The story is invented and the film says so. Its pictures are generated stills (Seedream 5.0 Pro through the framefields AI gateway), black-and-white press photographs, from prompts that end with the look's art direction word for word. Nothing is generated as video: the engine moves the stills (pushes, paper landing, highlighter, pen marks). The narration is ElevenLabs v4. Its per-character timings place every highlight and mark on the spoken word, with no separate transcription.

```bash
pnpm --filter @framefields/example-43-collage-explainer assets     # pinned fonts
pnpm --filter @framefields/example-43-collage-explainer generate   # stills, voice, music (gateway key in the repo root .env; about $0.55)
pnpm --filter @framefields/example-43-collage-explainer render     # output/collage-explainer.mp4
pnpm --filter @framefields/example-43-collage-explainer render grid
pnpm --filter @framefields/example-43-collage-explainer test
```

Each still keeps two candidates. `src/assets.ts` pins the one in use (`pick`, `sha256`) and says why it was picked. Music is optional: the film plays the voice alone when there's no `assets/music.mp3`. Generated files are local-only (gitignored).
