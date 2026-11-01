---
"framefields": patch
---

Text, shapes, images and SVGs stay sharp when an ancestor scales them up. A 2D leaf now rasterizes at its scale on the canvas (up to 4×) instead of magnifying a layout-size texture, so a camera push or a card at `scale: 2` keeps crisp glyphs, round dots and clean borders. Text shadows, masks, motion blur, `LayerStyle` and Gaussian/box `Blur` scale with the layer; a leaf whose effect doesn't declare how far it scales keeps its layout-size raster, as do 3D and deflickered leaves. Layers at scale 1 or below render exactly as before.
