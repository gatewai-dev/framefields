# DNA characters: MetaHuman-compatible faces and bodies

Status: Phase 1 done: each material map samples with its own glTF sampler (loader `mapSampling`, a sampler binding per map in the mesh shader). Phases 2 onward are planned.

## Goal

Load a character exported from MetaHuman Creator (Export > DCC Export: a head DNA file, a body DNA file and textures) into a composition, and animate it with the same rig evaluation Unreal Engine uses: face controls drive joints, corrective blend shapes and wrinkle-map weights. The character then animates with the same tracks as forge humans: `morphs` (ARKit names), `pose`, `aim`, `lookAt`, IK and retargeting from vision.

This sits next to `human()`, not in place of it. `human()` stays the path for people built in code from CC0 data. DNA characters are for users who bring a character made in MetaHuman Creator. Their realism comes from the rig: hundreds of correctives, and wrinkle maps that fade in with each expression. Both kinds of character share the renderer improvements this work brings, wrinkle maps above all.

## Source and terms

- [OpenRigLogic](https://github.com/EpicGames/openriglogic) (Epic Games, MIT): the DNA library (read and write DNA files) and RigLogic (rig evaluation), C++ with Python bindings. Branch `5.8` is the stable one; `main` is experimental. We pin a `5.8` commit.
- **Code:** we port what we need to TypeScript under MIT. The copyright and license text go into `packages/framefields/NOTICE.md`, and the ported files name their source.
- **Names:** under the repository's `TRADEMARKS.md`, the MIT license covers code, not names. We may say the code is based on OpenRigLogic, and that a feature reads MetaHuman DNA files. No API, package or feature is named after MetaHuman, RigLogic or OpenRigLogic.
- **Characters:** none ship. DNA files and textures come from the user's own MetaHuman export, under Epic's MetaHuman terms. Sample DNA from Fab is under the Fab Standard License: use it locally for testing, never commit it. Before release, read the current MetaHuman license on using exported characters outside Unreal Engine and quote it in the docs (open question 1).
- **Downloads:** cloning OpenRigLogic, and building it locally as a test oracle, needs the user's go-ahead like any download.

## Why a TypeScript port, not native bindings or WebAssembly

- The engine has no native addons outside Dawn, and the forge is pure TypeScript. A port keeps it that way, and runs wherever the renderer runs (CLI, preview, render service).
- The evaluation is small in essence: a sparse matrix-vector product per output kind, plus pose-space products, conditional tables, RBF and twist/swing. The C++ size (`src/riglogic` about 740 KB, `src/dna` about 400 KB) is mostly SIMD variants (block-4 and block-8 layouts, quaternion and Euler paths), builders, writers and the machine-learned behavior. One scalar reference evaluator in TypeScript covers the behavior.
- Its matrix form maps to a WebGPU compute pass later, like the morph pipeline.
- **Fallback:** if the port stalls on format breadth, compile the C++ to WebAssembly with Emscripten and load it as a lazy chunk, like the vision models.

## Design

### Package

`packages/dna` (private, Apache-2.0 plus the MIT notice for the ported parts), bundled into `framefields` as a lazy chunk and exposed as `framefields/dna`. It has no GPU code. The compositor imports it dynamically only when a layer uses a DNA character.

### 1. DNA reader

- Reads the binary format through its layers:
  - header and descriptor: name, archetype, gender, age, coordinate system, units, LOD count;
  - definition: control, joint, blend shape, animated map and mesh names; joint hierarchy; neutral joint transforms; LOD mappings;
  - behavior: GUI-to-raw control map, PSDs, joint matrices per joint group, blend shape channel mapping, animated-map conditional tables;
  - geometry: mesh vertices, normals, UVs, faces, skin weights, blend shape target deltas;
  - extension layers as they appear: twist/swing, RBF, joint behavior metadata, machine-learned behavior.
- Reads only what is asked: layer filter (behavior only, or with geometry), LOD selection (load LOD 0, or LOD 3 for wide shots). A head with every LOD is large; with one LOD it stays reasonable.
- Checks versions and fails with a clear message on a DNA version it does not know.

### 2. DNA to model

- `dnaToGlb(head, body?, { lod, textures })` in the forge writes a GLB through `GltfDocument`: meshes, skins, blend shapes as named morph targets (sparse), joint hierarchy with neutral transforms, materials from the export's textures (skin, eyes, teeth, eyelashes), and the rig behavior attached as data.
- The coordinate system and units are converted from the descriptor to glTF's (meters or centimeters, y-up).
- Going through the GLB means the existing loader, skinning, morphs, materials, `pose`, `lookAt` and retargeting all work unchanged. The rig evaluator is the only new runtime piece.
- The behavior data (several MB) is stored in the GLB as a buffer view named in the scene's `extras.framefields.rig`, so the file is self-contained. Alternative: keep the `.dna` next to the GLB and reference it (open question 3).

### 3. Rig evaluator

A scalar port with RigLogic's semantics, outputs matched to the C++ within 1e-5:

1. **Controls:** GUI controls → raw controls (clamped ranges); the user sets either.
2. **PSD:** pose-space inputs appended from products of raw controls.
3. **Joints:** per joint group, a sparse matrix times the input vector gives joint deltas (translation, rotation, scale) from the neutral pose, truncated by LOD.
4. **Blend shapes:** a linear map from inputs to blend shape channel weights.
5. **Animated maps:** conditional tables (piecewise slope-intercept) give wrinkle-mask multipliers.
6. **Twist/swing and RBF** (mostly body): RBF poses solved from joint rotations drive correctives. These fix the shoulder and elbow collapse that plain linear blend skinning shows.
7. **Machine-learned behavior:** read, and evaluated last (open question 4).

API: `const rig = new RigEvaluator(reader, { lod })`, then `rig.evaluate(controls)` returns `{ joints, blendShapes, animatedMaps }` into reusable typed arrays, with no allocation per frame.

### 4. Engine wiring

- `Layer.glb(file, { face: { controls: { "CTRL_expressions_jawOpen": track, … } } })`: when the GLB carries rig behavior, the compositor evaluates it each frame.
  - Joint deltas compose onto the neutral pose before `pose`.
  - Blend shape weights merge with `morphs`: a named `morphs` track overrides.
  - Animated map weights go to the material.
- Order: clips → face rig → `pose` → `aim` → `lookAt` → `drive` → IK → springs.
- `morphs` with ARKit names on a DNA character go through a mapping table (ARKit 52 → face controls), so the same tracks animate a forge human or a DNA character. Face tracking from video later drives both.
- Cost: a head has hundreds of joints and thousands of matrix entries. Scalar evaluation on the CPU should take well under a millisecond per frame. It moves to the GPU only if profiling says so.

### 5. Wrinkle maps (renderer)

- A material can carry wrinkle layers: extra normal (and optionally color) maps, plus mask textures whose channels each select a face region. The animated map weights, per region, blend the wrinkle normals in.
- Written as `extras.framefields.wrinkles` on the material (maps, masks and channel → animated-map name), read by the loader, applied in `mesh3d.ts`.
- Builds on **per-map samplers** (Phase 1, done): every map samples with its own wrap and filter.
- The forge human gains wrinkle maps too: bake wrinkle normals for the forehead, eye corners, nasolabial fold and brow furrow from where each expression shape compresses the skin, with masks driven by the ARKit weights. A separate step after the DNA work, using the same renderer feature.

### 6. Body DNA and retargeting

- Body joints come with Unreal's mannequin names (`pelvis`, `spine_01`, `clavicle_l`, `upperarm_l`, …). Add an `"unreal"` preset to `retarget({ rig })`, and joint aliases so `pose` with Mixamo names reaches the right bones.
- Head and body join at the neck: the head's skeleton is a subtree of the body's. `dnaToGlb(head, body)` merges them into one skeleton.

## Verification

- **Oracle:** build the pinned OpenRigLogic (CMake) with its Python bindings under `scratch/`, after the user approves the clone.
- **Committed fixture:** a small synthetic DNA file written with the C++ writer from data we make up (a few joints, controls, PSDs, blend shapes, a conditional table, one tiny mesh). It contains no MetaHuman content, so it can be committed. A script regenerates it.
- **Parity tests:**
  - the reader against the oracle on every layer of the fixture;
  - evaluator outputs against the oracle for random controls (fixed seed), within 1e-5.
- **Real character smoke test:** the user's own export (or Fab sample content) loaded locally:
  - the GLB passes the Khronos validator;
  - rendered frames of a neutral face, then jawOpen, smile, blink and brow raise, with wrinkles on and off;
  - the timings recorded.
  
  Skipped in CI when absent, like the MakeHuman cache tests.

## Phases

1. Per-map samplers in the renderer (prerequisite for wrinkle maps, fixes the pore map).
2. DNA reader: header, descriptor, definition, geometry. `dnaToGlb` renders a neutral head with its textures.
3. Behavior layer and evaluator: controls, PSD, joints, blend shapes. Face controls animate the head. Parity tests.
4. Animated maps and wrinkle maps in the renderer.
5. ARKit mapping and `morphs` on DNA characters; ARKit-named faces drive both kinds of character.
6. Body DNA: twist/swing, RBF correctives, the `"unreal"` retarget preset, head and body merged.
7. Machine-learned behavior, if present in exports and worth it.
8. Docs: the `framefields-compose` skill (DNA characters, face controls, wrinkles), NOTICE, changesets, an example film shot with a DNA character, and the license wording from open question 1.

## Open questions

1. What does the current MetaHuman license allow for exported characters rendered outside Unreal Engine, in our CLI, our render service and users' outputs? The docs must state it accurately before release.
2. Is there a MetaHuman export available for testing (UE 5.8 with MetaHuman Creator)? If not, Fab's sample content works for local testing.
3. Store the rig behavior inside the GLB, or keep the `.dna` next to it?
4. Do current exports use the machine-learned behavior layer, and does the face need it to look right?
5. Grooms (hair, brows, lashes) are not in the export. Eyelash and eyebrow cards come with the head mesh; hair needs the forge's planned hair cards.
