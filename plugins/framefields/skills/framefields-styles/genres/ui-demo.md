---
id: ui-demo
name: UI demo
summary: A product walkthrough on screen; a pointer does the task, zooms show what matters.
tags: [software, product, tutorial]
beats: [Problem, Open, Do, Result, Next]
audio: [voice, music, sound]
pairsWell: [look/keynote, look/swiss, format/widescreen, medium/code-drawn]
---

## Beats

1. **Problem**: the task the viewer has, in one line.
2. **Open**: the app in its window, at rest.
3. **Do**: the pointer performs the task in real steps, each step a beat; zoom in on the control being used.
4. **Result**: what the task produced, held long enough to see.
5. **Next**: where to get it, or the next thing it can do.

## Audio

A voice explains each step as it happens; soft clicks and whooshes on interactions; music low.

## On screen

The real UI (a screenshot or the user's own build, framed), never a fake one when the real one exists. One action at a time; the pointer moves in natural curves and pauses before clicking. Zoom with `focus-zoom` rather than cutting.

## Build it with

`components/app-frame` or `components/device-frame` for the window, `components/mouse-pointer` and `components/touch-point` for input, `components/focus-zoom` and `components/callout` for detail, `components/toasts` for feedback.
