# Spec: Framefields Next-Gen 3D, Material, Lighting & Procedural Engine Roadmap (UE 5.8+ Parity)

## Goal

Bridge the visual fidelity, procedural world-building, material expressiveness, and character/crowd animation gap between **Unreal Engine 5.8+** and **Framefields**—while staying 100% true to Framefields' architecture:

- **Deterministic, code-first `(composition, frame) -> pixels`** in headless Node.js on native WebGPU (Dawn).
- **Zero editor bloat**: every capability is exposed as a declarative, type-safe TypeScript builder on `Layer`, `Layer3D`, `Lighting`, `Physics`, or `Environment3DOptions`, serializable through `CompositorProgramSchema` (`packages/compositions/src/program/schema.ts`), and linted by `comp.lint()` (`packages/compositions/src/program/lint.ts`).
- **Composable with the existing stack**: `Camera3D`, `Light3D` (`@group(3)` storage lights + `texture_depth_2d_array` shadow maps), `Mesh3DPipeline`, `Swarm3DPipeline`, `Physics.world3d` (Rapier), `Signal`, `AudioSignal`, and `comp.vision`.

---

## Architectural Pillars & Roadmap Overview

| Phase | Pillar | UE 5.8+ Inspiration | Framefields Surface & Pipeline |
|---|---|---|---|
| **Phase 1** | **Volumetric Fog, Light Shafts & Area Lights** | Volumetric Fog Froxels + MegaLights Area Lights | `Layer.environment(..., { volumetricFog })` (`VolumetricFogPipeline`) + `Layer.rectLight(...)` (`lightType: "rect"` LTC shading + dual-paraboloid/omni point shadows in `@group(3)`) |
| **Phase 2** | **Substrate-Grade Multi-Lobe PBR Materials & HDRI** | Substrate (`Clearcoat`, `Anisotropy`, `Subsurface`, `Sheen`, `Triplanar`) + HDR Skylight | Extended `SurfaceParams` (`SURFACE_PARAMS_FLOATS`), `mesh3d.wgsl` multi-lobe BRDF, `triplanar` UV-less mapping, and `.hdr` / `.exr` equirectangular IBL prefiltering (`HdrEnvironmentLoader`) |
| **Phase 3** | **Lumen-Lite: Screen-Space GI & Reflections (SSR / SSGI)** | Lumen Lite (60fps screen-space + depth-hierarchy GI & reflections) | `SsrGiPipeline` in `packages/webgpu-renderers/src/renderer3d/` consuming `GeometryResolvePipeline` depth/normals + hierarchical Z (Hi-Z) raymarching |
| **Phase 4** | **Mesh Terrain, SDF Booleans & PCG Surface Scatter** | UE 5.8 Mesh Terrain + PCG Framework + Procedural Vegetation | `Layer3D.terrain(...)`, `Layer3D.sdf(...)` (Dual Contouring / Marching Cubes CSG), and `Layer3D.scatter(...)` (Poisson-disk surface instancing + GPU vertex wind sway) |
| **Phase 5** | **Character Rigging, IK, Pose Blending & VAT Crowds** | Control Rig Physics + Direct Mesh Controls + MetaHuman Crowds | Multi-clip animation blending, Two-Bone IK & spring bones in `GltfLoader`/`Renderer3D`, plus Vertex Animation Textures (VAT) in `Layer3D.instances` for 10,000+ skinned crowd agents |
| **Phase 6** | **Voronoi Destruction & Per-Vertex Motion Blur** | Chaos Destruction + Per-Bone Velocity Motion Blur | `Physics.fracture(mesh, options)` (3D Voronoi cell shattering into `Physics.world3d` + `Layer3D.instances`) and previous-frame skinned/morphed vertex velocity in `MotionBlurPipeline` |

---

## Phase 1: Volumetric Atmosphere, God Rays & Area Lights

### 1.1 Motivation
Currently, `Environment3DFog` (`packages/webgpu-renderers/src/math3d/environment3d.ts`) is an analytic distance fade (`mix(surfaceColor, fog.color, fogFactor)`) evaluated only on opaque/transparent surfaces. Spotlights and directional lights cannot cast volumetric shafts ("god rays") through empty air, and point/rect lights cannot cast shadows or rectangular softbox highlights on products.

### 1.2 Volumetric Fog & Light Shafts (`VolumetricFogPipeline`)
Add `volumetricFog` to `Environment3DOptions`:

```ts
export interface Environment3DVolumetricFog {
	/** Scattering albedo tint (CSS color). Default "#ffffff". */
	color?: string;
	/** Global extinction/density coefficient (0..1). Default 0.025. */
	density?: number;
	/** Henyey-Greenstein phase anisotropy (-0.9..0.9; >0 = strong forward scattering / god rays). Default 0.55. */
	anisotropy?: number;
	/** Exponential height falloff in world Y px (y down). Optional. */
	heightFalloff?: { baseY: number; falloff: number };
	/** 3D animated curl/FBM density noise for patchy theatrical smoke/clouds. */
	noise?: { scale?: number; strength?: number; speed?: number; velocity?: [number, number, number] };
	/** Raymarch steps per pixel (16..96). Default 48. */
	steps?: number;
	/** Max raymarch distance in world px. Default 6000. */
	maxDistance?: number;
}
```

#### GPU Pipeline (`packages/webgpu-renderers/src/renderer3d/volumetric-fog-pipeline.ts`)
- Runs after opaque 3D geometry + `GeometryResolvePipeline` (which resolves single-sample linear depth) and before `BloomPipeline` / tone mapping so hot light shafts contribute to HDR bloom.
- **Half-resolution Temporal/Interleaved Raymarch + Bilateral Upsample**:
  1. For each pixel, reconstruct world-space ray from camera eye to `min(sceneLinearDepth, maxDistance)`.
  2. Jitter start offset along the ray using Interleaved Gradient Noise (IGN) seeded deterministically by `(pixelXY, frame)` to eliminate banding at 32–48 steps.
  3. At each step $\mathbf{p}_k$, evaluate local density $\sigma_t(\mathbf{p}_k)$ (base density $\times$ height falloff $\times$ 3D simplex/FBM noise).
  4. Loop over `@group(3) @binding(3) var<storage, read> directLights : array<DirectLight>`:
     - Evaluate light attenuation (directional, point, spot cone) and Henyey-Greenstein phase function $P(\cos\theta, g)$.
     - Sample `@group(3) @binding(1) var shadowMaps : texture_depth_2d_array` for shadow-casting lights (`shadowParams0.w > 0.5`) so occluders carve sharp volumetric shadow shafts.
  5. Accumulate in-scattered radiance $\mathbf{L}_{\text{scatter}}$ and transmittance $T = \exp(-\int \sigma_t \, ds)$.
  6. Depth-aware bilateral upsample onto the linear HDR scene target: $\mathbf{L}_{\text{out}} = \mathbf{L}_{\text{scene}} \cdot T + \mathbf{L}_{\text{scatter}}$.

### 1.3 Rect Area Lights & Omnidirectional Point Shadows
Extend `LightKind` in `packages/webgpu-renderers/src/math3d/light3d.ts`:

```ts
export type LightKind = "ambient" | "directional" | "point" | "spot" | "rect";

export interface RectLight3DOptions extends Light3DOptions {
	lightType: "rect";
	/** Width of the rectangular emitter in world px. Default 400. */
	width?: number;
	/** Height of the rectangular emitter in world px. Default 200. */
	height?: number;
	/** Whether the rect light emits from both sides. Default false. */
	twoSided?: boolean;
}
```

#### WGSL Shading (`mesh3d.ts` / `quad3d.ts`)
- Pack `typeVal = 4.0` for `"rect"` lights; store `width`, `height`, and right/up tangent basis vectors in `DirectLight` (`spotParams` + unused padding floats in the 40-float `DirectLight` record).
- Evaluate **Linearly Transformed Cosines (LTC)** (or analytic closest-point representative sphere/rectangle approximation with horizon clipping) for GGX specular + Lambertian diffuse, producing true rectangular softbox reflections on curved product surfaces.
- **Omnidirectional Point Light Shadows**:
  - For `point` lights with `castShadow: true`, allocate 2 layers in the existing `shadowMaps : texture_depth_2d_array` using **Dual-Paraboloid Shadow Mapping** (front hemisphere $+Z$ and back hemisphere $-Z$), requiring only 2 layers per point light instead of 6 cubemap faces and fitting cleanly into the existing `texture_depth_2d_array` architecture.

---

## Phase 2: Substrate-Grade Multi-Lobe PBR Materials & Real HDRI Environments

### 2.1 Motivation
UE 5.8's Substrate material system unifies automotive clearcoat, brushed metal anisotropy, skin/wax subsurface scattering, cloth sheen, and thin-film iridescence. Meanwhile, product and studio films frequently need real `.hdr` / `.exr` studio panoramas and UV-less triplanar projection for procedural meshes (`Layer3D.shard`, `Layer3D.extrude`, `Layer3D.terrain`).

### 2.2 Multi-Lobe `SurfaceParams` (`packages/webgpu-renderers/src/renderer3d/surface-params.ts`)
Extend `SurfaceParams` and `SURFACE_PARAMS_FLOATS` (from `20` to `32` floats = `8 × vec4<f32>`):

```ts
export interface SurfaceParams {
	// Existing fields: roughness, metallic, emissive, emissiveIntensity, castShadow, toon, outline
	/** Clearcoat layer intensity 0..1 (automotive paint, lacquered plastic, wet surfaces). Default 0. */
	clearcoat?: number;
	/** Roughness of the clearcoat layer 0..1. Default 0.08. */
	clearcoatRoughness?: number;
	/** Anisotropy strength -1..1 (brushed aluminum, vinyl grooves, satin hair). Default 0. */
	anisotropy?: number;
	/** Anisotropy tangent rotation in degrees 0..360. Default 0. */
	anisotropyRotation?: number;
	/** Subsurface scattering / wrap translucency 0..1 (skin, wax, marble, leaves, gummies). Default 0. */
	subsurface?: number;
	/** Subsurface scattering bleed color (CSS color; defaults to warm shift of base color). */
	subsurfaceColor?: string | Color | [number, number, number];
	/** Cloth / velvet micro-fiber sheen intensity 0..1. Default 0. */
	sheen?: number;
	/** Sheen tint color (CSS color). Default "#ffffff". */
	sheenColor?: string | Color | [number, number, number];
	/** Thin-film soap/oil/holo iridescence strength 0..1 and film thickness in nm (200..800). */
	iridescence?: number | { intensity?: number; thickness?: number; ior?: number };
	/** World-space triplanar texture projection (eliminates UV stretching on procedural/extruded meshes). */
	triplanar?: boolean | { scale?: number; sharpness?: number };
}
```

#### WGSL Multi-Lobe BRDF (`packages/webgpu-renderers/src/shaders/mesh3d.ts`)
1. **Clearcoat Lobe**: Secondary isotropic GGX lobe with $F_0 = 0.04$ (IOR 1.5), roughness $\alpha_c = \text{clearcoatRoughness}^2$, attenuating the base substrate energy by $(1 - F_c \cdot \text{clearcoat})$.
2. **Anisotropic GGX**: Stretch microfacet roughness along tangent $\mathbf{t}$ and bitangent $\mathbf{b}$ rotated by `anisotropyRotation`: $\alpha_t = \alpha (1 + \text{aniso})$, $\alpha_b = \alpha (1 - \text{aniso})$.
3. **Subsurface Approximation**: Burley screen-free wrap diffuse + back-lit thickness transmission (sampling the light's shadow map depth thickness $d = z_{\text{surface}} - z_{\text{blocker}}$ when available, plus view-dependent back-scatter $\max(0, -\mathbf{v} \cdot (\mathbf{l} + \mathbf{n} \cdot \text{distortion}))^p \cdot \text{subsurfaceColor}$).
4. **Charlie Sheen Lobe**: Estevez–Kulla (`Charlie`) retro-reflective grazing lobe for fabrics and velvet.
5. **Thin-Film Iridescence**: Belcour airy-phase spectral interference shifting $F(\cos\theta)$ by optical path difference $2 n_{\text{film}} d \cos\theta_t$.
6. **Triplanar Mapping**: When `triplanar` is active, sample albedo/normal/roughness maps along $(yz, xz, xy)$ world planes blended by $|\mathbf{n}_{\text{world}}|^{\text{sharpness}}$.

### 2.3 Equirectangular `.hdr` / `.exr` IBL (`HdrEnvironmentLoader`)
Extend `Layer.environment(presetOrPath, options)` to accept a file path (`"assets/hdri/studio_small.hdr"`):
- Decode Radiance `.hdr` (RGBE) in pure TypeScript (`packages/webgpu-renderers/src/loaders/hdr-loader.ts`).
- On first upload, run a one-shot WebGPU compute pass to:
  1. Convert equirectangular `rgba16float` into a mipmapped cubemap (`256×256×6`).
  2. Convolve GGX prefiltered specular mip chain (`mip 0..6` mapped to `roughness 0..1`).
  3. Project diffuse irradiance into L2 Spherical Harmonics (`9 × vec4<f32>`).
- Bound in `@group(3)` so any scene can switch between zero-asset procedural studio presets and real captured HDRIs with a single string change.

**Status (implemented):** `renderer3d/hdr-environment.ts` prefilters on the GPU (Karis split-sum, filtered importance sampling, 256 samples) into an `rgba16float` cube whose face is a quarter of the panorama width (8..256) with up to 7 mips (roughness `m / (mips - 1)`). SH projection runs on the CPU from a ≤256-wide copy (`projectIrradianceSh`) and rides in `LightsUniforms.envSh`. `.exr` is decoded by `loaders/exr-loader.ts` (scanline or tiled, NONE/RLE/ZIPS/ZIP/PIZ/PXR24, HALF/FLOAT/UINT), checked against files written by the reference OpenEXR library; lossy B44/DWA/HTJ2K are rejected with a clear error.

---

## Phase 3: Lumen-Lite — Screen-Space Reflections (SSR) & Diffuse GI (SSGI)

### 3.1 Motivation
Planar floor reflection (`FloorReflectionPipeline`) only reflects across a single flat horizontal plane `y = floor.y`. Vertical walls, curved metallic objects, wet streets, and adjacent diffuse surfaces do not reflect or bounce light from nearby geometry or emissive neon signs.

### 3.2 `SsrGiPipeline` (`packages/webgpu-renderers/src/renderer3d/ssr-gi-pipeline.ts`)
Add `gi` and `ssr` options to `Environment3DOptions`:

```ts
export interface Environment3DSsrOptions {
	/** Max reflection intensity 0..1. Default 0.85. */
	intensity?: number;
	/** Max roughness that traces screen-space rays (0..1). Default 0.6. */
	maxRoughness?: number;
	/** Surface thickness threshold in world px before a ray passes behind an occluder. Default 120. */
	thickness?: number;
	/** Hi-Z march steps (16..64). Default 32. */
	steps?: number;
}

export interface Environment3DGiOptions {
	/** Indirect diffuse bounce strength 0..4. Default 1.0. */
	intensity?: number;
	/** Screen-space gather radius in world px. Default 400. */
	radius?: number;
	/** Rays per pixel (4..16). Default 6. */
	samples?: number;
}
```

#### GPU Architecture
1. **Depth Mip Pyramid (Hi-Z)**:
   - After `GeometryResolvePipeline` produces single-sample `linearDepth` and `worldNormal` textures, a compute pass generates a min-depth mip chain (`Hi-Z`, 6 levels).
2. **Hi-Z Screen-Space Reflections (SSR)**:
   - Half-res compute pass marches reflection rays $\mathbf{r} = \text{reflect}(-\mathbf{v}, \mathbf{n})$ (jittered by GGX VNDF lobe for `roughness > 0.05`) through the Hi-Z pyramid, skipping empty space in $O(\log N)$ steps and falling back smoothly to the studio/HDRI environment at screen edges.
3. **Screen-Space Bent-Normal Diffuse GI (SSGI)**:
   - Upgrading `SsaoPipeline` (`packages/webgpu-renderers/src/renderer3d/ssao-pipeline.ts`) into a combined **GTAO + Bent-Normal + 1-Bounce Color Bleed** pass:
   - While horizon-scanning depth slices around each pixel, sample the direct-lit HDR color buffer at visible horizon hits, accumulating indirect diffuse irradiance $\mathbf{E}_{\text{indirect}}$ and bent normal $\mathbf{n}_{\text{bent}}$.
   - Edge-preserving spatial denoise (normal + depth bilateral filter) composites indirect diffuse + specular before bloom and tone mapping.

**Status (implemented):** `renderer3d/ssr-gi-pipeline.ts`. Deviations from the plan above, each for determinism or correctness: (1) SSR and GI run between two forward passes (a `radiance` pass writing pre-exposure, unfogged radiance plus the nearest-sample geometry buffer, then an `apply` pass), so the traced light enters each material's own environment terms (`screenIndirectAt` in `lighting3d.ts`) before tone mapping and fog: no material G-buffer and every Substrate lobe stays correct. (2) No GGX VNDF ray jitter: glossy surfaces cone-sample a premultiplied radiance pyramid at their lobe's footprint, which is noise-free and frame-to-frame stable without TAA. (3) Both trace at full resolution. (4) The Hi-Z holds min and max depth, so rays skip cells they pass wholly in front of or wholly behind (beyond `thickness`); `steps` budgets cell advances and level changes are free. Hits are classified by the hit pixel's tangent plane (a crossing) before falling back to `thickness`, which only applies once the ray has been in front of the scene (no self-hits off convex rims). (5) The shading pass pools each pixel's 3×3 neighbors' rays on the same surface, weighted by confidence, which resolves the holes and seams single rays leave. GI is a cosine-weighted horizon scan (visible band `sin²b − sin²a` per surface) with fixed interleaved-gradient rotation and a separable depth/normal bilateral blur; `SsaoPipeline` is left unused. The `ssr`-without-environment lint is moot since both options live on the environment.

---

## Phase 4: Procedural Terrain, SDF Booleans & PCG Surface Scatter

### 4.1 Motivation
UE 5.8's headline world-building features are **Mesh Terrain** (caves, overhangs, cliffs beyond 2.5D heightfields) and **PCG** (rule-driven surface scattering). In Framefields, bringing these to `Layer3D` turns 20 lines of TypeScript into rich landscapes, organic boolean sculptures, and populated worlds.

### 4.2 `Layer3D.terrain(options)`
Add procedural terrain generation to `packages/webgpu-renderers/src/renderer3d/primitive-geometry.ts` and `packages/framefields/src/shapes3d.ts`:

```ts
export interface Terrain3DOptions extends Primitive3DNodeOptions {
	width: number;
	depth: number;
	/** Peak-to-trough vertical relief in world px. Default 300. */
	height?: number;
	/** Grid subdivisions along X and Z (e.g. [128, 128]). Default [128, 128]. */
	segments?: [number, number];
	/** Multi-octave FBM/ridged-multifractal noise parameters. */
	noise?: {
		seed?: number;
		scale?: number;
		octaves?: number;
		persistence?: number;
		lacunarity?: number;
		/** "fbm" (rolling hills) | "ridged" (sharp mountain crests) | "terrace" (stepped plateaus). */
		ridgeMode?: "fbm" | "ridged" | "terrace";
		terraceSteps?: number;
	};
	/** Optional 3D overhang/arch warp displacement amplitude in px (UE 5.8 Mesh Terrain style). */
	overhangWarp?: number;
	/** Optional custom height function `(u: number, v: number) => number` in [0, 1]. */
	heightFn?: (u: number, v: number) => number;
	/** Automatic vertex-color biome splatting by altitude and slope. */
	colorByElevation?: {
		lowColor: string;
		midColor?: string;
		highColor: string;
		cliffColor?: string;
		/** Slope cosine below which `cliffColor` blends in (default 0.65). */
		cliffThreshold?: number;
	};
	flatShaded?: boolean;
}
```
- Generates vertex colors (`COLOR_0`) from elevation and surface normal slope (`n.y`), which `Mesh3DPipeline` already multiplies with base material properties—giving multi-material snow/rock/grass/sand terrains in a single draw call with zero texture assets.
- Integrates with `Physics.world3d` via Rapier's `trimesh` / `heightfield` collider so rigid bodies and `Layer3D.swarm` particles roll down valleys and collide with ridges.

### 4.3 `Layer3D.sdf(options)` — Signed Distance Field & CSG Boolean Meshing
Allow authoring smooth boolean CSG shapes and organic metaballs meshed via Surface Nets / Dual Contouring:

```ts
export type SdfPrimitive =
	| { op?: "union" | "subtract" | "intersect"; smoothness?: number; shape: "sphere"; center?: [number, number, number]; radius: number }
	| { op?: "union" | "subtract" | "intersect"; smoothness?: number; shape: "box"; center?: [number, number, number]; size: [number, number, number]; radius?: number }
	| { op?: "union" | "subtract" | "intersect"; smoothness?: number; shape: "cylinder" | "capsule" | "torus"; center?: [number, number, number]; radius: number; height?: number; tube?: number }
	| { op?: "union" | "subtract" | "intersect"; smoothness?: number; shape: "gyroid"; scale: number; thickness: number };

export interface Sdf3DOptions extends Primitive3DNodeOptions {
	/** List of SDF primitives combined in order via smooth/hard CSG operations (`smin` / `smax`). */
	primitives: SdfPrimitive[];
	/** Bounding volume [width, height, depth] in world px. */
	bounds: [number, number, number];
	/** Voxel grid resolution (16..128). Default 64. */
	resolution?: number;
}
```
- Evaluates the composite SDF on a 3D grid and extracts a smooth, watertight triangle mesh with analytic gradient normals $\nabla f(\mathbf{x}) / |\nabla f(\mathbf{x})|$, cached in `getPrimitiveGeometry`.

### 4.4 `Layer3D.scatter(options)` — Declarative PCG Surface Scattering & Wind
Build directly on `Layer3D.instances` to scatter thousands of rocks, trees, crystals, or buildings across any `Layer3D` surface or `terrain`:

```ts
export interface Scatter3DOptions extends Omit<Instances3DOptions, "count" | "instanceAt"> {
	/** Target surface mesh (`Layer3D.terrain(...)` or any `Model3DNode`) to scatter onto. */
	surface: AnimatableNode<Model3DNode>;
	/** Number of instances to place (or Poisson-disk `minDistance` in px). */
	count: number;
	minDistance?: number;
	seed?: number;
	/** Filter candidate surface triangles by slope angle (degrees, e.g. [0, 35]) and Y altitude range. */
	slopeRange?: [number, number];
	elevationRange?: [number, number];
	/** Align instance Y axis to surface normal (`1` = full normal alignment, `0` = stay vertical). Default 0.3. */
	alignToNormal?: number;
	/** Random uniform scale range `[min, max]` and random Y-axis yaw. */
	scaleRange?: [number, number];
	randomYaw?: boolean;
	/** Optional spline/circle exclusion zones where density drops to 0 (e.g. clearing a road or stage). */
	exclude?: Array<{ x: number; z: number; radius: number; falloff?: number }>;
	/** Procedural GPU/CPU wind sway applied per instance (`frequency`, `amplitudeDeg`, `waveScale`). */
	wind?: { amplitudeDeg?: number; frequency?: number; direction?: [number, number]; waveScale?: number };
}
```
- Samples surface triangles weighted by area, filters by `slopeRange` / `elevationRange` / `exclude`, enforces Poisson-disk spacing via a spatial hash grid, and outputs an `Instances3DNode` rendered in 1 GPU draw call per mesh variant.

---

## Phase 5: Character Animation Blending, IK, Spring Bones & Skinned VAT Crowds

### 5.1 Motivation
In `examples/35_robot_uprising` and character-driven films, `Layer.model` currently plays a single glTF animation clip at a time, and `Layer3D.instances` only supports rigid unskinned meshes. We need multi-clip pose blending, procedural LookAt/Two-Bone IK, secondary spring physics on bones, and **instanced crowds of thousands of animated characters**.

### 5.2 Multi-Clip Blending, Two-Bone IK & Spring Bones on `Layer.model`
Extend `Model3DNode` and `GltfLoader` (`packages/webgpu-renderers/src/loaders/gltf-loader.ts`):

```ts
export interface ModelAnimationLayer {
	/** Clip name or index in the glTF asset. */
	clip: string | number;
	/** Blend weight 0..1 (number, Signal, or keyframed prop). Default 1. */
	weight?: number;
	/** Playback speed multiplier. Default 1. */
	speed?: number;
	/** Time offset in seconds. Default 0. */
	timeOffset?: number;
	/** Optional bone mask (only affect descendants of these joint names). */
	mask?: string[];
}

export interface TwoBoneIkConstraint {
	/** [rootJointName, midJointName, effectorJointName], e.g. ["UpperArm.L", "LowerArm.L", "Hand.L"]. */
	chain: [string, string, string];
	/** World or model-local target position [x, y, z] (or driver `(frame) => [x, y, z]`). */
	target: [number, number, number] | ((frame: number) => [number, number, number]);
	/** Pole vector target for knee/elbow bend direction. */
	poleTarget?: [number, number, number];
	weight?: number;
}

export interface LookAtConstraint {
	joint: string;
	target: [number, number, number] | ((frame: number) => [number, number, number]);
	weight?: number;
	maxAngleDeg?: number;
}

export interface SpringBoneChain {
	/** Root joint name(s) for secondary jiggle/follow-through (cape, tail, antenna, hair). */
	joints: string[];
	stiffness?: number;
	damping?: number;
	gravity?: [number, number, number];
}
```

#### Deterministic Evaluation Order per Frame
1. Sample each active `ModelAnimationLayer` TRS (translation, rotation quaternion, scale) and blend via normalized quaternion `slerp` / `nlerp` (with optional upper-body/lower-body `mask`).
2. Solve `LookAtConstraint` (clamped swing quaternion) and analytic **Two-Bone IK** (law of cosines for knee/elbow bend angle + pole-vector twist) in joint hierarchy order.
3. Step `SpringBoneChain` Verlet / harmonic spring state (pre-simulated deterministically across frames `[0..totalFrames]` on build, identical to `Physics.world3d`, so random-access frame rendering stays 100% deterministic).
4. Upload final `skinningMatrices` (`16 floats × jointCount`) to `Mesh3DPipeline`.

### 5.3 Skinned Crowds via Vertex Animation Textures (VAT) in `Layer3D.instances`
To render 500–10,000 animated characters (robots, soldiers, pedestrians) in 1 GPU draw call:
- When `Layer3D.instances({ mesh: Layer.model({ src: "robot.glb", ... }), crowd: { clips: ["walk", "idle", "run"] }, ... })` is constructed:
  1. **Bake Joint Palette Atlas once per model**: Sample the model's skinning joint matrices across each animation clip at 30/60 Hz into a 2D `rgba32float` texture (`width = jointCount * 4`, `height = totalBakedFrames`).
  2. Pack `(clipIndex, animPhaseOffset, animSpeed)` into the unused bits of `InstanceData.emissive.w` (or a companion per-instance `vec4<f32>`).
  3. In `mesh3d.wgsl` (`vs_main`), when both `isInstanced` and `isSkinned` are active, each vertex fetches its 4 influencing bone matrices from the baked joint palette storage/texture buffer at the instance's `(clipIndex, frame * speed + phaseOffset)`.
- Result: **5,000 independently walking/running skinned 3D characters with shadows, outlines, and bloom in a single draw call**.

---

## Phase 6: Voronoi Mesh Fracture & Per-Vertex Velocity Motion Blur

### 6.1 `Physics.fracture` — Deterministic Voronoi Shattering
Enable objects (statues, walls, typography, product cases) to remain a single seamless mesh until a designated impact frame, then shatter into physical 3D Voronoi fragments:

```ts
export interface Fracture3DOptions {
	/** Source solid (`Layer3D.*` primitive, `Layer3D.extrudedText`, or `Layer.model`). */
	mesh: AnimatableNode<Model3DNode>;
	/** Number of Voronoi fracture cells (8..256). Default 48. */
	cells?: number;
	/** Optional world/local impact point where Voronoi seeds cluster more densely. */
	impactPoint?: [number, number, number];
	/** Deterministic seed. Default 1. */
	seed?: number;
	/** Frame at which the intact mesh swaps to dynamic Rapier rigid bodies (or `"onImpact"`). */
	fractureFrame?: number | "onImpact";
	/** Optional interior surface material/color for newly exposed fracture faces. */
	interiorColor?: string;
	interiorRoughness?: number;
	/** Outward radial impulse speed applied at `fractureFrame` (px/s). */
	explosionSpeed?: number;
}
```
- Uses the convex half-space plane clipper from `Layer3D.shard` generalized to **3D Voronoi cell clipping** (clipping the source mesh against the bisector planes $\mathbf{n}_{ij} = \mathbf{p}_j - \mathbf{p}_i$ of its $K$-nearest seed neighbors).
- Registers each cell with `Physics.world3d` (holding `type: "fixed"` until `fractureFrame`, then switching to `"dynamic"` with `explosionSpeed` impulse) and returns a single `Layer3D.instances` node that renders all cells in one draw call.

### 6.2 Per-Vertex & Per-Instance Velocity Motion Blur (`MotionBlurPipeline`)
Currently, `MotionBlurPipeline` (`packages/webgpu-renderers/src/renderer3d/motion-blur-pipeline.ts`) reconstructs pixel velocity only from the camera's previous view-projection matrix.
- Upgrade the MRT velocity pass to accept `prevModelMatrix`, `prevSkinningMatrices`, and `prevInstanceBuffer` (`Swarm3DPipeline` / `Layer3D.instances`).
- Fast-moving robot limbs, tumbling shards, and fractured debris get authentic directional per-object and per-bone shutter motion blur.

---

## Schema, Lint & Skill Synchronization Requirements

Every phase must keep the engine harness self-consistent:
1. **`packages/compositions/src/program/schema.ts`**:
   - Add Zod schemas for `volumetricFog`, `ssr`, `gi`, `rectLight`, `SurfaceParams` extensions (`clearcoat`, `anisotropy`, `subsurface`, `sheen`, `iridescence`, `triplanar`), `Layer3D.terrain`, `Layer3D.sdf`, `Layer3D.scatter`, `ModelAnimationLayer`, `ik`, `springBones`, and `Physics.fracture`.
2. **`packages/compositions/src/program/lint.ts`**:
   - Warn if `clearcoat`, `anisotropy`, or `ssr` is used without `Layer.environment`.
   - Warn if `volumetricFog` is enabled with zero direct lights in the scene.
   - Warn if `Layer3D.scatter` filters (`slopeRange` / `elevationRange`) reject 100% of candidate surface points.
3. **Agent Skills & Catalog**:
   - Update `nodes/node-compositor/SKILL.md` and `plugins/framefields/skills/framefields-compose/SKILL.md`.
   - Keep `packages/compositions/src/program/skillmd-check.test.ts` and `pnpm run check:plugins` passing.

---

## Verification Ladder (Per Phase)

1. **Typecheck**: `tsc --noEmit -p .` in `@framefields/core`, `@framefields/webgpu-renderers`, `@framefields/compositions`, `@framefields/node-compositor`, and `framefields`.
2. **Schema & Lint Tests**: Unit tests in `packages/compositions` verifying `CompositorProgramSchema.parse(comp.toSpec())` and `comp.lint()` diagnostics.
3. **Headless GPU Render Tests**: Vitest pixel-probe tests in `packages/webgpu-renderers/src/renderer3d/renderer3d.test.ts` verifying:
   - Volumetric light shafts occluded by shadow casters.
   - Clearcoat / anisotropic / subsurface / HDRI shading energy conservation.
   - Hi-Z SSR reflection of off-floor emissive objects and SSGI color bleeding.
   - Watertight `Layer3D.terrain` and `Layer3D.sdf` meshes + deterministic `Layer3D.scatter` placement.
   - Two-Bone IK target convergence and instanced VAT skinned crowd rendering in 1 draw call.
4. **Visual Reference Film (`examples/`)**: Render frame grids (`renderFrameGrid`) to inspect visual quality before merging each phase.

