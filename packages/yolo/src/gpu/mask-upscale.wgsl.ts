/**
 * @file mask-upscale.wgsl.ts
 * High-performance WebGPU compute shader for GPU-native instance mask upscaling.
 * Computes weighted sum of 32 proto channels with continuous sigmoid soft alpha
 * and feathering directly into a VRAM mask texture.
 */

export const maskUpscaleWgsl = /* wgsl */ `
struct MaskParams {
  maskWidth: u32,
  maskHeight: u32,
  protoDim: u32,
  imgsz: u32,
  padDw: u32,
  padDh: u32,
  scale: f32,
  maskThreshold: f32,
  featherRadius: f32,
};

@group(0) @binding(0) var<storage, read> protoBuffer: array<f32>;
@group(0) @binding(1) var<storage, read> coeffsBuffer: array<f32>;
@group(0) @binding(2) var outputMask: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params: MaskParams;

@compute @workgroup_size(16, 16)
fn computeMaskUpscale(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.maskWidth || id.y >= params.maskHeight) {
    return;
  }

  let mx = f32(id.x);
  let my = f32(id.y);

  // Map source coordinate through letterbox into proto space [0, protoDim]
  let lx = mx * params.scale + f32(params.padDw);
  let ly = my * params.scale + f32(params.padDh);

  let px = (lx / f32(params.imgsz)) * f32(params.protoDim);
  let py = (ly / f32(params.imgsz)) * f32(params.protoDim);

  let protoDimI = i32(params.protoDim);
  let x0 = clamp(i32(floor(px)), 0, protoDimI - 1);
  let y0 = clamp(i32(floor(py)), 0, protoDimI - 1);
  let x1 = clamp(x0 + 1, 0, protoDimI - 1);
  let y1 = clamp(y0 + 1, 0, protoDimI - 1);

  let fx = px - f32(x0);
  let fy = py - f32(y0);

  let w00 = (1.0 - fx) * (1.0 - fy);
  let w10 = fx * (1.0 - fy);
  let w01 = (1.0 - fx) * fy;
  let w11 = fx * fy;

  let planeStride = params.protoDim * params.protoDim;
  var acc: f32 = 0.0;

  for (var c: u32 = 0u; c < 32u; c = c + 1u) {
    let planeOffset = c * planeStride;
    let idx00 = planeOffset + u32(y0) * params.protoDim + u32(x0);
    let idx10 = planeOffset + u32(y0) * params.protoDim + u32(x1);
    let idx01 = planeOffset + u32(y1) * params.protoDim + u32(x0);
    let idx11 = planeOffset + u32(y1) * params.protoDim + u32(x1);

    let v00 = protoBuffer[idx00];
    let v10 = protoBuffer[idx10];
    let v01 = protoBuffer[idx01];
    let v11 = protoBuffer[idx11];

    let interpolated = w00 * v00 + w10 * v10 + w01 * v01 + w11 * v11;
    acc = acc + coeffsBuffer[c] * interpolated;
  }

  // Sigmoid activation
  let alpha = 1.0 / (1.0 + exp(-acc));

  // Anti-aliased feathering
  let feather = max(0.001, params.featherRadius);
  let lowBound = params.maskThreshold - feather;
  let val = clamp((alpha - lowBound) / (2.0 * feather), 0.0, 1.0);

  textureStore(
    outputMask,
    vec2<i32>(i32(id.x), i32(id.y)),
    vec4<f32>(val, val, val, val)
  );
}
`;
