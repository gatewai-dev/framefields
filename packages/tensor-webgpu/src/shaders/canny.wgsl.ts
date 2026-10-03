/**
 * @file canny.wgsl.ts
 * High-performance WebGPU Canny Edge Compute Shaders
 * Pass 1: Sobel gradient magnitude & quantized angle
 * Pass 2: Non-Maximum Suppression (NMS) & Dual-Threshold Hysteresis
 */

export const cannySobelWgsl = /* wgsl */ `
struct CannyParams {
  lowThreshold: f32,
  highThreshold: f32,
  width: u32,
  height: u32,
};

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var magnitudeTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: CannyParams;

fn getLuma(coord: vec2<i32>, maxCoord: vec2<i32>) -> f32 {
  let clamped = clamp(coord, vec2<i32>(0), maxCoord);
  let c = textureLoad(inputTex, clamped, 0);
  return dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
}

@compute @workgroup_size(16, 16)
fn computeSobel(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }

  let x = i32(id.x);
  let y = i32(id.y);
  let maxCoord = vec2<i32>(i32(params.width) - 1, i32(params.height) - 1);

  let p00 = getLuma(vec2<i32>(x - 1, y - 1), maxCoord);
  let p10 = getLuma(vec2<i32>(x,     y - 1), maxCoord);
  let p20 = getLuma(vec2<i32>(x + 1, y - 1), maxCoord);
  let p01 = getLuma(vec2<i32>(x - 1, y),     maxCoord);
  let p21 = getLuma(vec2<i32>(x + 1, y),     maxCoord);
  let p02 = getLuma(vec2<i32>(x - 1, y + 1), maxCoord);
  let p12 = getLuma(vec2<i32>(x,     y + 1), maxCoord);
  let p22 = getLuma(vec2<i32>(x + 1, y + 1), maxCoord);

  let gx = (p20 + 2.0 * p21 + p22) - (p00 + 2.0 * p01 + p02);
  let gy = (p02 + 2.0 * p12 + p22) - (p00 + 2.0 * p10 + p20);

  let mag = sqrt(gx * gx + gy * gy);
  let angle = atan2(gy, gx);

  // Quantize angle into 4 sectors (0: 0 deg, 1: 45 deg, 2: 90 deg, 3: 135 deg)
  var sector: f32 = 0.0;
  let a = (angle * 180.0 / 3.14159265 + 180.0) % 180.0;
  if ((a >= 0.0 && a < 22.5) || (a >= 157.5 && a <= 180.0)) {
    sector = 0.0;
  } else if (a >= 22.5 && a < 67.5) {
    sector = 1.0;
  } else if (a >= 67.5 && a < 112.5) {
    sector = 2.0;
  } else {
    sector = 3.0;
  }

  textureStore(magnitudeTex, id.xy, vec4<f32>(mag, sector, 0.0, 1.0));
}
`;

export const cannyNmsRgba8Wgsl = /* wgsl */ `
struct CannyParams {
  lowThreshold: f32,
  highThreshold: f32,
  width: u32,
  height: u32,
};

@group(0) @binding(0) var magnitudeTex: texture_2d<f32>;
@group(0) @binding(1) var edgeTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: CannyParams;

@compute @workgroup_size(16, 16)
fn computeNonMaxSuppression(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }

  let x = i32(id.x);
  let y = i32(id.y);
  let maxCoord = vec2<i32>(i32(params.width) - 1, i32(params.height) - 1);

  let center = textureLoad(magnitudeTex, vec2<i32>(x, y), 0);
  let mag = center.r;
  let sector = u32(round(center.g));

  var n1 = 0.0;
  var n2 = 0.0;

  switch (sector) {
    case 0u: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x - 1, y), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x + 1, y), vec2<i32>(0), maxCoord), 0).r;
    }
    case 1u: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x + 1, y - 1), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x - 1, y + 1), vec2<i32>(0), maxCoord), 0).r;
    }
    case 2u: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x, y - 1), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x, y + 1), vec2<i32>(0), maxCoord), 0).r;
    }
    default: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x - 1, y - 1), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x + 1, y + 1), vec2<i32>(0), maxCoord), 0).r;
    }
  }

  var edge = 0.0;
  // Non-maximum suppression along gradient sector with directional tie-breaking
  if (mag > n1 && mag >= n2 && mag > 0.0) {
    if (mag >= params.highThreshold) {
      edge = 1.0;
    } else if (mag >= params.lowThreshold) {
      edge = 0.5;
    }
  }

  textureStore(edgeTex, id.xy, vec4<f32>(edge, edge, edge, 1.0));
}
`;

export const cannyNmsR32fWgsl = /* wgsl */ `
struct CannyParams {
  lowThreshold: f32,
  highThreshold: f32,
  width: u32,
  height: u32,
};

@group(0) @binding(0) var magnitudeTex: texture_2d<f32>;
@group(0) @binding(1) var edgeTex: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> params: CannyParams;

@compute @workgroup_size(16, 16)
fn computeNonMaxSuppression(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= params.height) { return; }

  let x = i32(id.x);
  let y = i32(id.y);
  let maxCoord = vec2<i32>(i32(params.width) - 1, i32(params.height) - 1);

  let center = textureLoad(magnitudeTex, vec2<i32>(x, y), 0);
  let mag = center.r;
  let sector = u32(round(center.g));

  var n1 = 0.0;
  var n2 = 0.0;

  switch (sector) {
    case 0u: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x - 1, y), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x + 1, y), vec2<i32>(0), maxCoord), 0).r;
    }
    case 1u: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x + 1, y - 1), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x - 1, y + 1), vec2<i32>(0), maxCoord), 0).r;
    }
    case 2u: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x, y - 1), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x, y + 1), vec2<i32>(0), maxCoord), 0).r;
    }
    default: {
      n1 = textureLoad(magnitudeTex, clamp(vec2<i32>(x - 1, y - 1), vec2<i32>(0), maxCoord), 0).r;
      n2 = textureLoad(magnitudeTex, clamp(vec2<i32>(x + 1, y + 1), vec2<i32>(0), maxCoord), 0).r;
    }
  }

  var edge = 0.0;
  // Non-maximum suppression along gradient sector with directional tie-breaking
  if (mag > n1 && mag >= n2 && mag > 0.0) {
    if (mag >= params.highThreshold) {
      edge = 1.0;
    } else if (mag >= params.lowThreshold) {
      edge = 0.5;
    }
  }

  textureStore(edgeTex, id.xy, vec4<f32>(edge, 0.0, 0.0, 1.0));
}
`;
