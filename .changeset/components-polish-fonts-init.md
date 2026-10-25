---
"framefields": minor
---

Start projects with `framefields init`, install fonts with components, and polish the component toolkit.

- `npx framefields init [dir]` writes a working project: `package.json` (ES module, scripts, dependencies, `packageManager`, and install-script approvals that let only skia-canvas run its script), `tsconfig.json`, `src/theme.ts` / `film.ts` / `render.ts`, `assets/`, an LFS `.gitattributes`, `.gitignore` and `README.md`. It also installs Inter and JetBrains Mono and runs `git init`. It never overwrites: in an existing project, files only gain what they lack. Options: `--pm`, `--install`, `--emoji`, `--no-fonts`, `--no-git`, `--name`. It asks no questions, so it runs unattended in CI. The AI gateway key is optional: `init` writes `.env.example`, git-ignores `.env`, and the generated `render.ts` loads `.env` when it exists.
- Fonts come with the components that need them. `framefields add chat-thread` / `captions` installs Noto Color Emoji, and `terminal` / `code-block` install JetBrains Mono. Each font is pinned by size and SHA-256, saved with its OFL license, recorded in `framefields.json` and registered in a generated `fonts.ts` (`await registerFonts()`). `framefields fonts add <emoji|sans|mono>` and `fonts list` install fonts directly, and `--no-fonts` skips them. The package itself ships no fonts.
- `comp.lint()` reports `missing_emoji_font` when text has emoji but no emoji font is registered, and the render warning now names the fix. `FontManager.hasEmojiFont()` is new.
- Toolkit: `withDefaults({ fps, canvas, theme, seed })` and `after(node, gap)` (also on the root), a `canvas` base prop, prop typos answered with "did you mean", `partNames` on every node, a `blur` option on motion presets, and shared keyframe, color, layout and surface helpers.
- Themes gain `mode`, font weights, elevation, springs, `color.shadow` and `syntax`. LowerThird, Toasts, Callout, CardStack and ChatThread surfaces get depth (shadow, lit top edge, sheen), and sliding surfaces get motion blur. ChatThread reactions are emoji text drawn from the color emoji font.
- Fix: fonts registered from a `file://` URL whose path has spaces (or a Windows drive letter) are found again. The browser preview failed to load them.
