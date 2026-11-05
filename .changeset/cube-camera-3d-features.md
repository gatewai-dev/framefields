---
"framefields": patch
---

Cube cameras draw volumetric fog on every face. Combining a cube camera with motion blur or screen-space reflections and GI, which need one perspective view, throws a clear error, and `comp.lint()` reports `camera_cube_motion_blur` and `camera_cube_screen_space` (as it does `camera_cube_dof`).
