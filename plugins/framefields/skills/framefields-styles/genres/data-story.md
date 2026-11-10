---
id: data-story
name: Data story
summary: One finding from real numbers, built up chart by chart until it's obvious.
tags: [data, charts, explainer]
beats: [Claim, Context, Build, Turn, Takeaway]
audio: [voice, music]
pairsWell: [look/swiss, look/blueprint, format/widescreen]
---

## Beats

1. **Claim**: the finding as one sentence and one big number.
2. **Context**: where the numbers come from and what normal looks like.
3. **Build**: the chart draws itself, one series or one period at a time.
4. **Turn**: the moment the data does something surprising, highlighted.
5. **Takeaway**: the claim again, now earned, with the source.

## Audio

A calm voiceover carries it, timed to the chart's build; quiet music under. Without a voice, every point is a line of on-screen text that stays long enough to read twice.

## On screen

Real data from the user (or clearly labeled as illustrative). One chart at a time, axes labeled with units, the highlighted series in the look's accent and everything else muted. The source on screen at the end.

## Build it with

`Layer.chart` with `animate`, `components/counter` for the big numbers, `components/callout` and `components/annotate` for the turn.
