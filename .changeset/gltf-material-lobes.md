---
"framefields": minor
---

glTF models render their own layered materials: `KHR_materials_clearcoat`, `_sheen`, `_anisotropy` and `_iridescence` (and `subsurface`, in the material's `extras.framefields.subsurface`) feed the matching shading lobes, under any lobe props set on the layer.

Subsurface scattering now conserves energy: each color channel's light wraps past the shadow edge by how far that channel scatters, instead of a near-white glow being added over the surface and an ambient tint across it. Skin keeps its form and only its shadow edges warm; previous `subsurface` looks render less washed out.
