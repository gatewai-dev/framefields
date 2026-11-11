# 42 · Style library references

One short reference composition per look in the style library (`framefields/styles`, source in `plugins/framefields/skills/framefields-styles`). Each one is built from the look's own palette and fonts, read from the library, and laid out separately for 16:9, 9:16 and 1:1. Each crop takes its size and safe area from the matching format (widescreen, vertical, square).

The rendered frames are what people see on style cards in the desktop app and the docs. They are never sent to a model.

```bash
pnpm --filter @framefields/example-42-style-library assets     # pinned fonts
pnpm --filter @framefields/example-42-style-library images     # generated photos (gateway key in the repo root .env; costs credit)
pnpm --filter @framefields/example-42-style-library render     # output/style-frames/<look>/{16x9,9x16,1x1}.png + frames.json
pnpm --filter @framefields/example-42-style-library render grid keynote
pnpm --filter @framefields/example-42-style-library test       # one reference per look
```

Where a look needs photography (Collage's archival photo), the image is generated, never filmed or animated: `src/images.ts` describes the picture and appends the look's `ai.direction` and `ai.avoid` from the library, word for word, so the reference also checks that the art direction holds up. Each image keeps two candidates; `pick` and `sha256` pin the one in use. Generated files are local-only (gitignored).

`frames.json` lists each look's hero frame and the files, sizes and SHA-256 of its crops. The API repo's publish script reads it.

A new look needs a file in `src/looks/` and an entry in `src/looks/index.ts`. The test fails until it has one.
