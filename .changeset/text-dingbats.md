---
"framefields": patch
---

Symbols like ✓ ✗ ★ ☆ ❯ © ™ draw from the text font instead of as emoji. Layout treated every character in U+2600–27BF, and every emoji-capable pictograph, as a color emoji, so a ✓ (which no emoji font has) drew nothing and "© 2026" got an emoji bitmap. Text now follows Unicode's emoji presentation rules: a grapheme is emoji when it defaults to emoji presentation (🚀 ✅ ⚡), carries VS16 (❤️), a skin tone or a keycap, or is a ZWJ sequence. Pictographs that default to text (❤ ✈ ☀ ✔ © ™) use the text font's glyph when it has one, and the emoji font when it doesn't. A glyph missing from the text font is taken from another registered family that has it, so a ✓ in JetBrains Mono draws from Inter instead of as a .notdef box. The `missing_emoji_font` lint uses the same rule, so it no longer flags © or ✓.

Terminal also drops a done line's leading check mark when color markup wraps it (`{green}✓{/} done`), as it already did for a bare `✓ done`. The drawn check takes its place. Until now the text ✓ drew nothing, so the second mark went unnoticed.
