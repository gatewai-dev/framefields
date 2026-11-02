---
"framefields": patch
---

`strokeDashArray` renders. It is written as SVG writes it (`"12 8"`, `"4,8"`), but the string reached the path pipeline as if it were a list of numbers, the dash arithmetic came out NaN, and the whole stroke was dropped: dashed lines, circles and outlines drew nothing. It is now read by SVG's rules (an odd list repeats; a negative, unreadable or zero-length pattern draws solid).
