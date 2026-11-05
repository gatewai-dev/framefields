/**
 * Shutter motion blur from a velocity buffer: McGuire, Hennessy, Bukowski
 * and Osman, "A Reconstruction Filter for Plausible Motion Blur" (I3D 2012).
 *
 * 1. Tile max: the dominant motion in each K×K tile (K = the longest blur).
 * 2. Neighbor max: the dominant motion among each tile's 3×3 neighbors, so a
 *    fast object blurs over the background next to it.
 * 3. Reconstruction: each pixel gathers samples along its neighborhood's
 *    motion; a sample counts when it is in front and its blur reaches here,
 *    or level / behind and this pixel's blur reaches it (else the pixel's
 *    own color stands in), so moving edges smear over a sharp background
 *    and a still foreground stays sharp. Normalized per sample rather than
 *    by McGuire's cone weights: uniform motion gives the exact ramp.
 *
 * Velocity texels: rg = motion since the previous frame (px), b = linear
 * depth, a = coverage (0 = empty: infinitely far, still).
 */
export const motionBlurWgsl = /* wgsl */ `
struct Params {
    size      : vec2<f32>, // target, px
    tiles     : vec2<f32>, // tile grid
    shutter   : f32,       // half the exposure as a fraction of the frame interval
    maxRadius : f32,       // K: the longest blur from a pixel, px
    samples   : f32,
    softZ     : f32,       // depth softness, scene px
};

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var velocityTex : texture_2d<f32>;
@group(0) @binding(2) var tileTex : texture_2d<f32>;
@group(0) @binding(3) var colorTex : texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}

/** Blur half-extent at a texel: the motion over half the exposure, at most K. */
fn blurAt(texel: vec4<f32>) -> vec2<f32> {
    let v = texel.xy * P.shutter * texel.a;
    let len = length(v);
    return select(v, v * (P.maxRadius / len), len > P.maxRadius);
}

fn depthAt(texel: vec4<f32>) -> f32 {
    return select(1e9, texel.b, texel.a > 0.5);
}

@fragment
fn fs_tile_max(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let k = i32(P.maxRadius);
    let origin = vec2<i32>(pos.xy) * k;
    let limit = vec2<i32>(P.size) - 1;
    var best = vec2<f32>(0.0);
    var bestLen = 0.0;
    for (var y = 0; y < k; y++) {
        for (var x = 0; x < k; x++) {
            let at = min(origin + vec2<i32>(x, y), limit);
            let v = blurAt(textureLoad(velocityTex, at, 0));
            let len = dot(v, v);
            if (len > bestLen) {
                best = v;
                bestLen = len;
            }
        }
    }
    return vec4<f32>(best, 0.0, 1.0);
}

@fragment
fn fs_neighbor_max(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let tile = vec2<i32>(pos.xy);
    let limit = vec2<i32>(P.tiles) - 1;
    var best = vec2<f32>(0.0);
    var bestLen = 0.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let at = clamp(tile + vec2<i32>(x, y), vec2<i32>(0), limit);
            let v = textureLoad(tileTex, at, 0).xy;
            let len = dot(v, v);
            if (len > bestLen) {
                best = v;
                bestLen = len;
            }
        }
    }
    return vec4<f32>(best, 0.0, 1.0);
}

/** Whether a blur of half-extent len (px) reaches distance d, antialiased over a pixel. */
fn reaches(d: f32, len: f32) -> f32 {
    return clamp(len - d + 0.5, 0.0, 1.0);
}

/** 1 where depth a is in front of depth b, fading over softZ. */
fn inFront(a: f32, b: f32) -> f32 {
    return clamp(1.0 - (a - b) / P.softZ, 0.0, 1.0);
}

/** Interleaved gradient noise (Jimenez): a deterministic per-pixel jitter. */
fn ign(p: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

@fragment
fn fs_reconstruct(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = vec2<i32>(pos.xy);
    let limit = vec2<i32>(P.size) - 1;
    let cX = textureLoad(colorTex, px, 0);
    let tile = min(px / i32(P.maxRadius), vec2<i32>(P.tiles) - 1);
    let vn = textureLoad(tileTex, tile, 0).xy;
    if (length(vn) <= 0.5) {
        return cX;
    }
    let texX = textureLoad(velocityTex, px, 0);
    let lenX = length(blurAt(texX));
    let zX = depthAt(texX);

    let n = i32(P.samples);
    var sum = cX;
    let jitter = ign(pos.xy) - 0.5;
    for (var i = 0; i < n; i++) {
        let t = mix(-1.0, 1.0, (f32(i) + jitter + 1.0) / f32(n + 1));
        let offset = vn * t;
        let py = clamp(vec2<i32>(floor(pos.xy + offset)), vec2<i32>(0), limit);
        let texY = textureLoad(velocityTex, py, 0);
        let lenY = length(blurAt(texY));
        let d = length(offset);
        // Over the exposure, this pixel shows Y's surface when Y is in front
        // and Y's blur reaches here, or when Y is level or behind and this
        // pixel's own blur reaches Y; otherwise its own color. Uniform
        // motion comes out exact: a linear ramp the length of the streak.
        let f = inFront(depthAt(texY), zX);
        let w = f * reaches(d, lenY) + (1.0 - f) * reaches(d, lenX);
        sum += mix(cX, textureLoad(colorTex, py, 0), w);
    }
    return sum / f32(n + 1);
}
`;
