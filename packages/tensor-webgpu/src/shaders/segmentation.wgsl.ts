/**
 * @file segmentation.wgsl.ts
 * Native WebGPU WGSL compute shader for segmentation mask thresholding and edge feathering.
 * Outputs crisp alpha mattes directly in VRAM without CPU roundtrips.
 */

export const segmentationWgsl = `
struct SegParams {
  threshold: f32,
  feather: f32,
  width: u32,
  height: u32,
};

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: SegParams;

@compute @workgroup_size(16, 16)
fn computeSegmentation(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let coord = vec2<i32>(i32(id.x), i32(id.y));
  let sample = textureLoad(inputTex, coord, 0);

  // Luminance or alpha channel extraction
  let rawAlpha = max(sample.a, dot(sample.rgb, vec3<f32>(0.299, 0.587, 0.114)));

  let lower = max(0.0, params.threshold - params.feather);
  let upper = min(1.0, params.threshold + params.feather);
  let alpha = smoothstep(lower, upper, rawAlpha);

  textureStore(outputTex, id.xy, vec4<f32>(alpha, alpha, alpha, 1.0));
}
`;
