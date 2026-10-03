/**
 * @file letterbox-resize.wgsl.ts
 * High-performance WebGPU compute shader for hardware-accelerated YOLO letterbox pre-processing.
 * Converts input RGBA GPUTexture into a normalized [0, 1] planar NCHW Float32 storage buffer.
 */

export const letterboxResizeWgsl = /* wgsl */ `
struct LetterboxParams {
  sourceWidth: u32,
  sourceHeight: u32,
  imgsz: u32,
  padDw: u32,
  padDh: u32,
  scale: f32,
  padValue: f32, // constant 114.0 / 255.0 ≈ 0.44705882
};

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBuffer: array<f32>;
@group(0) @binding(2) var<uniform> params: LetterboxParams;

@compute @workgroup_size(16, 16)
fn computeLetterbox(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.imgsz || id.y >= params.imgsz) {
    return;
  }

  let ox = id.x;
  let oy = id.y;
  let imgsz = params.imgsz;
  let planeSize = imgsz * imgsz;

  let dw = params.padDw;
  let dh = params.padDh;
  let rw = u32(f32(params.sourceWidth) * params.scale + 0.5);
  let rh = u32(f32(params.sourceHeight) * params.scale + 0.5);

  var r: f32 = params.padValue;
  var g: f32 = params.padValue;
  var b: f32 = params.padValue;

  if (ox >= dw && ox < dw + rw && oy >= dh && oy < dh + rh) {
    let sx = clamp(i32(f32(ox - dw) / params.scale), 0, i32(params.sourceWidth) - 1);
    let sy = clamp(i32(f32(oy - dh) / params.scale), 0, i32(params.sourceHeight) - 1);
    let pixel = textureLoad(inputTex, vec2<i32>(sx, sy), 0);
    r = pixel.r;
    g = pixel.g;
    b = pixel.b;
  }

  let pixelIdx = oy * imgsz + ox;
  outputBuffer[pixelIdx] = r;
  outputBuffer[planeSize + pixelIdx] = g;
  outputBuffer[2u * planeSize + pixelIdx] = b;
}
`;
