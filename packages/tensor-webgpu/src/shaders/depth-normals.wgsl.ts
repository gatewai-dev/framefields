/**
 * @file depth-normals.wgsl.ts
 * Screen-Space Normal Map Reconstruction from Depth Tensor
 * Analytical cross-product of spatial partial derivatives:
 * dP/dx = [1, 0, dD/dx]^T, dP/dy = [0, 1, dD/dy]^T
 * N = normalize(dP/dx x dP/dy) = normalize([-dx, -dy, 1.0])
 */

export const depthNormalsRgba16fWgsl = /* wgsl */ `
struct DepthNormalParams {
  width: u32,
  height: u32,
  depthScale: f32,
  _pad: f32,
};

@group(0) @binding(0) var depthTex: texture_2d<f32>;
@group(0) @binding(1) var normalTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: DepthNormalParams;

@compute @workgroup_size(16, 16)
fn computeNormals(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }

  let c = id.xy;
  let maxX = params.width - 1u;
  let maxY = params.height - 1u;

  let left  = textureLoad(depthTex, vec2<u32>(max(c.x - 1u, 0u), c.y), 0).r;
  let right = textureLoad(depthTex, vec2<u32>(min(c.x + 1u, maxX), c.y), 0).r;
  let up    = textureLoad(depthTex, vec2<u32>(c.x, max(c.y - 1u, 0u)), 0).r;
  let down  = textureLoad(depthTex, vec2<u32>(c.x, min(c.y + 1u, maxY)), 0).r;

  let dx = (right - left) * 0.5 * params.depthScale;
  let dy = (down - up) * 0.5 * params.depthScale;

  let normal = normalize(vec3<f32>(-dx, -dy, 1.0));
  // Pack [-1, 1] range to [0, 1]
  let packedColor = vec4<f32>(normal * 0.5 + 0.5, 1.0);
  textureStore(normalTex, id.xy, packedColor);
}
`;

export const depthNormalsRgba8Wgsl = /* wgsl */ `
struct DepthNormalParams {
  width: u32,
  height: u32,
  depthScale: f32,
  _pad: f32,
};

@group(0) @binding(0) var depthTex: texture_2d<f32>;
@group(0) @binding(1) var normalTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: DepthNormalParams;

@compute @workgroup_size(16, 16)
fn computeNormals(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }

  let c = id.xy;
  let maxX = params.width - 1u;
  let maxY = params.height - 1u;

  let left  = textureLoad(depthTex, vec2<u32>(max(c.x - 1u, 0u), c.y), 0).r;
  let right = textureLoad(depthTex, vec2<u32>(min(c.x + 1u, maxX), c.y), 0).r;
  let up    = textureLoad(depthTex, vec2<u32>(c.x, max(c.y - 1u, 0u)), 0).r;
  let down  = textureLoad(depthTex, vec2<u32>(c.x, min(c.y + 1u, maxY)), 0).r;

  let dx = (right - left) * 0.5 * params.depthScale;
  let dy = (down - up) * 0.5 * params.depthScale;

  let normal = normalize(vec3<f32>(-dx, -dy, 1.0));
  // Pack [-1, 1] range to [0, 1]
  let packedColor = vec4<f32>(normal * 0.5 + 0.5, 1.0);
  textureStore(normalTex, id.xy, packedColor);
}
`;
