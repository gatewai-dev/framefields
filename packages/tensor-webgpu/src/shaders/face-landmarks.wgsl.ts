/**
 * @file face-landmarks.wgsl.ts
 * Native WebGPU WGSL compute shader for ControlNet Face & MediaPipe facial contour rasterization.
 * Renders antialiased facial mesh contours (lips, eyes, brows, nose, oval) directly in VRAM for SDXL ControlNet.
 */

export const faceLandmarksWgsl = `
struct FaceSegment {
  start: vec2<f32>,
  end: vec2<f32>,
  color: vec4<f32>,
  radius: f32,
  enabled: f32,
  pad: vec2<f32>,
};

struct FaceParams {
  width: u32,
  height: u32,
  numSegments: u32,
  pad: u32,
};

@group(0) @binding(0) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> params: FaceParams;
@group(0) @binding(2) var<storage, read> segments: array<FaceSegment>;

@compute @workgroup_size(16, 16)
fn computeFaceLandmarks(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let p = vec2<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5);
  var outColor = vec4<f32>(0.0, 0.0, 0.0, 1.0); // Solid black background for SDXL ControlNet

  let count = params.numSegments;
  for (var i = 0u; i < count; i = i + 1u) {
    let seg = segments[i];
    if (seg.enabled < 0.5) {
      continue;
    }

    let ab = seg.end - seg.start;
    let ap = p - seg.start;
    let l2 = dot(ab, ab);

    var t: f32 = 0.0;
    if (l2 > 0.0001) {
      t = clamp(dot(ap, ab) / l2, 0.0, 1.0);
    }

    let closest = seg.start + t * ab;
    let dist = length(p - closest);

    if (dist <= seg.radius) {
      let edgeAlpha = clamp(seg.radius - dist + 0.5, 0.0, 1.0);
      outColor = vec4<f32>(mix(outColor.rgb, seg.color.rgb, edgeAlpha * seg.color.a), 1.0);
    }
  }

  textureStore(outputTex, id.xy, outColor);
}
`;
