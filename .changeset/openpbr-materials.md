---
"framefields": patch
---

Materials from other tools. `openPBR({ base_color, coat_weight, specular_roughness, … })` maps OpenPBR Surface 1.1 parameters, as MaterialX and DCC tools name them, onto framefields' surface props; spread the result into any `Layer3D` builder or model. `standardSurface({ … })` does the same for Autodesk Standard Surface. `parseMtlx(xml, { baseDir })` reads the `open_pbr_surface` and `standard_surface` materials of a `.mtlx` document, takes a base color map as the mesh's texture, and lists every input it does not apply.
