# Spec: 3D Shards, Instanced 3D Mesh Swarm & Floor Reflections

## Goal

Extend Framefields' 3D engine with general-purpose primitives and GPU pipelines forfaceted polyhedral geometry (`Layer3D.shard`), high-count 3D mesh/particle simulations (`Layer3D.swarm`), instanced 3D rigid-body rendering (`Layer3D.instances`), and glossy ground reflections (`floor` on `Layer.environment`).

All additions are first-class, reusable engine primitives that compose with existing `Camera3D`, `Light3D`, `Layer.environment` (GGX PBR + IBL + HDR bloom + fog + shadows), `Physics.world3d` (Rapier), `Signal`, `comp.vision`, and `CompositorProgramSchema`.

---

## Architectural Pillars

1. **`Layer3D.shard(options)`** — Procedural flat-faceted convex polyhedron primitive in `primitive-geometry.ts` and `Layer3D`.
2. **`Layer3D.instances(options)`** — Single-draw-call hardware-instanced 3D mesh batch node (`Model3DNode` / `Renderer3D`) for rendering hundreds or thousands of 3D meshes driven by `Physics.world3d` or procedural callbacks without layout-tree overhead.
3. **`Layer3D.swarm(options)`** — GPU compute-simulated 3D particle & mesh-shard system rendered natively inside `Renderer3D` (participating in 3D camera projection, depth buffer, GGX PBR lighting, shadow receiving, and HDR bloom) with 3D forces (curl noise, attractors, vortex/swirl, floor friction, and `comp.vision` silhouette push) and dynamic kinetic shading (`emissiveBySpeed`, `emissiveByContact`, secondary spark emission).
4. **`Environment.floor` (Planar Glossy Floor Reflection)** — Scene-wide ground plane reflection in `Renderer3D` / `Layer.environment` with anisotropic roughness blur and Fresnel falloff.

---

## 1. Procedural Faceted Polyhedron Primitive: `Layer3D.shard`

### Motivation
`primitive-geometry.ts` currently provides smooth primitives (`roundedBox`, `sphere`, `cylinder`). Authors need a general-purpose faceted geometric primitive for crystals, low-poly debris, fractured glass, asteroids, Voronoi-like shards, and abstract faceted motion graphics.

### Geometry Algorithm (`packages/webgpu-renderers/src/renderer3d/primitive-geometry.ts`)
Add `ShardGeometryOptions` (`type: "shard"`) to `PrimitiveGeometryOptions`:

```ts
export interface ShardGeometryOptions extends PrimitiveSurface {
	type: "shard";
	/** Approximate bounding radius (or half-extents when aspect/scale is used). Default 50. */
	radius?: number;
	/** Optional non-uniform half-extents [hx, hy, hz]; overrides `radius` per axis. */
	size?: [number, number, number];
	/** Number of clipping half-space planes that carve the convex polyhedron (6..48). Default 14. */
	facets?: number;
	/** Deterministic PRNG seed for plane normals and depths. Default 1. */
	seed?: number;
	/** How unevenly planes cut toward the center, 0..0.85 (0 = regular polyhedron, 0.5 = jagged shard). Default 0.35. */
	irregularity?: number;
	/** Bevel / chamfer fraction along edges, 0..0.3 (0 = razor-sharp flat facets). Default 0. */
	bevel?: number;
}
```

#### Construction (Deterministic Convex Half-Space Clipping)
1. Start from a bounding cube of half-extents `[hx, hy, hz]` (derived from `size ? [size[0]/2, size[1]/2, size[2]/2] : [radius, radius, radius]`).
2. Generate `facets` quasi-uniformly distributed unit normals $\hat{n}_k$ on the sphere using a seeded Fibonacci lattice perturbed by PCG hash jitter (`seed`, `irregularity`).
3. For each plane $k$, choose signed distance $d_k = r_k \cdot (1 - \text{irregularity} \cdot \text{rnd}(k, \text{seed}))$ where $r_k$ is the support radius along $\hat{n}_k$.
4. Iteratively clip the convex polygon soup against each half-space $\hat{n}_k \cdot \mathbf{x} \le d_k$ (Sutherland–Hodgman 3D convex polyhedron clipping):
   - Clip each existing polygon face against the plane.
   - Collect the intersection loop vertices on the clipping plane, sort them counter-clockwise around $\hat{n}_k$, and add the new cap polygon face.
5. **Recenter & Normalize**:
   - Compute the centroid of the resulting polyhedron and shift all vertices so the mesh origin is `[0, 0, 0]`. Rescale so the bounding box matches the requested `radius` / `size`.
6. **Flat-Faceted Normal & UV Generation**:
   - Emit separate vertices per face (no normal averaging across sharp edges) so every facet has a crisp, flat geometric normal $\hat{n}_{\text{face}}$ that catches specular and environment highlights cleanly.
   - Compute planar tangent-space UVs `[u, v]` per face in `[0, 1]`.
7. **Caching & Rapier Integration**:
   - Cached via `getPrimitiveGeometry(options)` by JSON key (identical `(radius, facets, seed, irregularity)` share one `GPUMeshBuffers` allocation).
   - In `Physics.world3d` (`packages/framefields/src/physics/world3d.ts`), `colliderShape3D` automatically falls through to `hull()` (`meshPoints(t.modelData)`), giving every `Layer3D.shard` an exact Rapier 3D `convexHull` collider out of the box.

### Public SDK (`packages/framefields/src/shapes3d.ts`)
```ts
export type Shard3DOptions = Primitive3DNodeOptions &
	Omit<ShardGeometryOptions, "type" | "color" | "material">;

Layer3D.shard(options: Shard3DOptions): AnimatableNode<Model3DNode>
```
Supports all `Primitive3DNodeOptions` (`material: "lit" | "unlit" | "toon" | "glass" | "acrylic" | "frosted" | "metallic"`, `roughness`, `metallic`, `emissive`, `emissiveIntensity`, `castShadow`, `wireframe`, `tint`).

---

## 2. Hardware-Instanced 3D Meshes: `Layer3D.instances`

### Motivation
Currently, rendering $N$ 3D meshes requires $N$ `Model3DNode` items in `layout`, $N$ model matrices computed on the CPU and uploaded to $N$ uniform buffers from `BufferPool`, and $N$ separate `pass.drawIndexed` calls. For $N \ge 200$ (e.g., a `Physics.world3d` simulation of 500 shards or an architectural grid of 1,000 elements), layout/schema/draw-call overhead dominates.

### Renderer3D Instancing (`packages/webgpu-renderers/src/renderer3d/mesh3d-pipeline.ts`)
Extend `Mesh3DPipeline` with an instanced draw path:

#### Instance Storage Buffer Layout (`64 bytes` = `4 × vec4<f32>` per instance)
```wgsl
struct InstanceData {
	posScale : vec4<f32>, // xyz = world position, w = uniform scale (or pack non-uniform scale)
	quat     : vec4<f32>, // xyzw = unit rotation quaternion
	color    : vec4<f32>, // rgba = per-instance linear/sRGB color multiplier
	emissive : vec4<f32>, // rgb = per-instance emissive color, w = emissiveIntensity + variant bits
};
```
- Bound as `@group(1) @binding(4) var<storage, read> instances : array<InstanceData>;` (with a 1-element dummy buffer bound when `useInstancing == 0`, honoring the WGSL rule that every declared binding is statically used in `vs_main`).
- In `vs_main`: when `model.params.w > 0.5` (instanced mode), transform `localPos` and `localNorm` by `instances[instanceIndex].quat` and `instances[instanceIndex].posScale` before applying `model.modelMatrix`, and pass `instances[instanceIndex].color` and `instances[instanceIndex].emissive` to the fragment shader via `VertexOutput`.
- Works seamlessly with:
  - Shadow map pass (`pipelineShadow` also reads `instances[instanceIndex]` so all instances cast shadows in a single instanced draw call).
  - MSAA, Depth of Field (`linearDepth` MRT), and HDR Bloom (`hdr` MRT).
  - Multi-variant meshes: if `variants: Model3DData[]` (e.g. 8 seeded `Layer3D.shard` meshes) are supplied, instances are bucketed by `variantIndex = i % variants.length`, issuing at most `variants.length` instanced draw calls (`drawIndexed(indexCount, instanceCount)`).

### Public SDK (`Layer3D.instances`)
```ts
export interface InstanceTransform3D {
	x: number;
	y: number;
	z: number;
	/** Euler degrees [rx, ry, rz] or unit quaternion [qx, qy, qz, qw]. */
	rotation?: [number, number, number] | [number, number, number, number];
	scale?: number | [number, number, number];
	color?: string | [number, number, number, number];
	emissive?: string | [number, number, number];
	emissiveIntensity?: number;
}

export interface Instances3DOptions extends Surface3DOptions {
	id?: string;
	/** One mesh node/primitive, or an array of mesh variants distributed across instances. */
	mesh: AnimatableNode<Model3DNode> | Array<AnimatableNode<Model3DNode>>;
	/** Count of instances when driven by `instanceAt` or `bodies`. */
	count?: number;
	/** Bind directly to Physics.world3d rigid bodies. */
	bodies?: readonly PhysicsBody3D[];
	/** Per-frame callback `(index, frame, fps) => InstanceTransform3D` (or Float32Array batch). */
	instanceAt?: (index: number, frame: number, fps: number) => InstanceTransform3D;
	/** Optional speed/impact-to-emissive mapping when bound to `bodies`. */
	emissiveBySpeed?: { color: string | string[]; maxSpeed: number; intensity?: number };
	emissiveByImpact?: { color: string; intensity?: number };
	material?: MaterialType;
	roughness?: number;
	metallic?: number;
	specularIntensity?: number;
	startFrame?: number;
	durationFrames?: number;
}
```

---

## 3. GPU 3D Swarm & Shard Simulation: `Layer3D.swarm`

### Motivation
`Layer.particles` (`nodes/node-particles`) is a 2D screen-space particle system (`pos: vec2<f32>`). It does not know about `Camera3D`, 3D depth occlusion, 3D lighting, or 3D mesh orientations.
To simulate thousands of 3D shards and secondary sparks with real-time 3D forces, floor friction, angular tumbling, and velocity/contact-driven HDR emission inside the 3D scene pass, we introduce `Layer3D.swarm` (backed by `Swarm3DPipeline` in `packages/webgpu-renderers/src/renderer3d/swarm3d-pipeline.ts`).

### GPU State & Compute Simulation (`Swarm3DPipeline`)

#### Particle State Struct (`64 bytes` per 3D particle in `GPUBuffer`)
```wgsl
struct SwarmParticle3D {
	pos      : vec3<f32>, // world-space position (px, y down)
	age      : f32,       // seconds alive
	vel      : vec3<f32>, // world-space velocity (px/s)
	life     : f32,       // total lifetime (seconds; <= 0 means dead)
	quat     : vec4<f32>, // unit orientation quaternion
	angVel   : vec3<f32>, // angular velocity (rad/s)
	heat     : f32,       // smoothed kinetic/friction heat [0..1+]
	scale    : f32,       // size multiplier (with jitter)
	variant  : u32,       // mesh variant index (0..N-1) or spark flag (0xFFFFFFFFu)
	seed     : u32,       // per-particle deterministic random id
	contact  : f32,       // floor/surface contact factor [0..1] this step
};
```

#### Deterministic Stepping & Scrubbing Snapshots
Follows the proven architecture of `nodes/node-particles`:
- Steps forward on the GPU with `substeps` per frame (default `2`) and optional `prewarm` seconds before `startFrame`.
- Saves GPU buffer snapshots every `24` frames (`SNAPSHOT_EVERY = 24`, up to `64` snapshots) so scrubbing backward in preview or non-sequential frame rendering restores the nearest snapshot and replays at most 23 frames.

#### 3D Forces & Collision Solver in `SIM_3D_WGSL`
1. **Emitters (`emitter`)**:
   - Shapes in 3D: `"point"`, `"box"`, `"sphere"`, `"shell"`, `"ring"`, `"disc"`, `"cone"`.
   - Position `[x, y, z]` and `rate` accept `PhysicsDriver` (number, `Signal`, or `(frame) => number`) for moving 3D emitters and beat bursts.
2. **3D Curl Noise (`noise`)**:
   - True 3D divergence-free curl of a 3D FBM vector potential $\nabla \times \mathbf{\Psi}(\mathbf{p} / \text{scale} + \mathbf{v}_{\text{time}} t)$ for organic 3D turbulence.
3. **3D Attractors & Vortex / Swirl Fields (`attractors`, `vortex`)**:
   - Point/sphere attractors & repellers in 3D: `{ x, y, z, strength, radius }` (up to 8, drivers supported).
   - **3D Vortex / Orbit (`vortex`)**: `{ x, y, z, axis: [ax, ay, az], swirl, pull, axial, radius, falloff }`:
     - Tangential acceleration around `axis` (`swirl` px/s²), radial inward/outward pull toward the axis or center (`pull` px/s²), and axial lift (`axial` px/s²). This drives cohesive 3D cyclones, orbital streams, and sweeping swarms without hand-keyed paths.
4. **Floor Collision, Sliding Friction & Angular Tumble (`floor`)**:
   - Plane at `y = floor.y` (or arbitrary normal `[nx, ny, nz]`).
   - When `p.pos.y + radius > floor.y`:
     - Project out of floor; reflect normal velocity with `bounce` (restitution).
     - Apply Coulomb/exponential tangential **sliding friction**: $\mathbf{v}_{\parallel} \leftarrow \mathbf{v}_{\parallel} \cdot \exp(-\mu_{\text{friction}} \cdot \Delta t)$.
     - **Friction-induced torque**: sliding along the floor induces angular velocity $\boldsymbol{\omega} \leftarrow \boldsymbol{\omega} + (\hat{n} \times \mathbf{v}_{\parallel}) / r$, making shards physically roll and tumble when scraping the ground.
     - **Friction heat accumulation**: `p.heat` increases proportionally to $|\Delta \mathbf{v}_{\text{friction}}|$ and floor contact speed, and decays exponentially over `heatDecay` seconds (`p.heat *= exp(-dt / heatDecay)`).
5. **Performer 3D Silhouette Push (`push`)**:
   - Reuses `PersonTrack.silhouetteGrid(frame)` from `comp.vision`, pushing 3D particles within a configurable depth slab `zRange: [zMin, zMax]` away from the performer's 2D silhouette gradient and imparting `heat` on impact.
6. **Quaternion Integration**:
   - Updates `p.quat = normalize(p.quat + 0.5 * dt * quatMul(vec4(p.angVel, 0.0), p.quat))` with `angularDrag`.

#### Dual-Mode Rendering in `Renderer3D` (Shards + Secondary Sparks)
A `Layer3D.swarm` can render:
1. **3D Mesh Shards**: Instanced draw of `mesh` variants (default: 8 seeded `Layer3D.shard` geometries) using `Mesh3DPipeline`'s instanced path.
   - Base material uses scene lighting & `Layer.environment` PBR (`color`, `roughness`, `metallic`).
   - **Dynamic Emissive Modulation**: Each shard's emissive radiance is computed in the shader from:
     - `emissiveBySpeed`: ramps emissive color & HDR intensity by `length(p.vel) / maxSpeed`.
     - `emissiveByHeat`: ramps emissive color & HDR intensity by `p.heat` (floor friction + high-acceleration turns + vision push).
     - Color ramp supports multi-stop gradients (e.g. `["#1a161b", "#a8006b", "#ff1aff", "#ffffff"]` with `emissiveIntensity: 6`), feeding directly into `Renderer3D`'s HDR bloom attachment (`hdrTexture`).
2. **Secondary Friction / Trail Sparks (`sparks`)**:
   - Optional companion buffer (or partitioned tail of the particle buffer) spawned where parent shards have high `heat` or `contact > 0` (or high speed).
   - Rendered in the same 3D pass as camera-facing 3D capsules/streaks stretched along `cam.viewProjMatrix * vel`, depth-tested against the shards and writing into both display color and HDR bloom.

### Public SDK (`packages/framefields/src/swarm3d.ts`)
```ts
export interface Swarm3DOptions extends Surface3DOptions {
	id?: string;
	startFrame?: number;
	durationFrames?: number;
	/** Maximum 3D mesh particles alive at once (default 2000, up to 100000). */
	max?: number;
	seed?: number;
	/**
	 * Geometry drawn per particle:
	 * - `"shard"` (default: 8 procedural shard variants)
	 * - `{ type: "shard", variants?: number, facets?: number, irregularity?: number }`
	 * - `"sphere" | "roundedBox" | "cylinder"`
	 * - `AnimatableNode<Model3DNode> | Array<AnimatableNode<Model3DNode>>`
	 */
	mesh?:
		| "shard"
		| "sphere"
		| "roundedBox"
		| "cylinder"
		| { type: "shard"; variants?: number; facets?: number; irregularity?: number; bevel?: number }
		| AnimatableNode<Model3DNode>
		| Array<AnimatableNode<Model3DNode>>;
	/** Particle radius/scale in px at birth -> death (default [18, 12]). */
	size?: number | [number, number];
	sizeJitter?: number;
	fade?: [number, number];
	emitter?: {
		shape?: "point" | "box" | "sphere" | "shell" | "ring" | "disc";
		x?: PhysicsDriver;
		y?: PhysicsDriver;
		z?: PhysicsDriver;
		width?: number;
		height?: number;
		depth?: number;
		radius?: number;
		rate?: PhysicsDriver;
		bursts?: Array<{ frame: number; count: number }>;
	};
	lifetime?: number | [number, number];
	speed?: number | [number, number];
	direction?: [number, number, number];
	spread?: number;
	angularSpeed?: number | [number, number];
	angularDrag?: PhysicsDriver;
	gravity?: PhysicsDriver | [PhysicsDriver, PhysicsDriver, PhysicsDriver];
	drag?: PhysicsDriver;
	noise?: {
		strength?: PhysicsDriver;
		scale?: number;
		speed?: number;
	};
	attractors?: Array<{
		x: PhysicsDriver;
		y: PhysicsDriver;
		z: PhysicsDriver;
		strength: PhysicsDriver;
		radius?: number;
	}>;
	vortex?: {
		x?: PhysicsDriver;
		y?: PhysicsDriver;
		z?: PhysicsDriver;
		axis?: [number, number, number];
		/** Tangential swirl acceleration (px/s²). */
		swirl?: PhysicsDriver;
		/** Radial pull toward the vortex center/axis (px/s²). */
		pull?: PhysicsDriver;
		/** Axial acceleration along `axis` (px/s²). */
		axial?: PhysicsDriver;
		radius?: number;
	};
	push?: {
		person: PersonTrack;
		strength?: PhysicsDriver;
		sweep?: PhysicsDriver;
		zRange?: [number, number];
	};
	floor?: {
		y: number;
		bounce?: number;
		/** Sliding friction damping (0 = ice, 3 = rough stone). Default 1.5. */
		friction?: PhysicsDriver;
		/** How strongly floor scraping & sharp acceleration build up `heat`. Default 1.0. */
		heatGain?: number;
		/** Seconds for friction/acceleration heat to cool down. Default 0.45. */
		heatDecay?: number;
	};
	/** Base surface color (default "#232026"). */
	color?: string | string[];
	roughness?: number;
	metallic?: number;
	/** Dynamic HDR emission driven by particle speed and/or friction heat. */
	heat?: {
		/** Source driver: `"friction"` | `"speed"` | `"both"` (default `"both"`). */
		source?: "friction" | "speed" | "both";
		/** Speed (px/s) that reaches full heat=1 when source includes speed (default 900). */
		maxSpeed?: number;
		/** Emissive color ramp from cool (0) to hot (1). */
		color: string | string[];
		/** Peak HDR emissiveIntensity at heat = 1 (feeds bloom when > 2.5). Default 5.0. */
		intensity?: PhysicsDriver;
		/** Power curve shaping the heat ramp (default 1.6). */
		curve?: number;
	};
	/** Optional secondary fine sparks spawned from hot/scraping shards in 3D. */
	sparks?: {
		max?: number;
		rate?: number;
		/** Minimum shard heat [0..1] required to shed sparks (default 0.25). */
		threshold?: number;
		size?: number | [number, number];
		lifetime?: number | [number, number];
		speed?: number | [number, number];
		stretch?: number;
		color?: string | string[];
		intensity?: number;
	};
	substeps?: number;
	prewarm?: number;
}
```

---

## 4. Glossy Reflective Floor in `Renderer3D` (`Environment.floor`)

### Motivation
In 3D motion graphics and VFX shots (product stages, glowing shards on dark polished stone/acrylic, neon typography over wet ground), a glossy floor that reflects the 3D scene above it—especially bright HDR emissives—grounds the entire shot in 3D space.

### Design (`packages/webgpu-renderers/src/math3d/environment3d.ts` & `Renderer3D`)
Extend `Environment3DOptions` and `LightNode` (`lightType: "environment"`) with an optional `floor` configuration:

```ts
export interface Environment3DFloor {
	/** World Y coordinate of the floor plane (px, y down). */
	y: number;
	/** Base floor surface color (default "#08070a"). */
	color?: string;
	/** Mirror reflectivity at normal incidence / Fresnel scale, 0..1 (default 0.35). */
	reflectivity?: number;
	/** Surface roughness 0..1: controls anisotropic vertical/horizontal reflection blur (default 0.35). */
	roughness?: number;
	/** Reflection fade-out distance from the floor plane in world Y px (default 900). */
	fadeDistance?: number;
	/** Optional overall opacity of the floor plane, 0..1 (default 1; 0 draws only the additive reflection over background). */
	opacity?: number;
}
```

### Rendering Technique (Planar Reflection + Anisotropic Roughness Blur)
Why planar reflection instead of screen-space reflection (SSR)?
- In `Renderer3D`, the scene geometry (`pending3DItems`: meshes, quads, slugs, and `swarm` instances) is already collected in `flush3DPass`.
- SSR fails whenever an object near the floor occludes what is behind it or when camera pitch changes, and requires G-buffer normals.
- **Planar Reflection Pass** in `Renderer3D`:
  1. Construct the reflected `Camera3D` pose by mirroring `camera.eye` and `camera.target` across the horizontal plane $y = y_{\text{floor}}$ (and flipping the Y scale / winding or clipping vertices with $y > y_{\text{floor}}$ via a clip distance check in the shader).
  2. Render the reflected 3D items at **half resolution** (`width / 2`, `height / 2`) into a pooled temporary reflection texture (`rgba16float` when bloom/HDR is active, so HDR emissive shards reflect at full HDR radiance before tone mapping).
  3. Apply a **separable 2-pass roughness blur** (`FloorReflectionPipeline`) where vertical blur radius is stretched relative to horizontal blur ($\sigma_y \approx 3.5 \cdot \sigma_x \cdot \text{roughness}$), matching the physical elongated reflection lobes of a grazing-angle rough floor.
  4. Composite the floor plane in the 3D pass (or immediately before bloom) with Fresnel grazing boost and vertical distance attenuation $\exp(-\Delta y / \text{fadeDistance})$, writing into both display and `hdr` targets so hot reflections also bloom naturally.

---

## 5. Schema, Compiler & Lint Integration

To satisfy `CompositorProgramSchema` (`.strict()`) and all engine invariants:

1. **`packages/compositions/src/program/schema.ts`**:
   - Add `EnvironmentFloorSchema` to `LightNodeSchema` (`floor?: EnvironmentFloor`).
   - Extend `Model3DNodeSchema` with `instances3d?: unknown` and `swarm3d?: unknown` (similar to `primitive3d` and `text3dOptions`) so `comp.toSpec()` serializes and validates cleanly.
   - Add `"shard"` to `PrimitiveGeometryOptions` validation/types.
2. **`packages/compositions/src/program/lint.ts`**:
   - Warn if `Layer3D.swarm` uses `heat.intensity > 2.5` without an active `Layer.environment({ bloom: true })` when bloom is expected, or if `floor.y` is outside the camera frustum.
3. **`nodes/node-compositor/SKILL.md` & `plugins/framefields/skills/framefields-compose/SKILL.md`**:
   - Document `Layer3D.shard`, `Layer3D.instances`, `Layer3D.swarm`, and `Layer.environment(..., { floor })`.
   - Keep `packages/compositions/src/program/skillmd-check.test.ts` green.

---

## 6. Implementation Plan & Phases

### Phase 1: `Layer3D.shard` Procedural Geometry & Physics Collider
- **Files**:
  - `packages/webgpu-renderers/src/renderer3d/primitive-geometry.ts`
  - `packages/framefields/src/shapes3d.ts`
  - `packages/framefields/src/physics/world3d.ts`
- **Deliverables**:
  - Deterministic 3D half-space convex polyhedron clipper (`shard(o, mb)`).
  - Flat-faceted normals, UVs, centered bounds, and `getPrimitiveGeometry` caching.
  - `Layer3D.shard(options)` builder exported on `Layer3D`.
  - Unit & visual tests in `packages/webgpu-renderers/src/renderer3d/primitive-geometry.test.ts` verifying watertight convex geometry, outward normals, deterministic seed output, and Rapier `Physics.world3d` hull collision.

### Phase 2: Hardware-Instanced 3D Meshes (`Mesh3DPipeline` + `Layer3D.instances`)
- **Files**:
  - `packages/webgpu-renderers/src/shaders/mesh3d.ts`
  - `packages/webgpu-renderers/src/renderer3d/mesh3d-pipeline.ts`
  - `packages/webgpu-renderers/src/renderer3d/shadow-pipeline.ts`
  - `packages/webgpu-renderers/src/renderer3d/renderer3d.ts`
  - `packages/compositions/src/program/schema.ts`
  - `nodes/node-compositor/src/renderers/webgpu-renderer.ts`
  - `packages/framefields/src/shapes3d.ts`
- **Deliverables**:
  - Storage buffer `@group(1) @binding(4)` for per-instance `(posScale, quat, color, emissive)` in `mesh3d.wgsl` and shadow depth shader.
  - `r3d.drawMesh3DInstanced(...)` supporting multi-variant mesh buckets in 1 draw call per variant.
  - `Layer3D.instances({ mesh, count, bodies, instanceAt, emissiveBySpeed })`.
  - Unit & GPU render tests verifying 1,000 instanced shards with per-instance color/emissive and shadow casting.

### Phase 3: GPU 3D Swarm & Secondary Sparks (`Swarm3DPipeline` + `Layer3D.swarm`)
- **Files**:
  - `packages/webgpu-renderers/src/renderer3d/swarm3d-pipeline.ts` (new)
  - `packages/webgpu-renderers/src/renderer3d/renderer3d.ts`
  - `packages/compositions/src/program/schema.ts`
  - `nodes/node-compositor/src/renderers/webgpu-renderer.ts`
  - `packages/framefields/src/swarm3d.ts` (new)
  - `packages/framefields/src/index.ts`
- **Deliverables**:
  - WGSL 3D compute simulator (`SIM_3D_WGSL`): 3D emitters, 3D curl noise, 3D attractors, 3D vortex (`swirl`, `pull`, `axial`), floor plane collision with Coulomb sliding friction, friction-induced angular torque, heat accumulation/decay, and `comp.vision` silhouette push.
  - Snapshot ring (`SNAPSHOT_EVERY = 24`) for deterministic scrubbing.
  - Instanced 3D shard rendering with `heat` colour/emissive ramp into `Renderer3D`'s PBR + HDR bloom pass.
  - Secondary 3D spark emission and velocity-stretched 3D capsule rendering in the same pass.
  - Headless GPU tests verifying deterministic stepping, snapshot restore, floor friction heat buildup, and HDR bloom output.

### Phase 4: Glossy Floor Reflection (`Environment.floor`)
- **Files**:
  - `packages/webgpu-renderers/src/math3d/environment3d.ts`
  - `packages/webgpu-renderers/src/renderer3d/floor-reflection-pipeline.ts` (new)
  - `packages/webgpu-renderers/src/renderer3d/renderer3d.ts`
  - `packages/compositions/src/program/schema.ts`
  - `nodes/node-compositor/src/renderers/webgpu-renderer.ts`
- **Deliverables**:
  - Half-res mirrored-camera planar reflection pass in `Renderer3D` (clipped above `floor.y`).
  - Anisotropic vertical/horizontal roughness blur and Fresnel-weighted floor composite writing to both display and HDR bloom buffers.
  - GPU render tests verifying reflections of emissive 3D shards and bloom integration.

### Phase 5: Docs, Skills & End-to-End Verification
- **Files**:
  - `nodes/node-compositor/SKILL.md`
  - `plugins/framefields/skills/framefields-compose/SKILL.md`
- **Verification Ladder**:
  1. `tsc --noEmit -p .` across all modified packages.
  2. `CompositorProgramSchema.parse(comp.toSpec())` validation tests.
  3. Vitest unit and headless WebGPU tests (`pnpm --filter @framefields/webgpu-renderers test`, `pnpm --filter framefields test`).
  4. `renderFrame` & `renderFrameGrid` visual verification with pixel probes confirming shard facets, vortex motion, friction-driven HDR magenta/white emission, secondary sparks, and anisotropic floor reflections.
  5. `pnpm exec biome check --write` and `pnpm run check:plugins`.

