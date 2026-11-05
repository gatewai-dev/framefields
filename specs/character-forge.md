# Character Forge: rigged characters built in code

Status: Phase 1 done (GLB writer, skeleton, humanoid preset, bone gizmo; `packages/forge`, exposed as `framefields/forge`). Phase 2 next. First character: **Ithrael Sunmourn** (`examples/36_emberwake/CHARACTERS.md`), an original hooded elven ranger with a long cloak, long hair, a sculpted face, real eyes, and a full set of expressions.

## Goal

`framefields/forge` builds production-quality, stylized characters from TypeScript and writes standard GLB files that every loader can read: a skeleton on Mixamo names, a skinned sculpted body, materials with several layers, cloth and hair chains, a face rig with eye joints and named blend shapes, and procedural clips. In a composition, the face is driven like the body: `face: { smile: Signal…, blink: auto }` next to `pose`, `aim`, `lookAt` and `springBones`.

Out of scope: photoreal humans and strand-based hair simulation. The target look is a premium stylized sculpt, like a painted miniature come to life.

## What exists and what's missing

| Area | Today | Missing |
| --- | --- | --- |
| GLB writing | `GlbBuilder` in `framefields/src/test-utils/glb.ts` | Public API, 32-bit indices, materials, skins, morph targets, animation writing |
| Sculpting | `sdf-geometry.ts`: six shapes, smooth booleans, Surface Nets at no more than 160 cells | Bone binding, ellipsoid / rounded cone / curve tube / lathe / sweep shapes, bend/twist/mirror/repeat operations, noise displacement, detail resolution, simplification to a budget |
| Skinning | Loader and renderer read skins | Generating weights |
| Morph targets | Loader and GPU morph pipeline (any count); clips animate the weights | `extras.targetNames`, per-target weights by name from a composition (`face`/`morphs`), deforming morphs with skinning |
| Materials | PBR plus emissive strength and unlit in glTF; substrate lobes only on `Layer3D` | Reading and writing `KHR_materials_clearcoat`, `sheen`, `specular`, `ior`, `transmission`, `volume`, `iridescence`, `anisotropy`, and a subsurface material for skin; alpha-tested hair cards |
| Eyes | None | Eye model: cornea with refraction and a wet highlight, iris parallax, dilating pupil, limbal ring, scleral tint |
| Hair | None | Hair cards on guide curves, alpha-tested hair shading (Kajiya-Kay or Marschner, two specular lobes), spring chains per lock |
| Cloth | Spring bones on given joints | Generated cloak and hood mesh with chains, collision against body capsules |
| Clips | glTF clips play | Writing clips: procedural idle/breathe/walk, keyframed acting, baking a retargeted video into a clip |

## Architecture

```
packages/forge (new workspace package, bundled into framefields as framefields/forge)
  src/
    glb-writer.ts       public GLB writer: meshes, materials + KHR extensions, skins, morphs, clips, extras
    skeleton.ts         Skeleton: joints with rest transforms, mirror(), naming presets (mixamo)
    sculpt/
      field.ts          bound SDF: every shape belongs to a joint; evaluation returns distance + per-joint influence
      shapes.ts         ellipsoid, roundCone, tube(curve, radii), lathe(profile), sweep(profile, path), extrude(outline)
      ops.ts            bend, twist, mirror, repeatAlong(curve), displace(noise)
      mesh.ts           narrow-band Surface Nets at hero resolution (sparse blocks), feature-preserving relax
      simplify.ts       QEM simplification to a triangle budget; keeps UV seams, material borders and morph-relevant areas
    skin.ts             weights from the field's per-joint influence, smoothed, top 4 normalized
    bake.ts             vertex AO and cavity, curvature (edge wear), thickness (subsurface), normal map from the detailed field
    uv.ts               per-material-island planar/cylindrical unwrap (face, iris, cards); triplanar elsewhere
    face/
      face-rig.ts       face landmarks, eye/jaw/tongue joints, eyelid and brow regions
      expressions.ts    FACS-style blend shapes made by moving the base mesh onto re-sculpted fields
      eyes.ts           eyeball, cornea, iris and pupil meshes + eye material
    hair/
      guides.ts         guide curves from a groom description (part, flow, length, clumping, curl)
      cards.ts          card strips along guides with alpha texture; root-to-tip chains for spring bones
      texture.ts        procedural strand alpha/ID/depth/root-tip atlas
    cloth/
      garment.ts        cloak/hood/cape panels from outlines draped on the body capsule set; chains + collision capsules
    clips/
      procedural.ts     breathe, idle sway, blink, saccades, walk/run from the gait solver
      keys.ts           keyframed acting clips (joints + morph weights) → glTF animation
      bake.ts           bake pose/aim/retarget output into a clip (for crowds)
    character.ts        Character.build(spec) → GLB + report (triangles, joints, morphs, materials, watertight)
    qa.ts               turntable, pose-extremes and expression contact sheets through the real renderer
```

Engine changes outside the package:

- **Loader** (`webgpu-renderers/src/loaders/gltf-loader.ts`): `extras.targetNames`, the KHR material extensions above mapped onto the existing substrate lobes, `alphaMode: MASK` hair with alpha-to-coverage, morphs combined with skinning (morph first, then skin).
- **Renderer**: an eye shading model (`KHR_materials_*` doesn't cover it; mark it with `extras.framefields.eye` so other viewers fall back to PBR); an anisotropic hair lobe for cards (`extras.framefields.hair`); subsurface skin from the existing subsurface lobe, with thickness from the baked vertex attribute.
- **Schema** (`character-schema.ts`): `face` (named expressions as `NumberTrack`s, including signals), `morphs` (raw target names), `eyes` (`target`, `saccades`, `blink`, `pupil`), and spring-chain `colliders` (capsules on joints).
- **Runtime** (`rig.ts`, `renderers/character.ts`): face evaluation order (clips → `morphs`/`face` → eyes look-at → blink); collision for spring chains.

## Face, eyes, and expressions

**Face rig joints.** `Head`, `Jaw`, `LeftEye`/`RightEye`, `LeftEyelidUpper`/`Lower` (also right), `Tongue`. The eyes rotate with real joints, so `lookAt` and saccades are joint rotations and the eyelids follow them as a corrective.

**Expression set** (blend shapes named after FACS action units, with friendly names on top):

| Group | Targets |
| --- | --- |
| Brows | browInnerUp, browDown.L/R, browOuterUp.L/R |
| Eyes | blink.L/R, squint.L/R, wide.L/R, eyeLookUp/Down (lid follow) |
| Nose and cheeks | sneer.L/R, cheekRaise.L/R, cheekPuff |
| Mouth | jawOpen, smile.L/R, frown.L/R, pucker, funnel, press, stretch.L/R, upperUp.L/R, lowerDown.L/R, dimple.L/R |
| Visemes | aa, E, ih, oh, ou, FV, MBP, L, TH, CH (derived from the units above) |

Each target is made by re-sculpting the face field (lids closed, mouth corners pulled up along the cheek, and so on) and moving the base mesh's vertices onto it along the gradient. The vertex layout stays identical, so the targets are valid blend shapes.

**Composition API:**

```ts
Layer.glb("ithrael.glb", {
  face: {
    expression: { contempt: 0.6, sad: [[0, 0], [48, 0.8]] },   // presets mix FACS units
    smile: Signal.sine({ min: 0, max: 0.2, period: 96 }),        // any unit, any track
    speech: { audio: "vo/ithrael.wav", transcript },             // visemes from the word timestamps
  },
  eyes: { target: [960, 400, -300], saccades: true, blink: "auto", pupil: lightLevel },
});
```

Presets: neutral, contempt, cold, sad, angry, fear, surprise, smirk, determined, and a "stillness" preset of micro-motion (slow blink, tiny gaze shifts) for Ithrael.

Lip sync: visemes are derived from the scribe-v2 word timestamps through a grapheme-to-phoneme table. No external model is needed.

## Hair

A groom description in code: part line, flow field over the scalp, length map, clumping, curl and stray hairs. Guides grow over the scalp sculpt. Cards are laid along the clumped guides, with a procedural strand atlas texture. Each lock gets a short spring chain (3 to 5 joints) skinned to its cards and colliding with head, neck and shoulder capsules. Under the hood the cards sit on the hood's inner surface, and the loose front locks fall out of the hood.

Shading: alpha-to-coverage cutout, two shifted anisotropic specular lobes (a primary white one and a secondary tinted one), a root-to-tip darkening gradient, and a baked depth/ID texture for variation.

## Cloak and hood

The garment panels are 2D outlines with seams (hood, mantle, long cloak split into back panels for motion). They are draped on the body's capsule set by a short offline relaxation, which gives the rest shape. Each panel then becomes a grid mesh with spring chains down its length, at 6 to 10 columns. Collision capsules on the spine, thighs and upper arms stop the cloak from passing through the legs. The cloth material uses `sheen` and a frayed alpha-tested hem. The hood is weighted to `Head`, with an inner shadow from the baked AO.

## Ithrael's spec

An original design, distinct from any existing character (see CHARACTERS.md): pale-gold skin, short white hair cut close on one side with long locks on the other, an antler crown threaded with living amber leaves, a petal-shaped bark-lacquer armor of amber resin over dark wood, a moss-green hooded cloak, a recurve horn bow, a gold century-ring tattoo down the right arm, and amber eyes. Her acting is stillness: slow, deliberate movement, a gaze that holds, and small expressions (contempt, cold, a sad closing of the eyes).

Budgets: body 40–60k triangles, face area densest, hair 20–30k, cloak 8–12k, 70–90 joints including the face and chains, about 60 blend shapes.

## Phases

1. **GLB writer and skeleton.** Move `GlbBuilder` into `packages/forge` as a public writer: 32-bit indices, materials with KHR extensions, skins, morphs with `targetNames`, clips, extras. Add the skeleton with mirroring and Mixamo names. *Done when:* a round trip through our loader is exact, and the output passes the Khronos glTF validator.
2. **Bound sculpting and auto-skinning.** Add the new shapes and operations, hero-resolution narrow-band meshing, simplification, and weights from the field. *Done when:* a body bends at the elbows and knees without collapsing, checked on a pose-extremes contact sheet with a volume-loss test.
3. **Loader and material extensions.** Map the KHR materials onto substrate lobes, add alpha-to-coverage, and combine morphs with skinning. *Done when:* the Khronos sample models for clearcoat, sheen and alpha blending match their reference renders closely.
4. **Face.** Add the face rig, FACS targets made by projection, the `face`/`morphs`/`eyes` schema and runtime, and visemes from timestamps. *Done when:* the expression contact sheet reads clearly, blinks close fully with the eye looking up or down, and the lips land on the right words.
5. **Eyes.** Add the eye meshes and shading model (refraction, iris parallax, pupil, wet highlight). *Done when:* the catchlight follows the key light and the iris parallaxes under a camera orbit.
6. **Hair.** Add grooming, cards, the strand atlas, the anisotropic hair lobe, and lock chains with collision. *Done when:* a turntable shows no harsh card edges, and the hair settles after a head turn without passing through the head.
7. **Cloth.** Add the garment panels, draping, cloak chains and collision capsules. *Done when:* a walk clip shows the cloak swinging with no leg pass-through.
8. **Clips and QA.** Add procedural breathe/idle/blink/saccades, keyframed acting clips (draw, release, turn-and-look), bake-to-clip, and the turntable, pose and expression sheets. *Done when:* `examples/36_emberwake` renders Ithrael's test shot (shot 18: "I said I would not let her.") with lip sync, gaze and cloak in wind.

Each phase ships with tests (geometry invariants, a loader round trip, pixel probes through the real renderer), SKILL.md updates (`framefields-compose` Characters section) and `check:plugins`.

## Risks

- **Quality of the face sculpt.** It is the hardest part artistically. Mitigation: base the proportions on published anthropometric ratios, and iterate on the expression contact sheet at close-up camera distance before moving on.
- **Card hair alpha sorting.** Alpha-to-coverage with MSAA avoids sorting. If our pass doesn't run MSAA, use a dithered cutout with TAA-free temporal stability, verified frame to frame.
- **Spring chains have no self-collision between locks.** Clumped locks and capsule collision are enough at trailer distances.
- **Simplification versus morph quality.** Simplify the base before making the targets, and keep extra density in the face area.
