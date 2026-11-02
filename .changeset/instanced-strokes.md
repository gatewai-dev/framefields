---
"framefields": patch
---

Strokes draw in one call per path. The path pipeline drew every straight piece of a stroke (and of the hairline that antialiases a solid fill) as its own draw, with two buffer uploads each, so a curve, a dashed line or a map's coastline cost thousands of native calls a frame. Each segment is now an instance of one draw: the path's transform, color, width and cap are uploaded once, its segments in one buffer, and the vertex shader builds each segment's quad. Output is unchanged; a scene of map coastlines and a hundred filled circles renders about twice as fast.
