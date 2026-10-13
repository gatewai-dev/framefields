# 27 — Right-to-left text

A 16-second tour of Arabic and Hebrew in framefields, in 2D and 3D: the text is shaped with the
font's OpenType tables (joining forms, ligatures, vowel marks), laid out right to left with the
Unicode Bidirectional Algorithm, and wrapped from the right.

```bash
pnpm fonts                 # Cairo, Noto Naskh Arabic, Rubik, Inter from google/fonts → assets/fonts/
pnpm render grid           # output/grid.png, a 16-frame contact sheet
pnpm render frames 140 300 400
pnpm render                # output/rtl-text.mp4
pnpm render:src grid       # same, on the engine's source (no package builds)
```

The fonts are SIL OFL faces from google/fonts. They are gitignored; `src/fetch-fonts.ts` records
where they come from.

## The scenes

| Scene | What it shows |
|---|---|
| Arabic (2D) | A mixed Arabic / English / number sentence in Cairo: letters join, `لا` forms the lam-alef ligature, the shadda sits on its letter, and "AI" and "2026" read left to right inside the right-to-left line. Words pop in reading order, so the reveal starts at the right. Below it, a fully vowelled proverb in Noto Naskh Arabic is typed out; each letter changes form as the next one arrives. |
| Hebrew (2D) | A Rubik headline rising letter by letter from the right; a paragraph that mixes Hebrew, English and a number, set with `direction: "rtl"` and `align: "start"` (the right edge); and Hebrew along a curve with `pathOptions`. |
| 3D | Solid `Layer3D.text` with `extrusionDepth`: the words are shaped exactly like 2D text and then extruded, so Arabic joins in 3D too. Flat `Layer3D.text` captions sit on planes in the same space, centred with `FontManager.measure`. |

## Direction and alignment

Text layers take `direction: "auto" | "ltr" | "rtl"`. The default, `"auto"`, takes each
paragraph's direction from its first strong character, so Arabic and Hebrew need nothing set.
`align: "start"` and `"end"` follow the direction: for right-to-left text, `start` is the right
edge.

The Hebrew paragraph sets `direction: "rtl"` because it opens with the Latin word "framefields":
with `"auto"` the whole paragraph would read left to right, as it would in a browser with
`dir="auto"`.
