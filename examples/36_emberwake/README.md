# Emberwake: a cinematic fantasy trailer

An original fantasy trailer rendered on framefields' native WebGPU 3D engine: a dragon-corpse mountain, a necromancer's choir of the dead, a human knight, a dwarf in a war-mech, an elf with a secret, a bone dragon, the Ember-Mother waking, and a squirrel assassin.

1920 × 1080 at 24 fps, letterboxed to 2.39:1, 2:04 (a 1:59 trailer plus a 5-second stinger), 32 shots.

- [STORY.md](STORY.md): the world, the factions and their secrets, the synopsis and the tone.
- [CHARACTERS.md](CHARACTERS.md): every character's look, personality, voice, secret, trailer role and build notes.
- [SCRIPT.md](SCRIPT.md): the shot-by-shot script with frame ranges, dialogue and VO, music and SFX cues, and the engine features each shot uses.

Everything here is original. The world takes its tone from big party RPGs, war MMO cinematics and grim monster-hunter sagas, but uses none of their characters, places or names.

## Status

Pre-production: story, characters and script. The package, assets and render code come next.

## Planned layout

Each act is a scene module, with shared rigs and set pieces, following example 35's `Episode` pattern:

```
src/
  theme.ts          format, palette, fonts, frame ranges from SCRIPT.md
  timing.ts         every shot's in/out frame and beat cue, placed on the music's measured beats
  rigs/             Aldric, Brunna + Old Grudge, Ithrael, Whisk, Saevra, Kesh, Vharra
  sets/             the Spine terrain, Lanternhold, Anvilmouth, the Amberwood, Hollowmere
  acts/             cold-open, world, rising, company, waking, title, stinger
  generate-audio.ts VO (gemini-3.8-flash-tts) with scribe-v2 timestamps
  generate-music.ts lyria-3.5 instrumental, tempo and drop measured
  generate-sfx.ts   deterministic local SFX
  render.ts         render <frames|grid|video> [act|film]
```
