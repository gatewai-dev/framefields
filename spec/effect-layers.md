# Specification: Effects on Non-Media Layers

**Status:** Proposed  
**Issue:** Resolves #4 ("Effects only work on media layers")  
**Target Packages:**
- `packages/compositions` (`canvas-composition.ts`, `to-virtual-media.ts`)
- `packages/node-sdk` (`renderer/index.ts`, `renderer/gpu.ts`)
- `nodes/node-compositor` (`webgpu-renderer.ts`)
- `packages/framefields` (tests & public API conformance)

---

## 1. Problem Statement

In Framefields, calling `.withEffect(effect)` or `.withEffects([...])` is exposed on all layer builders (`Layer.box`, `Layer.shape`, `Layer.text`, `Layer.media`) via `withAnimation()`. Furthermore, `BaseNodeFields` in `CompositorProgramSchema` accepts `effects: z.array(...)` for any layer type.

However, currently:
1. `to-virtual-media.ts` only converts `node.effects` into Virtual Media DAG nodes if `node.kind === "media"`.
2. For all non-media nodes (`box`, `flex`, `block`, `shape`, `text`), `node.effects` is retained only as an inert array on the `CompositorLayer` operation (`lop.effects`).
3. Inside `node-compositor/src/renderers/webgpu-renderer.ts`, the intermediate textures (`groupTex` for containers, `localTex` for text/shapes) only execute hardcoded routines for `TemporalDeflicker` and `Relight3D`. All 50+ general WebGPU effect nodes (e.g. `FilmGrain`, `Blur`, `Vignette`, `Pixelate`, `Curves`, `Bloom`, `LUT`, etc.) are silently ignored.

### Developer Consequence
Developers cannot apply effects directly to a styled backdrop, vector shape, kinetic text, or UI layout. They are forced into awkward workarounds, such as overlaying an extra image layer with soft-light blending, or manually rendering pre-baked video clips.

---

## 2. Architecture & Design

### 2.1 The Two Execution Models in Framefields

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. VirtualMedia DAG (High-Level Graph Pipeline)                        │
│    Orchestrated by HeadlessMediaRenderer & canvas-composition.ts       │
│    Nodes: node-film-grain, node-blur, node-vignette, etc.              │
│    Contract: childMedia = children[0]                                  │
│              { texture: tmpTex } = await drawChildToTexture(childMedia)│
│              outputs to args.targetView                                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ drawChild / TextureSource bridge
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. Compositor Node (Internal Monolithic WebGPU Renderer)               │
│    Evaluates Yoga layout, Slug typography, SDF shapes, and borders.    │
│    - Containers (box, flex, block) render into `groupTex`.             │
│    - Leaf primitives (shape, text) render into `localTex` / `finalTex`.│
└────────────────────────────────────────────────────────────────────────┘
```

Every standard effect node in Framefields expects an input child in `virtualMedia.children[0]` and calls `drawChildToTexture(args, childMedia)`. `drawChildToTexture` creates a temporary texture and invokes `args.drawChild(childMedia, ...)`.

### 2.2 The Solution: `TextureSource` Bridge

To allow any rendered texture inside `node-compositor` to be processed by arbitrary effect nodes without modifying all 50+ individual effect packages, we introduce a universal **`TextureSource`** virtual media operation.

1. **`TextureSource` Operation Definition:**
   A virtual media node holding an existing `GPUTexture`:
   ```typescript
   interface TextureSourceOp {
     op: "TextureSource";
     sourceTexture: GPUTexture;
     opacity?: number;
     dataType?: "Image";
   }
   ```

2. **Handling in `drawCompositionTree` (`packages/compositions/src/compositions/canvas-composition.ts`):**
   When `drawCompositionTree` encounters `op.op === "TextureSource"`, it renders `sourceTexture` directly into `targetView` using `ctx.renderer.drawTexture`:
   ```typescript
   if (op.op === "TextureSource") {
     const sourceTexture = op.sourceTexture as GPUTexture | undefined;
     if (sourceTexture) {
       ctx.renderer.drawTexture(
         renderArgs.pass,
         sourceTexture,
         { x: 0, y: 0, width: targetWidth, height: targetHeight },
         { opacity: Number(op.opacity ?? 1) },
       );
     }
     renderArgs.pass.end();
     return;
   }
   ```
   This operation is also registered in `webgpuRegistry` (`@framefields/node-sdk`) for uniform dispatch across render environments.

---

## 3. Pipeline Integration

### 3.1 Generic Effect Runner Helper

In `nodes/node-compositor/src/renderers/webgpu-renderer.ts`, we add `applyLayerEffects`:

```typescript
async function applyLayerEffects(
  effects: unknown[],
  sourceTex: GPUTexture,
  width: number,
  height: number,
  ctx: RenderContextValue,
  encoder: GPUCommandEncoder,
  props: NodeRenderProps,
  drawChild: WebGPUNodeRendererArgs["drawChild"],
  excludes: GPUTexture[],
  shiftedFrame: number,
  compositionFrame: number,
  fps: number,
  isVideoMode: boolean,
  layerId: string,
): Promise<{ texture: GPUTexture; view: GPUTextureView }>
```

#### Step-by-Step Execution:
1. Filter out effects already handled by dedicated inline pipelines (`TemporalDeflicker`, `Deflicker`, `Relight3D`).
2. If no remaining effects, return `{ texture: sourceTex, view: sourceTex.createView() }`.
3. Construct the virtual media effect chain:
   - Root child: `{ operation: { op: "TextureSource", sourceTexture: sourceTex } }`
   - Wrap iteratively for each effect `eff`:
     `currentMedia = { operation: { op: effOp.op, ...effOp }, children: [currentMedia] }`
4. Allocate temporary output texture:
   `const outTex = ctx.renderer.getTemporaryTexture(texW, texH, [sourceTex, ...excludes])`
5. Invoke `await drawChild(currentMedia, ..., outView, outTex, texW, texH)`.
6. Return `{ texture: outTex, view: outView }`.

### 3.2 Container Layers (`box`, `flex`, `block`)

1. **Bypass Guard:**
   Prevent transparent container bypass optimization when `lop.effects` has items:
   ```typescript
   if (
     (kind === "flex" || kind === "block") &&
     (!Array.isArray(lop.effects) || lop.effects.length === 0) &&
     ...
   )
   ```
2. **Post-Processing Pass:**
   In container rendering after background, children, border, deflicker, and relighting are drawn to `activeGroupTex`:
   ```typescript
   const postEffects = await applyLayerEffects(
     lop.effects,
     activeGroupTex,
     targetW,
     targetH,
     ctx,
     encoder,
     props,
     drawChild,
     [activeTex, targetTexture, ...excludes],
     shiftedFrame,
     compositionFrame,
     fps ?? 24,
     isVideoMode,
     lop.id ?? `container_${i}`,
   );
   activeGroupTex = postEffects.texture;
   activeGroupView = postEffects.view;
   ```
   `activeGroupTex` is then composited onto `destTex` using `ctx.renderer.composite`.

### 3.3 Leaf Primitives (`shape`, `text`)

1. In leaf rendering, after vector rasterization or text rendering, masking, deflicker, relighting, and motion blur are complete on `finalTex`:
   ```typescript
   if (kind !== "media" && Array.isArray(lop.effects) && lop.effects.length > 0) {
     const postEffects = await applyLayerEffects(
       lop.effects,
       finalTex,
       texW,
       texH,
       ctx,
       encoder,
       props,
       drawChild,
       [localTex, activeTex, targetTexture, ...excludes],
       shiftedFrame,
       compositionFrame,
       fps ?? 24,
       isVideoMode,
       lop.id ?? `leaf_${i}`,
     );
     finalTex = postEffects.texture;
   }
   ```
2. For `kind === "media"`, skip `applyLayerEffects` because media effects are already resolved and executed upstream by `drawChild(content)` at line 3349.

---

## 4. Edge Cases & Safeguards

1. **Texture Pool Exclusions:**
   `sourceTex` and `outTex` must be included in `excludeTextures` passed to `drawChild` to prevent intermediate effect passes (e.g. Gaussian blur's two passes or multi-tap shaders) from borrowing and overwriting textures currently in use.
2. **Scissor States:**
   When running `applyLayerEffects`, isolate local scissors to `{ x: 0, y: 0, width: texW, height: texH }` so parent layout scissors don't clip full-quad effect shaders.
3. **Signal & Animated Uniforms:**
   Effect properties wrapped in `lop.effects` can be `Signal` instances or dynamic frame functions. Passing `compositionFrame`, `frame`, `fps`, and `props.signals` into `drawChild` ensures `unwrapFrameParam` and `signalRegistry` evaluate identical values on non-media layers as they do on media layers.
4. **Zero Allocation overhead for layers without effects:**
   If `lop.effects` is empty or undefined, zero extra textures are allocated and zero additional passes are encoded.

---

## 5. Implementation Steps

1. **Step 1: Add `TextureSource` renderer**
   - Register `TextureSource` in [canvas-composition.ts](file:///Users/okanaslankan/frameshop/packages/compositions/src/compositions/canvas-composition.ts) and `@framefields/node-sdk`.
2. **Step 2: Add `applyLayerEffects` helper**
   - Implement `applyLayerEffects` in [webgpu-renderer.ts](file:///Users/okanaslankan/frameshop/nodes/node-compositor/src/renderers/webgpu-renderer.ts).
3. **Step 3: Wire containers and leaf primitives**
   - Guard container bypass optimization.
   - Run `applyLayerEffects` on `activeGroupTex` for containers.
   - Run `applyLayerEffects` on `finalTex` for shapes and text (skipping `media`).
4. **Step 4: Update Documentation**
   - Update [framefields-effects/SKILL.md](file:///Users/okanaslankan/frameshop/plugins/framefields/skills/framefields-effects/SKILL.md) to note that effects can now be directly attached to any layer (`box`, `flex`, `shape`, `text`, `media`).
5. **Step 5: Testing & Verification**
   - Add integration tests verifying `.withEffect()` on `Layer.box`, `Layer.shape`, and `Layer.text`.
   - Verify non-media layer with animated effect uniforms.
   - Run all package tests (`node-compositor`, `compositions`, `framefields`).
