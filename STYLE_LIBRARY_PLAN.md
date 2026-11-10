# Style library plan

Today the desktop app hard-codes four "styles" (`framefields-desktop/src/main/styles.ts`). They mix things that are really separate: Motion and Vox are looks, Technical Explainer is a kind of video, and Social Vertical is a delivery format. The library splits these into separate parts that combine, so an agent can make "a Brutalist product launch, vertical, made from AI-generated clips" without anyone writing that combination down.

## The four parts

| Part | Answers | Owns | Examples |
|---|---|---|---|
| **Look** | What does it look like? | palette, type, texture, motion character, grade / effect stack, art direction for AI models | Swiss, Brutalist, Collage, Editorial, Synthwave, Claymation, Paper cut-out, Noir, Keynote |
| **Format** | Where does it play? | size, fps, duration, safe areas, cut rhythm, hook rules, loop / end card | Widescreen 16:9, Vertical 9:16, Square, Cinema 2.39, Bumper 6s, Ad 15/30s, Loop |
| **Genre** | What kind of video is it? | structure (the beats), audio plan (VO, music, lyrics), the components it relies on | Explainer, Product launch, Lyric video, Trailer, Data story, UI demo, News, Audiogram, Brand film, Music video |
| **Medium** | Where do the pixels come from? | how it's produced: tools, scripts, cost, consistency | Code-drawn, 3D, Footage (+ vision), AI-generated (gateway), Mock-up → AI edit |

A video is **one look, one format, one genre and one or more media**. Each part is a small text file. The model needs no reference image: the text is the brief.

### Precedence when parts disagree

Each part only writes in its own sections, so conflicts are rare and the rule is simple:

- **Format** wins on the frame: size, safe areas, duration, how often to cut.
- **Genre** wins on structure: the order of beats, what the audio does, what goes on screen when.
- **Look** wins on everything visual: color, type, texture, easing, grade.
- **Medium** wins on production: which tools and scripts, what it costs, how it's verified.

If a look doesn't fit a format (for example a slow, airy look in a 6-second bumper), the format keeps its timing and the look keeps its visuals, just with fewer elements. A part can list `pairsWell` and `avoid`, which the picker uses to suggest combinations and agents use as a warning, never as a block.

### AI gateway video: the look carries the art direction

This is what lets generated clips sit next to code-drawn type and still read as one film. Every look has an `ai` block:

```yaml
ai:
  direction: "flat paper cut-outs, visible paper grain, soft top light, muted ochre and teal, shallow depth"
  avoid: "photoreal skin, glossy 3D, lens flare, text in frame"
  grade: [Styles.film, { FilmGrain: { amount: 0.25 } }]   # applied over generated footage with comp.apply
  motion: "slow, stepped (2s), camera mostly locked"
```

The **AI-generated** medium file is the recipe that uses it:

1. Plan the shots from the genre's beats. Estimate cost first (`estimate_generation_cost`), and state it to the user before running anything.
2. Stills first (cheap, quick to iterate), with the look's `direction` + `avoid` attached to every prompt. Fixed seeds. One character or product sheet reused as the reference image, for consistency.
3. Turn approved stills into clips (image-to-video), using the look's `motion` words for camera and movement. The format sets each clip's length and aspect.
4. Generate once, in its own script, into `assets/generated/`, pinned with `framefields assets add`. This is the rule the `framefields` skill already has.
5. Composition: framefields does the titles, captions, transitions and audio, then applies the look's `grade` over everything with `comp.apply`. Shared grain and grade are what make generated and drawn material match.
6. Audio from the gateway as well: music (Lyria / ElevenLabs), voice (TTS), lyric timing (STT), stems. The genre says which of these it needs.

Model ids are roles in the medium file ("still", "image-to-video", "edit", "music", "voice"), each with a current pick. The pick is checked against the gateway catalog (`list_models`) by an opt-in network test, so a renamed model shows up as a failing check, not a broken session.

Other media follow the same shape. **Mock-up → AI edit**: build the shot as a 3D or code mock-up, render a 360p draft, then run a gateway video edit model over it. Use it for people shots and for exact layouts the model can't invent. **Footage**: the user's clips plus vision (mattes, tracking), graded with the look.

### Presets: named combinations

Most people won't build a combination from scratch. A preset is a name plus four references and a sentence or two of extra guidance:

```yaml
id: launch-teaser
name: Launch teaser
look: keynote
format: ad-30
genre: product-launch
media: [3d, ai-generated]
note: "End on the product name alone, held 2 seconds."
```

The four current desktop styles become presets: Motion = motion look + widescreen + brand film + code-drawn; Social Vertical = any look + vertical; and so on. Presets are where the library feels big without a lot of files: 20 looks × 8 formats × 10 genres already exist as combinations, so presets only need to name the good ones.

## Where it lives

```
plugins/framefields/skills/framefields-styles/
  SKILL.md              how to combine, precedence, generated tables of every part
  looks/<id>.md
  formats/<id>.md
  genres/<id>.md
  media/<id>.md
  presets/<id>.md
```

- **Agents (Claude Code, plugin)** read `SKILL.md`, then only the files they need. If the user names no parts, the agent picks: it infers the genre and format from the request, offers 2–3 looks, and asks only about what it can't infer.
- **Desktop app**: `framefields` exports the parsed catalog as `framefields/styles` (text only: JSON, no GPU). The desktop app depends on a pinned framefields version for it. The session stores `{ look, format, genre, media[] }`, and the system prompt closes with the four sections combined, in precedence order. This replaces `styles.ts` and the single `style` field. Frames come from the API, as described below.
- The effects skill's `style-guide.md` stays the "which effect makes this look" reference. Looks link to it rather than repeat it.

The text belongs to the engine and is versioned with it. The pictures belong to the service: they change without an engine release and can only be seen by people.

## Reference frames: in the API repo, served by a lookup endpoint

Frames are for people only. The model never sees them.

**Rendering (frameshop).** `examples/42_style_library` has one reference composition per look. It proves the look can be built with real APIs. Its render script renders each look's hero moment once, at full size, plus three crops placed by the composition itself rather than cut out of one frame: 16:9, 9:16 and 1:1, each laid out for its format with its own safe areas. Optionally it also renders a 3-second muted loop. The output goes to `output/style-frames/<look>/`, with a `frames.json` listing the files, sizes and the hero frame number. Nothing is committed; the files are local-only.

**Publishing (framefields-dev/api).**
- `scripts/publish-style-frames.ts <dir>`: encodes each frame to AVIF and WebP at two widths (480 for cards, 1600 for the large view). It also makes a 16-px blur placeholder (an inline data URI) and picks a dominant color. Each file is uploaded to `MEDIA_BUCKET` under `styles/<sha256>.<ext>`, immutable and content-addressed. It then rewrites `src/styles/frames.ts`.
- `src/styles/frames.ts`: a checked-in manifest, in the same pattern as `model-catalog.ts`. Look id → crops → `{ key, sha256, width, height }` per encoding, plus the placeholder, color, alt text and the frameshop commit it was rendered from. Reviewing a frame change is reviewing a diff.
- A test checks that every entry has every crop, that keys are content hashes, and that the alt text is not empty.

**Lookup endpoint.** `GET /v1/styles/frames?looks=motion,collage` (public, no key: these are marketing images).

```json
{
  "version": "2026-11-10.3",
  "looks": {
    "collage": {
      "alt": "Torn paper headline with a yellow highlight over a halftone photo",
      "color": "#d9ccb4",
      "placeholder": "data:image/webp;base64,…",
      "crops": {
        "16:9": { "width": 1600, "height": 900, "srcset": { "avif": ["https://cdn.framefields.dev/styles/<sha>.avif 480w", "… 1600w"], "webp": ["…"] } },
        "9:16": { "…": "…" },
        "1:1":  { "…": "…" }
      },
      "loop": { "webm": "https://cdn.framefields.dev/styles/<sha>.webm", "mp4": "…" }
    }
  }
}
```

- Without `looks`, the endpoint returns every look. `ETag` = `version`, with `Cache-Control: public, max-age=300, stale-while-revalidate=86400`. Images are cached for a year (`immutable`).
- An unknown look id is left out, not an error. A desktop app with a newer catalog than the API just falls back for that look.
- The docs gallery and the dashboard read the same endpoint.

## Desktop UX

The goal: picking a direction feels like flipping through a director's lookbook, not like filling in a form. It takes one click for most people and four clicks to make a custom mix. It never gets in the way of just typing.

**First paint is instant.**
- The app caches the endpoint's response and the card images in its data folder, checked against sha256, and refreshes them in the background with `If-None-Match`. Cards render at once from the cache. On a first run they show the placeholder and dominant color at the final size, so nothing moves when the image arrives.
- Offline with no cache: the look's palette from the catalog, drawn as a swatch card, so it still looks designed.
- The CSP gets `img-src`/`media-src` for `cdn.framefields.dev`.

**The empty session.**
- Under the greeting there's a lookbook: a row of preset cards, each showing its look's frame in its own format's crop. A vertical preset is a tall card, a square one is square, so the format shows before you read anything. The name and a line of summary sit under each card, with small marks for the genre and media.
- Hover (or focus) plays the look's loop in place, muted, and stops when you leave. With reduced motion turned on, cards stay still.
- Arrow keys move between cards, Enter picks, Esc clears. The composer keeps focus, so typing right away always works. Picking is optional.

**Picking or mixing: the slate.** A preset, once picked, becomes a slim slate above the composer with four slots: `Look · Format · Genre · Medium`.
- **Look** opens a lookbook popover: a grid of frames with tag filters (Type, Crafted, Retro, Cinematic, AI-friendly) and type-to-filter. Hovering a look previews it in the slate at once, without committing.
- **Format** shows outlines at their true shape (16:9, 9:16, 1:1, 2.39) with durations. Switching format crossfades the slate's thumbnail to the matching crop, with the safe area drawn faintly.
- **Genre** shows each genre as a strip of its beats (Hook · Problem · Reveal · CTA), so the structure is visible at a glance.
- **Medium** is multi-select. AI-generated carries a quiet "uses credit" note, and the agent estimates the cost before it generates anything.
- A soft note appears when a pair is in `avoid` ("Slow look in a 6s bumper: fewer elements, same pacing"). It's a hint, never a block. "Surprise me" picks a combination from `pairsWell`.
- Changing any slot makes the mix custom. The slate says "Custom (from Launch teaser)", and one click resets it.

**After the first message.**
- The slate collapses into the composer's quiet line ("Collage · Vertical · Explainer · AI"). Clicking it shows the mix with its frame. Changing it there takes effect from the next message on, and the change goes to the agent as a note ("The user switched the look to Swiss").
- "New session in this mix" starts fresh with the same mix. The last few mixes per project appear first in the lookbook.

**Built from the app's existing parts.** Popovers use `popover.ts`, colors and type follow the app's light and dark tokens, and there's no UI framework. The images are the only colorful thing on screen; the frame around them stays quiet.

## Acceptance

Per part:
1. It passes the schema. Every API, preset and component it names resolves to a real export or registry item (test).
2. It only writes in its own sections (the parser rejects a look that sets duration, a format that sets colors, and so on).

Per look:
3. The reference composition typechecks, passes `framefields check`, and renders headless in all three crops. The look is published in `src/styles/frames.ts`, and the lookup endpoint returns it.

Per preset:
4. **Desktop smoke run**: start a session from the preset with a fixed prompt, let the agent build it inside the desktop sandbox, and render one frame. A person checks that it reads as that look, in that format, with that structure. For presets that use the AI medium, the run uses stills only (cheap) unless clips are approved.

Catalog:
5. Generated tables and `framefields/styles` match the files (drift test, like `effects-catalog.md`).

## Status (2026-11-11)

All five phases are built; nothing is pushed or deployed.

- **Phase 1, the model** (frameshop `feat/style-library`): the `framefields-styles` skill, `framefields/styles` (`combineStyles`, `styleClashes`, `resolveStyleMix`), the drift and ownership tests, and `examples/42_style_library`. The AI-generated medium is image-first: the engine moves the stills, and video is generated only when the user asks. Along the way, shape strokes stopped being cut at the layout box (a compositor fix with a render test).
- **Phase 2, the frames service** (framefields-dev `feat/style-frames`): `scripts/publish-style-frames.mjs` encodes each frame (AVIF and WebP, at 480 and 1600 px), uploads it with wrangler to `framefields-deliverables/styles/<sha256>.<ext>`, and rewrites `api/src/styles/frames.json`. `GET /v1/styles/frames?looks=` serves srcsets, alt text, a color and a placeholder, with an ETag. Six looks are published on cdn.framefields.dev. The route goes live when the API is deployed.
- **Phase 3, the desktop app** (framefields-desktop `feat/style-library`):
  - The lookbook of presets, with each look's frame in its format's shape (palette swatches until frames arrive or while offline).
  - The slate (look, format, genre, made with) and its pickers, clash hints, Surprise me, Reset and Clear.
  - The quiet line after the first message, and the change note that reaches the agent with the next message.
  - Old style ids map to presets.
  - `framefields` is a build-time dependency, linked to this repo until a release ships `framefields/styles`; only that subpath is bundled.
- **Phase 4, AI-native** (frameshop): `examples/43_collage_explainer`, a 37-second film made only from the Collage explainer preset. It uses generated stills (no video) and ElevenLabs v4 voice, with highlights cued on spoken words. Its music is missing: the gateway's `elevenlabs/music-v2.5` returned 500 for every request, minimal ones included.
- **Phase 5, grow**: added the Swiss and Risograph looks, the Cinema and Bumper 6s formats, the Data story and UI demo genres, the Mock-up → AI edit medium (image edit only), and the Swiss data story and Zine bumper presets. The new looks have reference frames and are published.

Next: release `framefields` with `framefields/styles` and pin it in the desktop app, deploy the API, more looks (crafted, retro, cinematic), components `Theme`s from look tokens, `framefields init --preset`, and a docs gallery from the endpoint.

## Roadmap

**Phase 1: the model (this repo)**: done. The seed has 4 looks, 4 formats, 4 genres, 4 media and 5 presets (Motion, Collage explainer, Technical explainer, Social vertical, Launch teaser). The old desktop style ids map to presets: `motion` → `motion`, `vox` → `collage-explainer`, `technical` → `technical-explainer`, `social` → `social-vertical`. Along the way, shape strokes were fixed: the half outside the outline used to be cut at the layout box.
- Add the schemas and parser for the 5 kinds, the section ownership rule, the combine function (precedence order → one prompt text), the catalog export, and tests.
- Seed it: 4 looks (Motion, Collage, Blueprint, Keynote), 4 formats (Widescreen, Vertical, Square, Ad 15/30), 4 genres (Explainer, Product launch, Brand film, Lyric video), 4 media (Code-drawn, 3D, AI-generated, Footage), and the 4 current desktop styles as presets.
- Add `examples/42_style_library` with the reference compositions and a render script for the three crops (and the loop).

**Phase 2: frames service (framefields-dev/api)**
- Add the `publish-style-frames.ts` script (encode, placeholder, upload to `MEDIA_BUCKET`), the `src/styles/frames.ts` manifest and its test, and the `GET /v1/styles/frames` route with ETag and caching. Publish the 4 seed looks.

**Phase 3: desktop (framefields-desktop)**
- Switch to `framefields/styles`, add the frames client with its disk cache, then the lookbook, the slate, the collapsed line, and changing the mix mid-session. Remove `styles.ts` and `style-art.ts`. Migrate old sessions (old `style` ids map to presets).
- Smoke-run the 4 presets. Check reduced motion, keyboard-only use, offline with and without a cache, and light and dark.

**Phase 4: AI-native video**
- Build out the AI-generated medium for real: the shot plan from genre beats, a cost estimate before generation, stills → approval → clips, character and product sheets, and the look's grade over generated footage.
- Add the Mock-up → AI edit medium, and a preset that's fully AI-generated (for example "AI short film": cinematic look, cinema format, trailer genre, AI-generated).
- An example film made only from one preset, as proof that the combined text is enough.

**Phase 5: grow**
- 3–4 looks per PR (type, crafted, retro, cinematic), more genres (Trailer, Data story, UI demo, News, Audiogram, Music video), more formats (Cinema, Bumper 6s, Loop), and presets for the good combinations.
- Promote look tokens to components `Theme`s, so registry components follow the look. Add `framefields init --preset <id>`, and a docs gallery that reads the same endpoint.

## Open questions

1. Rename "Vox Animation" to "Collage" (it names a real outlet)?
2. Should desktop smoke runs that use the AI medium be allowed to generate clips (they cost money), or only stills?
3. Is media a single choice or several? The plan allows several (`[3d, ai-generated]`), since real films mix them.
4. Should loops (3-second hover video) be in the first publish, or added once the still frames are settled?
