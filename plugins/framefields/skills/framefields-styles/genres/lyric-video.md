---
id: lyric-video
name: Lyric video
summary: The song's words, timed to the syllable, as the picture.
tags: [music, typography, sync]
beats: [Intro, Verse, Chorus, Bridge, Outro]
audio: [lyrics, music]
pairsWell: [look/motion, format/vertical]
clashes: [look/blueprint]
---

## Beats

Follow the song's own sections: intro, verses, choruses, bridge, outro. Each section gets its own treatment (layout, color or motion), and every chorus returns to the same one, so the structure is visible.

## Audio

The song is the clock. Get word timings by transcribing the vocal stem (separate stems first, then speech-to-text on the vocals), check them by ear, and drive every word from them. Never place lyrics by hand-timed guesses.

## On screen

Every sung word appears as it's sung and leaves when the line ends; the current word is emphasized. Lines break where the singer breathes. Big hits (drums, drops) move the whole frame.

## Build it with

`TextAnimator.wordPop` driven by word timings; `AudioSignal` beat and energy for the frame; `components/captions` for a simpler karaoke line.
