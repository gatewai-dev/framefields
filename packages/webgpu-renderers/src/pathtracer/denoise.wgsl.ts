/**
 * Edge-avoiding à-trous wavelet filter (Dammertz et al. 2010) with the
 * variance-guided luminance weight of SVGF (Schied et al. 2017).
 *
 * Two signals per pixel are filtered with the same normal and depth guides:
 *  - lit radiance divided by its albedo, so texture stays sharp and only
 *    lighting noise is filtered (a luminance weight scaled by the estimated
 *    variance keeps real lighting edges);
 *  - what glass shows of the picture behind it, with the fraction of samples
 *    that were lit, so a refracting surface converges like any other.
 * Missed samples are never mixed in.
 */
import { ACCUM_VEC4 } from "./trace.wgsl.js";

export const DENOISE_PARAMS_BYTES = 16;
/** vec4s per pixel in the filter buffers: (demodulated radiance, variance), (shown color, lit fraction). */
export const DENOISE_VEC4 = 2;

export const denoiseWgsl = /* wgsl */ `
struct Params {
    size : vec2<u32>,
    step : u32,
    last : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> accum : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> src : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> dst : array<vec4<f32>>;
/** Per pixel: octahedral normal, mean view depth, flags (1 = lit samples, 2 = shown samples). */
@group(0) @binding(4) var<storage, read_write> guides : array<vec4<f32>>;

const ACC_VEC4 = ${ACCUM_VEC4}u;
const ALBEDO_FLOOR = 0.02;
const LIT = 1u;
const SHOWN = 2u;

fn lum(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn octEncode(n: vec3<f32>) -> vec2<f32> {
    let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
    if (n.z >= 0.0) {
        return p;
    }
    return (1.0 - abs(p.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), p >= vec2<f32>(0.0));
}
fn octDecode(e: vec2<f32>) -> vec3<f32> {
    var n = vec3<f32>(e, 1.0 - abs(e.x) - abs(e.y));
    let t = max(-n.z, 0.0);
    n = vec3<f32>(n.xy + select(vec2<f32>(t), vec2<f32>(-t), n.xy >= vec2<f32>(0.0)), n.z);
    return normalize(n);
}

fn albedoOf(i: u32) -> vec3<f32> {
    let covered = max(accum[i * ACC_VEC4].w + accum[i * ACC_VEC4 + 1u].w, 1e-6);
    return max(accum[i * ACC_VEC4 + 2u].rgb / covered, vec3<f32>(ALBEDO_FLOOR));
}

fn demodulated(i: u32) -> vec3<f32> {
    let a0 = accum[i * ACC_VEC4];
    return a0.rgb / max(a0.w, 1e-6) / albedoOf(i);
}

fn inside(q: vec2<i32>) -> bool {
    return q.x >= 0 && q.y >= 0 && q.x < i32(params.size.x) && q.y < i32(params.size.y);
}

/** Variance of a pixel's mean luminance: its own samples' spread, or its neighbours' with few samples. */
fn meanVariance(gid: vec2<u32>, i: u32, lit: f32) -> f32 {
    let a = lum(albedoOf(i));
    if (lit >= 4.0) {
        // Luminance is linear: the sum of the samples' luminances is that of their sum.
        let mean = lum(accum[i * ACC_VEC4].rgb) / lit;
        return max(0.0, accum[i * ACC_VEC4 + 2u].w / lit - mean * mean) / lit / (a * a);
    }
    var sum = 0.0;
    var sum2 = 0.0;
    var n = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let q = vec2<i32>(gid) + vec2<i32>(dx, dy);
            if (!inside(q)) {
                continue;
            }
            let j = u32(q.y) * params.size.x + u32(q.x);
            if (accum[j * ACC_VEC4].w <= 0.0) {
                continue;
            }
            let l = lum(demodulated(j));
            sum += l;
            sum2 += l * l;
            n += 1.0;
        }
    }
    let mean = sum / max(n, 1.0);
    return max(0.0, sum2 / max(n, 1.0) - mean * mean) / max(lit, 1.0);
}

/** The filter's inputs: demodulated radiance and its variance, shown color and lit fraction, and the guides. */
@compute @workgroup_size(8, 8, 1)
fn prepare(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.size.x || gid.y >= params.size.y) {
        return;
    }
    let i = gid.y * params.size.x + gid.x;
    let a0 = accum[i * ACC_VEC4];
    let a1 = accum[i * ACC_VEC4 + 1u];
    let a3 = accum[i * ACC_VEC4 + 3u];
    let lit = a0.w;
    let shown = a1.w;
    let covered = lit + shown;
    var variance = 0.0;
    if (lit > 0.0) {
        variance = meanVariance(gid.xy, i, lit);
    }
    dst[i * 2u] = vec4<f32>(demodulated(i), variance);
    dst[i * 2u + 1u] = vec4<f32>(a1.rgb / max(shown, 1e-6), lit / max(covered, 1e-6));
    let n = a3.xyz / max(length(a3.xyz), 1e-6);
    let flags = select(0u, LIT, lit > 0.0) | select(0u, SHOWN, shown > 0.0);
    guides[i] = vec4<f32>(octEncode(n), a3.w / max(covered, 1e-6), f32(flags));
}

const KERNEL = array<f32, 3>(0.375, 0.25, 0.0625);

/**
 * The variance around a pixel, blurred 3×3 (SVGF): one pixel's estimate from
 * a few samples is itself noisy, and an underestimate would keep an outlier.
 */
fn blurredVariance(p: vec2<u32>) -> f32 {
    var sum = 0.0;
    var wsum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let q = vec2<i32>(p) + vec2<i32>(dx, dy);
            if (!inside(q)) {
                continue;
            }
            let j = u32(q.y) * params.size.x + u32(q.x);
            if ((u32(guides[j].w) & LIT) == 0u) {
                continue;
            }
            let w = select(0.5, 0.25, dx != 0 && dy != 0) * select(1.0, 2.0, dx == 0 && dy == 0);
            sum += src[j * 2u].a * w;
            wsum += w;
        }
    }
    return max(sum / max(wsum, 1e-8), 0.0);
}

/** One à-trous pass at spacing params.step; the last pass multiplies the albedo back. */
@compute @workgroup_size(8, 8, 1)
fn atrous(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.size.x || gid.y >= params.size.y) {
        return;
    }
    let i = gid.y * params.size.x + gid.x;
    let centerLit = src[i * 2u];
    let centerShown = src[i * 2u + 1u];
    let g = guides[i];
    let flags = u32(g.w);
    if (flags == 0u) {
        dst[i * 2u] = centerLit;
        dst[i * 2u + 1u] = centerShown;
        return;
    }
    let normal = octDecode(g.xy);
    let depth = g.z;
    let centerIsLit = (flags & LIT) != 0u;
    let lc = lum(centerLit.rgb);
    let sigmaL = 4.0 * sqrt(blurredVariance(gid.xy)) + 1e-4;
    var lit = vec3<f32>(0.0);
    var litW = 0.0;
    var variance = 0.0;
    var shown = vec3<f32>(0.0);
    var shownW = 0.0;
    var fraction = 0.0;
    var geoW = 0.0;
    let step = i32(params.step);
    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
            let q = vec2<i32>(gid.xy) + vec2<i32>(dx, dy) * step;
            if (!inside(q)) {
                continue;
            }
            let j = u32(q.y) * params.size.x + u32(q.x);
            let gq = guides[j];
            let fq = u32(gq.w);
            if (fq == 0u) {
                continue;
            }
            let h = KERNEL[abs(dx)] * KERNEL[abs(dy)];
            let wn = pow(max(dot(normal, octDecode(gq.xy)), 0.0), 64.0);
            let wz = exp(-abs(depth - gq.z) / (0.02 * abs(depth) * f32(step) + 1.0));
            let geo = h * wn * wz;
            // Lit radiance: only from lit neighbours, kept apart across lighting
            // edges; a pixel without lit samples of its own borrows its neighbours'.
            if ((fq & LIT) != 0u) {
                let s = src[j * 2u];
                let edge = select(1.0, exp(-abs(lc - lum(s.rgb)) / sigmaL), centerIsLit);
                let w = geo * edge;
                lit += s.rgb * w;
                variance += s.a * w * w;
                litW += w;
            }
            // Shown color: only from neighbours that showed the backdrop.
            let sq = src[j * 2u + 1u];
            if ((fq & SHOWN) != 0u) {
                shown += sq.rgb * geo;
                shownW += geo;
            }
            fraction += sq.a * geo;
            geoW += geo;
        }
    }
    var outLit = centerLit;
    if (litW > 0.0) {
        outLit = vec4<f32>(lit / litW, variance / (litW * litW));
    }
    if (params.last != 0u) {
        outLit = vec4<f32>(outLit.rgb * albedoOf(i), outLit.a);
    }
    let outShown = select(centerShown.rgb, shown / max(shownW, 1e-8), shownW > 0.0);
    dst[i * 2u] = outLit;
    dst[i * 2u + 1u] = vec4<f32>(outShown, fraction / max(geoW, 1e-8));
}
`;
