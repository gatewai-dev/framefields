/**
 * @file pose-skeleton.wgsl.ts
 * Native WebGPU WGSL compute shader for ControlNet OpenPose skeleton rasterization.
 * Renders instanced bone cylinders/capsules directly in VRAM without CPU roundtrips.
 */

export const poseSkeletonWgsl = `
struct Bone {
  start: vec2<f32>,
  end: vec2<f32>,
  color: vec4<f32>,
  radius: f32,
  enabled: f32,
  pad: vec2<f32>,
};

struct SkeletonParams {
  width: u32,
  height: u32,
  numBones: u32,
  pad: u32,
  bones: array<Bone, 24>,
};

@group(0) @binding(0) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params: SkeletonParams;

@compute @workgroup_size(16, 16)
fn computePoseSkeleton(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let p = vec2<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5);
  var outColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);

  let count = min(params.numBones, 24u);
  for (var i = 0u; i < count; i = i + 1u) {
    let bone = params.bones[i];
    if (bone.enabled < 0.5) {
      continue;
    }

    let ab = bone.end - bone.start;
    let ap = p - bone.start;
    let l2 = dot(ab, ab);

    var t: f32 = 0.0;
    if (l2 > 0.0001) {
      t = clamp(dot(ap, ab) / l2, 0.0, 1.0);
    }

    let closest = bone.start + t * ab;
    let dist = length(p - closest);

    if (dist <= bone.radius) {
      // Sub-pixel edge antialiasing
      let edgeAlpha = clamp(bone.radius - dist + 0.5, 0.0, 1.0);
      let a = edgeAlpha * bone.color.a;
      outColor = vec4<f32>(mix(outColor.rgb, bone.color.rgb, a), max(outColor.a, a));
    }
  }

  textureStore(outputTex, id.xy, outColor);
}
`;
