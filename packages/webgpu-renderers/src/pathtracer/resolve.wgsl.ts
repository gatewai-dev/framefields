/**
 * Turns the accumulated samples into the 3D pass's two targets, as the
 * raster shading writes them: premultiplied display color (exposure, tone
 * mapping and the camera's fog), and premultiplied scene radiance for bloom.
 * Lit samples are tone mapped after averaging; unlit layers and the backdrop
 * seen through glass keep their display colors. A trace smaller than the
 * target (a preview's resolution scale) is filtered bilinearly.
 */
import { lighting3dWgsl, lightsBindingsWgsl } from "../shaders/lighting3d.js";
import { ACCUM_VEC4 } from "./trace.wgsl.js";

export const RESOLVE_PARAMS_BYTES = 16;

export const resolveWgsl = /* wgsl */ `
${lighting3dWgsl}
${lightsBindingsWgsl}
@group(1) @binding(0) var<uniform> cam : CameraUniforms;

struct Params {
    size : vec2<u32>,
    denoised : u32,
    samples : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> accum : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> filtered : array<vec4<f32>>;

const ACC_VEC4 = ${ACCUM_VEC4}u;

struct Pixel {
    /** Premultiplied display color (sRGB encoded) and coverage. */
    color : vec4<f32>,
    /** Premultiplied scene radiance for bloom. */
    hdr : vec4<f32>,
};

/** The camera's distance fog at a trace pixel whose surfaces lie at a mean view depth. */
fn fogAt(x: u32, y: u32, depth: f32) -> f32 {
    if (lights.fog.w < 0.5) {
        return 0.0;
    }
    let uv = (vec2<f32>(f32(x), f32(y)) + 0.5) / vec2<f32>(params.size);
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let n4 = cam.invViewProjMatrix * vec4<f32>(ndc, 0.0, 1.0);
    let f4 = cam.invViewProjMatrix * vec4<f32>(ndc, 1.0, 1.0);
    let d = normalize(f4.xyz / f4.w - n4.xyz / n4.w);
    let dist = depth / max(dot(d, cam.cameraDir.xyz), 1e-4);
    return smoothstep(lights.fogRange.x, max(lights.fogRange.y, lights.fogRange.x + 1.0), dist) * lights.fogRange.z;
}

fn pixel(x: u32, y: u32) -> Pixel {
    let i = y * params.size.x + x;
    let a0 = accum[i * ACC_VEC4];
    let a1 = accum[i * ACC_VEC4 + 1u];
    let a3 = accum[i * ACC_VEC4 + 3u];
    let n = max(f32(params.samples), 1.0);
    let nLit = a0.w;
    let nShown = a1.w;
    let covered = nLit + nShown;
    var out: Pixel;
    if (covered <= 0.0) {
        return out;
    }
    var radiance = a0.rgb / max(nLit, 1e-6);
    var shownDisplay = a1.rgb / max(nShown, 1e-6);
    var litFraction = nLit / covered;
    if (params.denoised != 0u) {
        radiance = filtered[i * 2u].rgb;
        let f = filtered[i * 2u + 1u];
        shownDisplay = f.rgb;
        litFraction = f.a;
    }
    let fog = fogAt(x, y, a3.w / covered);
    var lit = toneMap(max(radiance, vec3<f32>(0.0)));
    var shown = srgbToLinear(shownDisplay);
    if (lights.fog.w > 0.5) {
        lit = mix(lit, lights.fog.rgb, fog);
        shown = mix(shown, lights.fog.rgb, fog);
    }
    let display = mix(shown, lit, litFraction);
    let alpha = covered / n;
    out.color = vec4<f32>(linearToSrgb(display) * alpha, alpha);
    let hdr = radiance * max(lights.ambientLinear.w, 1.0) * (1.0 - fog) * litFraction * alpha;
    out.hdr = vec4<f32>(hdr, litFraction * alpha);
    return out;
}

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VsOut;
    out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(p.x, 1.0 - p.y);
    return out;
}

fn sampleAt(uv: vec2<f32>) -> Pixel {
    let size = vec2<f32>(params.size);
    let p = clamp(uv * size - 0.5, vec2<f32>(0.0), size - 1.0);
    let p0 = vec2<u32>(floor(p));
    let p1 = min(p0 + 1u, params.size - 1u);
    let f = p - floor(p);
    let a = pixel(p0.x, p0.y);
    let b = pixel(p1.x, p0.y);
    let c = pixel(p0.x, p1.y);
    let d = pixel(p1.x, p1.y);
    var out: Pixel;
    out.color = mix(mix(a.color, b.color, f.x), mix(c.color, d.color, f.x), f.y);
    out.hdr = mix(mix(a.hdr, b.hdr, f.x), mix(c.hdr, d.hdr, f.x), f.y);
    return out;
}

fn resolveAt(pos: vec4<f32>, uv: vec2<f32>) -> Pixel {
    let targetSize = vec2<f32>(cam.screenParams.xy);
    if (all(vec2<u32>(targetSize) == params.size)) {
        return pixel(u32(pos.x), u32(pos.y));
    }
    return sampleAt(pos.xy / targetSize);
}

@fragment
fn fs_color(in: VsOut) -> @location(0) vec4<f32> {
    return resolveAt(in.pos, in.uv).color;
}

struct BloomOut {
    @location(0) color : vec4<f32>,
    @location(1) hdr : vec4<f32>,
};

@fragment
fn fs_bloom(in: VsOut) -> BloomOut {
    let p = resolveAt(in.pos, in.uv);
    return BloomOut(p.color, p.hdr);
}
`;
