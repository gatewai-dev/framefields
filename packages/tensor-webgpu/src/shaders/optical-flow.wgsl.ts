/**
 * @file optical-flow.wgsl.ts
 * High-Performance Native WebGPU Optical Flow Compute Shaders
 * Implements coarse-to-fine Lucas-Kanade motion vector estimation with
 * spatial structure tensor integration and Tikhonov aperture regularization.
 */

export const opticalFlowDirectWgsl = /* wgsl */ `
struct FlowParams {
  width: u32,
  height: u32,
  windowSize: u32,       // Half-window radius W (e.g. 2 for 5x5 window)
  regularization: f32,   // Tikhonov regularization lambda
  maxDisplacement: f32,  // Maximum allowable flow vector length
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var currTex: texture_2d<f32>;
@group(0) @binding(2) var flowTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: FlowParams;

fn rgbToLuminance(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}

fn sampleLuma(tex: texture_2d<f32>, coord: vec2<i32>) -> f32 {
  let inDims = vec2<f32>(textureDimensions(tex));
  let scaleRatio = inDims / vec2<f32>(f32(params.width), f32(params.height));
  let actualCoord = vec2<i32>(vec2<f32>(coord) * scaleRatio);
  let clamped = clamp(actualCoord, vec2<i32>(0, 0), vec2<i32>(inDims) - vec2<i32>(1, 1));
  let color = textureLoad(tex, clamped, 0);
  return rgbToLuminance(color.rgb);
}

@compute @workgroup_size(16, 16)
fn computeFlow(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let centerCoord = vec2<i32>(i32(id.x), i32(id.y));
  let w = i32(max(params.windowSize, 1u));

  var sxx: f32 = 0.0;
  var syy: f32 = 0.0;
  var sxy: f32 = 0.0;
  var sxt: f32 = 0.0;
  var syt: f32 = 0.0;

  for (var dy = -w; dy <= w; dy = dy + 1) {
    for (var dx = -w; dx <= w; dx = dx + 1) {
      let p = centerCoord + vec2<i32>(dx, dy);

      // Central difference spatial gradients on current frame
      let lx = sampleLuma(currTex, p - vec2<i32>(1, 0));
      let rx = sampleLuma(currTex, p + vec2<i32>(1, 0));
      let uy = sampleLuma(currTex, p - vec2<i32>(0, 1));
      let dyL = sampleLuma(currTex, p + vec2<i32>(0, 1));

      let ix = (rx - lx) * 0.5;
      let iy = (dyL - uy) * 0.5;

      // Temporal gradient: difference between current and previous frame
      let cCurr = sampleLuma(currTex, p);
      let cPrev = sampleLuma(prevTex, p);
      let it = cCurr - cPrev;

      // Gaussian spatial falloff weight
      let distSq = f32(dx * dx + dy * dy);
      let weight = exp(-distSq / (2.0 * f32(w * w) + 0.1));

      sxx += ix * ix * weight;
      syy += iy * iy * weight;
      sxy += ix * iy * weight;
      sxt += ix * it * weight;
      syt += iy * it * weight;
    }
  }

  // Tikhonov regularization prevents singularity in flat/homogeneous regions
  let trace = sxx + syy;
  let reg = max(params.regularization, 1e-4) * max(trace, 1.0);
  let A = sxx + reg;
  let B = sxy;
  let C = syy + reg;

  let det = A * C - B * B;
  var u: f32 = 0.0;
  var v: f32 = 0.0;

  if (det > 1e-6) {
    u = (-sxt * C + syt * B) / det;
    v = (-syt * A + sxt * B) / det;
  }

  let mag = length(vec2<f32>(u, v));
  let maxD = max(params.maxDisplacement, 1.0);
  if (mag > maxD) {
    let scale = maxD / mag;
    u *= scale;
    v *= scale;
  }

  textureStore(flowTex, id.xy, vec4<f32>(u, v, min(mag, maxD), 1.0));
}
`;

export const opticalFlowRefineWgsl = /* wgsl */ `
struct FlowParams {
  width: u32,
  height: u32,
  windowSize: u32,
  regularization: f32,
  maxDisplacement: f32,
  coarseWidth: u32,
  coarseHeight: u32,
  _pad0: f32,
};

@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var currTex: texture_2d<f32>;
@group(0) @binding(2) var coarseFlowTex: texture_2d<f32>;
@group(0) @binding(3) var fineFlowTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: FlowParams;
@group(0) @binding(5) var bilinearSamp: sampler;

fn rgbToLuminance(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
}

fn sampleLuma(tex: texture_2d<f32>, coord: vec2<i32>) -> f32 {
  let clamped = clamp(coord, vec2<i32>(0, 0), vec2<i32>(i32(params.width) - 1, i32(params.height) - 1));
  let color = textureLoad(tex, clamped, 0);
  return rgbToLuminance(color.rgb);
}

fn sampleWarpedPrevLuma(uv: vec2<f32>, priorFlow: vec2<f32>) -> f32 {
  let invDims = vec2<f32>(1.0 / f32(params.width), 1.0 / f32(params.height));
  let warpedUv = clamp(uv - priorFlow * invDims, vec2<f32>(0.0), vec2<f32>(1.0));
  let sampleColor = textureSampleLevel(prevTex, bilinearSamp, warpedUv, 0.0);
  return rgbToLuminance(sampleColor.rgb);
}

@compute @workgroup_size(16, 16)
fn refineFlow(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let centerCoord = vec2<i32>(i32(id.x), i32(id.y));
  let w = i32(max(params.windowSize, 1u));
  let invDims = vec2<f32>(1.0 / f32(params.width), 1.0 / f32(params.height));
  let centerUv = (vec2<f32>(id.xy) + 0.5) * invDims;

  // Read upsampled prior flow from coarse scale (scaled by 2x)
  let coarseCoord = vec2<i32>(centerCoord / 2);
  let coarseSample = textureLoad(coarseFlowTex, coarseCoord, 0);
  let priorFlow = coarseSample.xy * 2.0;

  var sxx: f32 = 0.0;
  var syy: f32 = 0.0;
  var sxy: f32 = 0.0;
  var sxt: f32 = 0.0;
  var syt: f32 = 0.0;

  for (var dy = -w; dy <= w; dy = dy + 1) {
    for (var dx = -w; dx <= w; dx = dx + 1) {
      let p = centerCoord + vec2<i32>(dx, dy);
      let pUv = (vec2<f32>(p) + 0.5) * invDims;

      let lx = sampleLuma(currTex, p - vec2<i32>(1, 0));
      let rx = sampleLuma(currTex, p + vec2<i32>(1, 0));
      let uy = sampleLuma(currTex, p - vec2<i32>(0, 1));
      let dyL = sampleLuma(currTex, p + vec2<i32>(0, 1));

      let ix = (rx - lx) * 0.5;
      let iy = (dyL - uy) * 0.5;

      // Temporal residual against warped previous frame
      let cCurr = sampleLuma(currTex, p);
      let cWarpedPrev = sampleWarpedPrevLuma(pUv, priorFlow);
      let it = cCurr - cWarpedPrev;

      let distSq = f32(dx * dx + dy * dy);
      let weight = exp(-distSq / (2.0 * f32(w * w) + 0.1));

      sxx += ix * ix * weight;
      syy += iy * iy * weight;
      sxy += ix * iy * weight;
      sxt += ix * it * weight;
      syt += iy * it * weight;
    }
  }

  let trace = sxx + syy;
  let reg = max(params.regularization, 1e-4) * max(trace, 1.0);
  let A = sxx + reg;
  let B = sxy;
  let C = syy + reg;

  let det = A * C - B * B;
  var du: f32 = 0.0;
  var dv: f32 = 0.0;

  if (det > 1e-6) {
    du = (-sxt * C + syt * B) / det;
    dv = (-syt * A + sxt * B) / det;
  }

  // Combine coarse prior flow with fine residual flow
  var totalFlow = priorFlow + vec2<f32>(du, dv);
  let mag = length(totalFlow);
  let maxD = max(params.maxDisplacement, 1.0);
  if (mag > maxD) {
    totalFlow *= (maxD / mag);
  }

  textureStore(fineFlowTex, id.xy, vec4<f32>(totalFlow.x, totalFlow.y, min(mag, maxD), 1.0));
}
`;
