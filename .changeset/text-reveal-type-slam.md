---
"framefields": patch
---

TextReveal `type` no longer shows the whole text from the first frame when `emphasis` (or any other glyph animator) is set. The compositor dropped a text layer's `text` count track whenever the layer also had glyph animators. The two now compose, because animators index the full string. `type` also no longer reflows: each glyph switches on at its keystroke inside the full layout, so centred and wrapped lines stay put as they type, and the backspace exit removes the last glyph first.

TextReveal `slam` words are no longer cut off at the text's box while they land from 2.4×. A component's root and stage boxes no longer clip, since a component's box is its footprint, not a clip. Only the `mask-*` enter and exit presets still cut to it. This also restores the full drop shadow under CodeBlock and AppFrame windows, which used to show as grey triangles at the bottom corners.

LowerThird's `tag` layout scales its one-line pill down to fit the safe area, instead of running past it.

Breaking for anyone who used it: TextReveal's `track` style (enter and exit) is removed. TitleCard's kicker now enters with `rise`.
