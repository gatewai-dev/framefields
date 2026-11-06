---
"framefields": minor
---

`comp.vision(clip, { matting: true })` resolves the subject's edge to soft alpha with ViTMatte Small, so cutouts keep hair, motion blur and see-through parts that a hard mask cuts off. It refines the automatic subject or the `sam2` / `sam3` tracks: one model pass per frame over an unknown band either side of the mask's edge (`band`, default about 1.2% of the short side), with each prompted track keeping its own alpha. Matte layers, `signals` masks and the clip's subject read the soft alpha. Mattes persist beside the masks, so toggling matting never re-runs SAM. The 104 MB model downloads on first use. `VisionRunner.refineMatte(image, mask)` exposes the same pass.
