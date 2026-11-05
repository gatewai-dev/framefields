# DNA characters: MetaHuman-compatible faces and bodies

Status: Phases 1–2 done, plus the engine gaps they found.
- **Phase 1:** each material map samples with its own glTF sampler.
- **Phase 2:** `packages/dna` (`framefields/dna`) reads DNA files (2.1 to 2.8: descriptor and its extension, definition, behavior, geometry; other layers are listed and skipped). `dnaToGlb` / `addDna` write the neutral pose with rest orientations (the forge skeleton gained `orient`), a LOD's meshes, skin weights (duplicate joint entries merged) and blend shapes as named morph targets.
- **Parity with Epic's library:** `packages/dna/fixtures/oracle.cpp` builds against OpenRigLogic 5.8 (commit `d3d329bb`). `oracle.dna` is made-up data written by Epic's writer, and each fixture's `.json` is what Epic's reader reads. `readDna` matches it field for field for 2.8 and 2.1 files. Epic's reader also reads our test writer's files identically.
- **Engine gaps, closed:**
  - **Sparse morphs:** the loader keeps sparse morph targets sparse (`MorphTarget3D.indices`), and the GPU pass gathers deltas per vertex from entries that exist (memory follows the deltas, no atomics).
  - **Eight influences:** skins take up to eight influences per vertex (`JOINTS_1` / `WEIGHTS_1` through writer, loader and shader; a second vertex slot, flagged).
  - **Materials:** DNA meshes get role materials, and `dnaMaterials` scans an export folder for textures.

Still open:
- The export's real texture file names (the scan's patterns are guesses until a real export is read).
- The rig evaluator (Phase 3).

## Goal

Load a character exported from MetaHuman Creator (Export > DCC Export: a head DNA file, a body DNA file and textures) into a composition, and animate it with the same rig evaluation Unreal Engine uses: face controls drive joints, corrective blend shapes and wrinkle-map weights. The character then animates with the same tracks as forge humans: `morphs` (ARKit names), `pose`, `aim`, `lookAt`, IK and retargeting from vision.

DNA characters are the only realistic-human path: `human()` and MakeHuman were removed (2026-11-05) because their rendering and motion fell short. Characters come from MetaHuman Creator exports and render with our own shaders. The forge stays for skeletons, sculpted props, costumes and non-humans.

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

- **Oracle:** OpenRigLogic 5.8 built under `scratch/` with a small C++ program (`packages/dna/fixtures/oracle.cpp`; no Python bindings needed). Done for reading; extended to evaluation in Phase 3.
- **Committed fixture:** a small synthetic DNA file written with the C++ writer from data we make up (a few joints, controls, PSDs, blend shapes, a conditional table, one tiny mesh). It contains no MetaHuman content, so it can be committed. A script regenerates it.
- **Parity tests:**
  - the reader against the oracle on every layer of the fixture;
  - evaluator outputs against the oracle for random controls (fixed seed), within 1e-5.
- **Real character smoke test:** the user's own export (or Fab sample content) loaded locally:
  - the GLB passes the Khronos validator;
  - rendered frames of a neutral face, then jawOpen, smile, blink and brow raise, with wrinkles on and off;
  - the timings recorded.
  
  Skipped in CI when no export is present.

## Phases

1. Per-map samplers in the renderer. **Done.**
2. DNA reader and `dnaToGlb`. **Done**, with reader parity against Epic's library, sparse morphs, eight influences and role materials.
3. Rig evaluator, body first:
   - **3a. Shared core. Done.** `RigEvaluator` (`packages/dna/src/rig.ts`) covers GUI → raw controls, PSDs, joint matrices per group and LOD, blend shapes and animated maps.
     - **Parity:** RigLogic's scalar, full-precision outputs on the oracle character (`oracle eval`, 48 seeded cases across GUI/raw controls and both LODs) match to float precision. Mutation checks confirm the fixture catches interval skipping, PSD clamping and the PSD cap.
     - **One deliberate difference:** PSDs a LOD does not use are 0 rather than last frame's value, so evaluation is stateless.
     - **Still open:** composing deltas onto the neutral pose. Translation and scale add; the rotation delta applies in the joint's oriented frame (Maya's joint-orient convention). That needs a real export to confirm.
   - **3b. Body correctives. Evaluation done; wiring and the render milestone open.**
     - **RBF and twist/swing:** `rig-body.ts` adds RBF solvers (additive and interpolative; Euclidean, quaternion, swing-angle and twist-angle distances; Gaussian, exponential, linear, cubic and quintic kernels; automatic radius; normalization, pose scales, thresholds, gating) and twist/swing (tdm's slerp and quaternion-to-Euler, including its polynomial asin). The reader adds the `rbfb`, `rbfe`, `twsw`, `jbmd` and `mlbh` (names only) layers.
     - **Parity:** the oracle character has five solvers covering every method and kernel, plus a twist and a swing. Outputs match RigLogic to float32 rounding (1e-6 for face parts; 2e-4 where an ill-conditioned interpolation matrix amplifies RigLogic's float32 inversion).
     - **Mutation checks:** sixteen behaviour changes are caught.
     - **Not evaluated yet:** quaternion joint groups (files needing them are refused) and machine-learned behavior.
     - **Still open:** feeding the skeleton's joint quaternions into raw controls inside layers, and the shoulder raise and elbow bend milestone on a real exported body.
   - **3c. Face:** face controls drive joints and correctives; ARKit names map to face controls so `morphs` keeps working.
4. Animated maps and wrinkle maps in the renderer.
5. Head and body as one character: the head's skeleton joined to the body's at the neck, with no gap and no double neck motion; the `"unreal"` retarget preset.
6. Machine-learned behavior, if present in exports and worth it.
7. Docs: the skill, NOTICE, changesets, an example film shot with a DNA character, and the license wording from open question 1.

Tests every phase keeps:
- **Seeking matches playing:** rendering frame 200 directly gives the same pixels and rig outputs as rendering 0 through 200. The evaluator keeps no state between frames.
- **LOD switching:** each LOD loads and evaluates; switching LOD mid-shot keeps the pose.
- **Several characters:** two instances of one character and two different characters in one scene evaluate independently.
- **Memory:** rig data and GPU buffers are released when a character leaves the scene; repeated renders do not grow memory.

## Open questions

1. What does the current MetaHuman license allow for exported characters rendered outside Unreal Engine, in our CLI, our render service and users' outputs? The docs must state it accurately before release.
2. Is there a MetaHuman export available for testing (UE 5.8 with MetaHuman Creator)? If not, Fab's sample content works for local testing.
3. Store the rig behavior inside the GLB, or keep the `.dna` next to it?
4. Do current exports use the machine-learned behavior layer, and does the face need it to look right?
5. Grooms (hair, brows, lashes) are not in the export. Eyelash and eyebrow cards come with the head mesh; hair needs the forge's planned hair cards.
