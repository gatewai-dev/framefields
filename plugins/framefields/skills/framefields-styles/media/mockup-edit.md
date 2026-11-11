---
id: mockup-edit
name: Mock-up → AI edit
summary: "Build the shot in the engine for exact layout, then let an image model make it real."
tags: [ai, gateway, 3d, photoreal]
credit: true
models:
  edit: seedream/5.0-pro/edit
  edit-draft: seedream/5.0-flash/edit
---

## Pipeline

For shots where the layout must be exact (a product at a set angle, people in specific places, a screen showing the user's real UI) but the result should look photographed.

1. **Mock-up**: build the shot in the engine with primitives, 3D or the user's assets: positions, camera, framing and light direction right, materials rough. Render one frame (`renderFrame`) at the shot's size.
2. **Estimate, then ask**: price the edits with `estimate_generation_cost` and tell the user before running them.
3. **Edit**: send the frame as the reference image (`image_urls`) to the edit model with a prompt that says what each mock-up element becomes ("the gray box becomes a walnut speaker; the two capsules become two people talking"), then the look's art direction word for word. Draft first, then the final.
4. **Use it as a still**: the edited image goes back into the composition as a `Layer.image`; the engine moves it (push, pan, parallax from a cutout) and draws type over it.

## Cost

One edit per shot; drafts first. No video.

## Consistency

Keep the mock-up's camera and light identical across shots of the same scene, and reuse the first approved edit as a second reference image for the rest.

## Verify

Overlay the edit on the mock-up (difference blend) to check that nothing moved that must stay put: the product's silhouette, a screen's contents, where people stand.

## Build it with

`Layer3D`, `Layer.model`, `Layer.image`, and `ai.subscribe` from `framefields` with a gateway key.
