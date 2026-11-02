# 33 — News Explainer

A two-minute explainer, in the paper-collage style of video explainer journalism, about the
Learjet 60 that came down in Palm Beach County, Florida, on November 1, 2026: what is known
as of November 2. Paper on a desk, torn strips, tape, stamps, a hand that highlights and circles,
a map of the flight, a cross-section of the storm, a chart of the fall, a street plan and a case
file. Everything is shapes and type; there is no footage.

Watch it: [youtu.be/tR_j_twU4p4](https://youtu.be/tR_j_twU4p4)

The narration is Gemini 3.8 Flash TTS (voice Charon) and the bed is Lyria 3.5, both through the
framefields AI gateway. Each line is generated on its own, checked against the script by Scribe
(word for word, numbers spelled out on both sides by `spoken.ts`), trimmed to its speech and
loudness-normalized; its word timings are kept in `assets/audio.json`. The timeline lays the lines
out scene by scene from their measured lengths, and scenes cue pictures off the words heard
(`wordIn(scene, "warned", "icing")`), so a retaken line re-times what follows it.

```bash
pnpm assets               # fonts from google/fonts, pinned by commit and SHA-256
pnpm audio cost           # estimate (about $0.30)
pnpm audio                # voice and music; needs FRAMEFIELDS_API_KEY in the repo's .env
pnpm render grid          # output/grid.png
pnpm render frames 800 1900
pnpm render               # output/explainer.mp4
pnpm render:src           # same, on the engine's source (no package builds)
pnpm test
```

| Scene | Narration | On screen |
| --- | --- | --- |
| open | The crash; nine aboard | Dateline card, headline marked on "South Florida", nine figures, a Florida scrap |
| title | What do we know? | WHAT WE KNOW on a torn yellow strip, an "as of" stamp |
| route | The jet, the flight | Natural Earth / Census map, aircraft card, the great circle flown and the leg never flown, push in on Palm Beach County |
| storm | Thunderstorm, warning, climb | Altitude cross-section, a storm grown puff by puff to 44,000 ft, the SIGMET ticked per hazard, the requested 37,000 ft |
| dive | The fall | Altitude against time through the FAA's two altitudes and the reported rates, counter, panel figures, the 35 seconds of radio |
| ground | Where it came down | Schematic plan of Military Trail, the mobile home park, the crater, the evacuation ring |
| probe | The investigation | NTSB case notes, what comes next, "cause not yet determined" |
| close | The open question | The question, sources and the date of the reporting |

The dive's curve is illustrative and says so on screen: it passes through 35,250 and 8,750 ft
about 76 seconds apart and reaches 10,000, 20,000 and then 30,000 ft per minute, as reported; the
final seconds were not published. Sources: FAA, NTSB, AP, Reuters, CBS News, ABC News,
FOX Weather and the Aviation Safety Network.

Map data: [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth 1:50m) and
[us-atlas](https://github.com/topojson/us-atlas) (US Census 1:10m), both public domain, projected
with d3-geo.
