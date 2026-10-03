/**
 * @file temporal-warp-blend.wgsl.ts
 * Native WebGPU Forward Warping & Adaptive Photometric Temporal Blend Compute Shaders
 * Warps previous frame forward along motion vectors and blends adaptively with current
 * frame to eliminate generative AI video flicker with zero ghosting.
 */

export const temporalWarpBlendRgba8Wgsl = /* wgsl */ `
struct WarpBlendParams {
  width: u32,
  height: u32,
  blendWeight: f32,            // Base current frame weight alpha (e.g. 0.35)
  disocclusionThreshold: f32,  // Photometric error cutoff for fallback to curr frame
  maxMotionPixels: f32,        // Speed cutoff for fallback to curr frame
  isFirstFrame: f32,           // 1.0 = pass-through first frame, 0.0 = temporal blend
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var currTex: texture_2d<f32>;
@group(0) @binding(2) var flowTex: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params: WarpBlendParams;
@group(0) @binding(5) var bilinearSamp: sampler;

@compute @workgroup_size(16, 16)
fn warpBlend(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let coord = vec2<i32>(i32(id.x), i32(id.y));
  let currColor = textureLoad(currTex, coord, 0);

  // If first frame or scene cut reset, pass through current frame directly
  if (params.isFirstFrame > 0.5) {
    textureStore(outTex, id.xy, currColor);
    return;
  }

  let dims = vec2<f32>(f32(params.width), f32(params.height));
  let invDims = vec2<f32>(1.0 / dims.x, 1.0 / dims.y);
  let uv = (vec2<f32>(id.xy) + 0.5) * invDims;

  // Read motion vector (u, v) in pixel units
  let flowSample = textureLoad(flowTex, coord, 0);
  let flow = flowSample.xy;
  let speed = length(flow);

  // Motion-compensated backward warp coordinate pointing to previous frame
  let warpedUv = clamp(uv - flow * invDims, vec2<f32>(0.0), vec2<f32>(1.0));
  let warpedPrev = textureSampleLevel(prevTex, bilinearSamp, warpedUv, 0.0);

  // Photometric consistency error normalized to [0, 1] range (1 / sqrt(3) ~= 0.57735027)
  let colorDiff = length(currColor.rgb - warpedPrev.rgb) * 0.57735027;

  // Adaptive blend weight:
  // - Coherent motion (low diff, low speed): alpha = blendWeight (strong deflicker smoothing)
  // - Disocclusion or extreme motion (high diff): alpha -> 1.0 (fall back to curr frame, no ghosting)
  let tLow = params.disocclusionThreshold;
  let tHigh = params.disocclusionThreshold * 1.5;
  let errFactor = smoothstep(tLow, tHigh, colorDiff);
  let speedFactor = smoothstep(params.maxMotionPixels * 0.5, params.maxMotionPixels, speed);

  let fallbackFactor = max(errFactor, speedFactor);
  let alpha = clamp(mix(params.blendWeight, 1.0, fallbackFactor), 0.0, 1.0);

  let blendedRgb = mix(warpedPrev.rgb, currColor.rgb, alpha);
  let blendedA = mix(warpedPrev.a, currColor.a, alpha);

  textureStore(outTex, id.xy, vec4<f32>(blendedRgb, blendedA));
}
`;

export const temporalWarpBlendRgba16fWgsl = /* wgsl */ `
struct WarpBlendParams {
  width: u32,
  height: u32,
  blendWeight: f32,
  disocclusionThreshold: f32,
  maxMotionPixels: f32,
  isFirstFrame: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var currTex: texture_2d<f32>;
@group(0) @binding(2) var flowTex: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: WarpBlendParams;
@group(0) @binding(5) var bilinearSamp: sampler;

@compute @workgroup_size(16, 16)
fn warpBlend(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let coord = vec2<i32>(i32(id.x), i32(id.y));
  let currColor = textureLoad(currTex, coord, 0);

  if (params.isFirstFrame > 0.5) {
    textureStore(outTex, id.xy, currColor);
    return;
  }

  let dims = vec2<f32>(f32(params.width), f32(params.height));
  let invDims = vec2<f32>(1.0 / dims.x, 1.0 / dims.y);
  let uv = (vec2<f32>(id.xy) + 0.5) * invDims;

  let flowSample = textureLoad(flowTex, coord, 0);
  let flow = flowSample.xy;
  let speed = length(flow);

  let warpedUv = clamp(uv - flow * invDims, vec2<f32>(0.0), vec2<f32>(1.0));
  let warpedPrev = textureSampleLevel(prevTex, bilinearSamp, warpedUv, 0.0);

  // Photometric consistency error normalized to [0, 1] range (1 / sqrt(3) ~= 0.57735027)
  let colorDiff = length(currColor.rgb - warpedPrev.rgb) * 0.57735027;

  let tLow = params.disocclusionThreshold;
  let tHigh = params.disocclusionThreshold * 1.5;
  let errFactor = smoothstep(tLow, tHigh, colorDiff);
  let speedFactor = smoothstep(params.maxMotionPixels * 0.5, params.maxMotionPixels, speed);

  let fallbackFactor = max(errFactor, speedFactor);
  let alpha = clamp(mix(params.blendWeight, 1.0, fallbackFactor), 0.0, 1.0);

  let blendedRgb = mix(warpedPrev.rgb, currColor.rgb, alpha);
  let blendedA = mix(warpedPrev.a, currColor.a, alpha);

  textureStore(outTex, id.xy, vec4<f32>(blendedRgb, blendedA));
}
`;
