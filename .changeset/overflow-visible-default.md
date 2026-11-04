---
"@framefields/compositions": minor
"@framefields/node-compositor": minor
"framefields": minor
---

Containers no longer clip their children by default: `overflow` defaults to `"visible"`, as in CSS, so tilted badges, outside strokes and shaking titles are not cut at a parent's edge. Set `overflow: "hidden"` where children must stay inside a box, such as a rounded card holding a square header or image. Text layers also make room for their own outside stroke and shadows, which used to be cut at the text box, and scale or rotate around their anchor within that room.
