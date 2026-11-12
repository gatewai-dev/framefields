/**
 * The path tracing kernel: one camera path per pixel per dispatch, added
 * into a per-pixel accumulation buffer.
 *
 * Scene light is the raster renderer's own (`lighting3dWgsl`): the same
 * lights uniform, direct-light records, environment (procedural gradient
 * and softboxes, or a prefiltered HDRI cube at mip 0), exposure and tone
 * mapping, so a scene looks like itself with and without `pathTrace`, minus
 * the approximations: shadows, reflections, occlusion and bounce light are
 * traced instead of mapped or screen-space.
 *
 * Owen-scrambled Sobol sampling (Burley 2020, "Practical Hash-based Owen
 * Scrambling") and the watertight ray/triangle test (Woop et al. 2013, as in
 * pbrt-v4) follow MuTracer's WGSL (https://github.com/pissang/mutracer, MIT;
 * pbrt-v4 Apache-2.0). See NOTICE.md.
 */
import { lighting3dWgsl, lightsBindingsWgsl } from "../shaders/lighting3d.js";
import { BVH_MAX_DEPTH } from "./bvh.js";
import { ENV_TABLE_HEADER } from "./env-importance.js";
import { TRIANGLE_FLOATS } from "./geometry.js";

/** vec4s per instance record (see `packInstance`). */
export const INSTANCE_VEC4 = 7;
/** vec4s per material record (see `packMaterial`). */
export const MATERIAL_VEC4 = 14;
/** vec4s per pixel in the accumulation buffer. */
export const ACCUM_VEC4 = 4;
/** Bytes of the trace parameters uniform. */
export const TRACE_PARAMS_BYTES = 128;

/** Instance flags. */
export const INSTANCE_CASTS_SHADOW = 1;
export const INSTANCE_ONE_SIDED = 2;

/** Material flags (vec4 5, w). */
export const MAT_QUAD = 1;
export const MAT_BASE_TEX = 2;
export const MAT_MR_TEX = 4;
export const MAT_EMISSIVE_TEX = 8;
export const MAT_NORMAL_TEX = 16;
export const MAT_ALPHA = 32;
export const MAT_UNLIT = 64;
export const MAT_GLASS = 128;
/** Back faces show (and emit) too. */
export const MAT_TWO_SIDED = 256;

/** Trace flags (params.flags). */
export const TRACE_ENV_TABLE = 1;
export const TRACE_FLOOR = 2;
export const TRACE_BACKDROP = 4;

export const traceWgsl = /* wgsl */ `
${lighting3dWgsl}
${lightsBindingsWgsl}
@group(1) @binding(0) var<uniform> cam : CameraUniforms;

struct TraceParams {
    size          : vec2<u32>,
    origin        : vec2<u32>,
    tileSize      : vec2<u32>,
    sampleIndex   : u32,
    seed          : u32,
    maxBounces    : u32,
    flags         : u32,
    lightCount    : u32,
    instanceCount : u32,
    clampIndirect : f32,
    lensRadius    : f32,
    focusDistance : f32,
    rrDepth       : u32,
    floorColor    : vec4<f32>, // rgb linear albedo, w = roughness
    floorParams   : vec4<f32>, // x = y, y = reflectivity, z = fade distance, w = opacity
    /** Where the instance tree starts in \`nodes\`. */
    tlasOffset    : u32,
    emitterCount  : u32,
    /** Sum over emitters of world area × emission luminance. */
    emitterPower  : f32,
    /**
     * Path regularization: after a path scatters diffusely, the surfaces it
     * meets are at least this rough (0 = off, unbiased).
     */
    filterGlossy  : f32,
    /** Passes through or off glass a path may take, apart from \`maxBounces\`. */
    maxTransmission : u32,
    _pad0         : u32,
    _pad1         : u32,
    _pad2         : u32,
};

@group(0) @binding(0) var<uniform> pt : TraceParams;
@group(0) @binding(1) var<storage, read> nodes : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> tris : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> instances : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> materials : array<vec4<f32>>;
@group(0) @binding(5) var atlas : texture_2d_array<f32>;
@group(0) @binding(6) var atlasSampler : sampler;
@group(0) @binding(7) var<storage, read> envTable : array<f32>;
@group(0) @binding(8) var<storage, read_write> accum : array<vec4<f32>>;
@group(0) @binding(9) var backdrop : texture_2d<f32>;
/** Emissive triangles: (instance slot, triangle slot) as bits, cumulative probability, probability. */
@group(0) @binding(10) var<storage, read> emitters : array<vec4<f32>>;

const MISS = 1e30;
const NO_INSTANCE = 0xffffffffu;
const FLOOR_INSTANCE = 0xfffffffeu;
const TRI_VEC4 = ${TRIANGLE_FLOATS / 4}u;
const INST_VEC4 = ${INSTANCE_VEC4}u;
const MAT_VEC4 = ${MATERIAL_VEC4}u;
const ACC_VEC4 = ${ACCUM_VEC4}u;
const ENV_HEADER = ${ENV_TABLE_HEADER}u;
const STACK_SIZE = ${BVH_MAX_DEPTH}u;

// ── Sampling: Owen-scrambled Sobol (Burley 2020) ────────────────────────

var<private> sPixel : u32;
var<private> sIndex : u32;
var<private> sDim : u32;

fn hashU32(v: u32) -> u32 {
    var x = v;
    x ^= x >> 16u; x *= 0x7feb352du;
    x ^= x >> 15u; x *= 0x846ca68bu;
    return x ^ (x >> 16u);
}
fn hashSeed(a: u32, b: u32) -> u32 {
    return hashU32(a ^ hashU32(b + 0x9e3779b9u));
}
fn lkPermute(v: u32, seed: u32) -> u32 {
    var x = v + seed;
    x ^= x * 0x6c50b47cu; x ^= x * 0xb82f1e52u;
    x ^= x * 0xc7afe638u; x ^= x * 0x8d22f6e6u;
    return x;
}
fn owen(x: u32, seed: u32) -> u32 {
    return reverseBits(lkPermute(reverseBits(x), seed));
}
// Sobol dimension 1 of index i (dimension 0 is reverseBits(i)).
fn sobolD1(v: u32) -> u32 {
    var r = reverseBits(v);
    r ^= (r << 1u) & 0xaaaaaaaau;
    r ^= (r << 2u) & 0xccccccccu;
    r ^= (r << 4u) & 0xf0f0f0f0u;
    r ^= (r << 8u) & 0xff00ff00u;
    r ^= (r << 16u) & 0xffff0000u;
    return r;
}
fn sobol2D(index: u32, seed: u32) -> vec2<f32> {
    let i = owen(index, hashSeed(seed, 0u));
    let x = reverseBits(lkPermute(i, hashSeed(seed, 1u)));
    let y = owen(sobolD1(i), hashSeed(seed, 2u));
    return min(vec2<f32>(f32(x >> 8u), f32(y >> 8u)) * (1.0 / 16777216.0), vec2<f32>(0.99999994));
}
/** The next 2D domain of this pixel's sample: each call is its own scrambled sequence. */
fn next2D() -> vec2<f32> {
    let seed = hashSeed(hashSeed(sPixel, sDim), pt.seed);
    sDim += 1u;
    return sobol2D(sIndex, seed);
}
/** A hashed number for decisions whose count varies (alpha tests). */
fn hashed01(a: u32, b: u32) -> f32 {
    return f32(hashSeed(hashSeed(sPixel, sIndex ^ pt.seed), hashSeed(a, b)) >> 8u) * (1.0 / 16777216.0);
}

// ── Records ─────────────────────────────────────────────────────────────

fn mat(m: u32, k: u32) -> vec4<f32> {
    return materials[m * MAT_VEC4 + k];
}
fn matFlags(m: u32) -> u32 {
    return bitcast<u32>(materials[m * MAT_VEC4 + 5u].w);
}
fn instWord(i: u32) -> vec4<u32> {
    return bitcast<vec4<u32>>(instances[i * INST_VEC4 + 6u]);
}
fn toObjectPoint(i: u32, p: vec3<f32>) -> vec3<f32> {
    let b = i * INST_VEC4 + 3u;
    let r0 = instances[b]; let r1 = instances[b + 1u]; let r2 = instances[b + 2u];
    return vec3<f32>(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
}
fn toObjectDir(i: u32, d: vec3<f32>) -> vec3<f32> {
    let b = i * INST_VEC4 + 3u;
    return vec3<f32>(dot(instances[b].xyz, d), dot(instances[b + 1u].xyz, d), dot(instances[b + 2u].xyz, d));
}
fn toWorldPoint(i: u32, p: vec3<f32>) -> vec3<f32> {
    let b = i * INST_VEC4;
    let r0 = instances[b]; let r1 = instances[b + 1u]; let r2 = instances[b + 2u];
    return vec3<f32>(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
}
/** Normals transform by the inverse transpose: the object-from-world rows, transposed. */
fn toWorldNormal(i: u32, n: vec3<f32>) -> vec3<f32> {
    let b = i * INST_VEC4 + 3u;
    return normalize(instances[b].xyz * n.x + instances[b + 1u].xyz * n.y + instances[b + 2u].xyz * n.z);
}

// ── Atlas ───────────────────────────────────────────────────────────────

fn wrapUv(uv: vec2<f32>, mode: f32) -> vec2<f32> {
    if (mode > 1.5) {
        let t = abs(fract(uv * 0.5) * 2.0 - 1.0);
        return 1.0 - t;
    }
    if (mode > 0.5) {
        return fract(uv);
    }
    return clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
}
fn atlasTexel(rect: vec4<f32>, layer: f32, mode: f32, uv: vec2<f32>) -> vec4<f32> {
    let a = rect.xy + wrapUv(uv, mode) * rect.zw;
    return textureSampleLevel(atlas, atlasSampler, a, i32(layer), 0.0);
}

// ── Intersection ────────────────────────────────────────────────────────

struct Hit {
    t : f32,
    inst : u32,
    tri : u32,
    bary : vec2<f32>,
};

fn boxEntry(o: vec3<f32>, invD: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>, tMax: f32) -> f32 {
    let t0 = (bmin - o) * invD;
    let t1 = (bmax - o) * invD;
    let tn = min(t0, t1);
    let tf = max(t0, t1);
    let near = max(max(tn.x, tn.y), max(tn.z, 0.0));
    let far = min(min(tf.x, tf.y), min(tf.z, tMax));
    return select(MISS, near, near <= far);
}

fn safeInverse(d: vec3<f32>) -> vec3<f32> {
    let tiny = select(vec3<f32>(1e-20), vec3<f32>(-1e-20), d < vec3<f32>(0.0));
    return 1.0 / select(d, tiny, abs(d) < vec3<f32>(1e-20));
}

/** The axis permutation and shear of the watertight test, per ray. */
struct RayShear {
    k : u32,
    s : vec3<f32>,
};

fn permute(v: vec3<f32>, k: u32) -> vec3<f32> {
    if (k == 0u) { return v.yzx; }
    if (k == 1u) { return v.zxy; }
    return v;
}

fn rayShear(d: vec3<f32>) -> RayShear {
    let a = abs(d);
    var k = 2u;
    if (a.x > a.y && a.x > a.z) { k = 0u; } else if (a.y > a.z) { k = 1u; }
    let p = permute(d, k);
    return RayShear(k, vec3<f32>(-p.x / p.z, -p.y / p.z, 1.0 / p.z));
}

/** Watertight ray/triangle (Woop, Benthin, Wald 2013): x = t, yz = barycentrics of p1, p2. */
fn intersectTriangle(o: vec3<f32>, sh: RayShear, slot: u32, tMax: f32) -> vec3<f32> {
    let base = slot * TRI_VEC4;
    var p0 = permute(tris[base].xyz - o, sh.k);
    var p1 = permute(tris[base + 1u].xyz - o, sh.k);
    var p2 = permute(tris[base + 2u].xyz - o, sh.k);
    p0 = vec3<f32>(p0.xy + sh.s.xy * p0.z, p0.z);
    p1 = vec3<f32>(p1.xy + sh.s.xy * p1.z, p1.z);
    p2 = vec3<f32>(p2.xy + sh.s.xy * p2.z, p2.z);
    let e0 = p1.x * p2.y - p1.y * p2.x;
    let e1 = p2.x * p0.y - p2.y * p0.x;
    let e2 = p0.x * p1.y - p0.y * p1.x;
    if ((e0 < 0.0 || e1 < 0.0 || e2 < 0.0) && (e0 > 0.0 || e1 > 0.0 || e2 > 0.0)) {
        return vec3<f32>(MISS, 0.0, 0.0);
    }
    let det = e0 + e1 + e2;
    if (det == 0.0) {
        return vec3<f32>(MISS, 0.0, 0.0);
    }
    let ts = (e0 * p0.z + e1 * p1.z + e2 * p2.z) * sh.s.z;
    if ((det < 0.0 && (ts >= 0.0 || ts < tMax * det)) || (det > 0.0 && (ts <= 0.0 || ts > tMax * det))) {
        return vec3<f32>(MISS, 0.0, 0.0);
    }
    let inv = 1.0 / det;
    return vec3<f32>(ts * inv, e1 * inv, e2 * inv);
}

fn triUv(slot: u32, bary: vec2<f32>) -> vec2<f32> {
    let b = slot * TRI_VEC4;
    let uv0 = vec2<f32>(tris[b].w, tris[b + 1u].w);
    let uv1 = vec2<f32>(tris[b + 2u].w, tris[b + 3u].w);
    let uv2 = vec2<f32>(tris[b + 4u].w, tris[b + 5u].w);
    return uv0 * (1.0 - bary.x - bary.y) + uv1 * bary.x + uv2 * bary.y;
}

/** Signed distance to a rounded rectangle of half size h and corner radius r. */
fn roundRect(p: vec2<f32>, h: vec2<f32>, r: f32) -> f32 {
    let rr = min(r, min(h.x, h.y));
    let q = abs(p) - h + rr;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - rr;
}

/**
 * Coverage of a surface point 0..1: a layer's texture alpha inside its
 * rounded rectangle, opacity, and glTF alpha masks.
 */
fn surfaceAlpha(m: u32, uv: vec2<f32>) -> f32 {
    let flags = matFlags(m);
    var alpha = mat(m, 0u).a;
    if ((flags & ${MAT_QUAD}u) != 0u) {
        let dims = mat(m, 10u);
        let local = (uv - 0.5) * dims.xy;
        if (dims.x > 0.0 && roundRect(local, dims.xy * 0.5, dims.z) > 0.0) {
            return 0.0;
        }
    }
    if ((flags & ${MAT_BASE_TEX}u) != 0u) {
        let t = mat(m, 7u);
        let texUv = select(uv, uv * mat(m, 12u).xy, (flags & ${MAT_QUAD}u) != 0u);
        alpha *= atlasTexel(mat(m, 6u), t.x, t.y, texUv).a;
    }
    let cutoff = mat(m, 5u).z;
    if (cutoff > 0.0) {
        return select(0.0, 1.0, alpha >= cutoff);
    }
    return alpha;
}

/**
 * Camera rays see partial coverage exactly (the raster's alpha), weighting
 * the surface by it and continuing behind it; every other ray tests coverage
 * stochastically, which converges to the same light.
 */
var<private> exactAlpha : bool;

/** Whether a candidate hit counts: coverage tests stochastically against a per-surface number. */
fn acceptHit(inst: u32, m: u32, slot: u32, bary: vec2<f32>, o: vec3<f32>, d: vec3<f32>) -> bool {
    let w = instWord(inst);
    if ((w.w & ${INSTANCE_ONE_SIDED}u) != 0u) {
        let b = slot * TRI_VEC4 + 3u;
        let n = tris[b].xyz * (1.0 - bary.x - bary.y) + tris[b + 1u].xyz * bary.x + tris[b + 2u].xyz * bary.y;
        if (dot(n, d) > 0.0) {
            return false;
        }
    }
    if ((matFlags(m) & ${MAT_ALPHA}u) == 0u) {
        return true;
    }
    let alpha = surfaceAlpha(m, triUv(slot, bary));
    return alpha > 0.0 && (alpha >= 1.0 || exactAlpha || hashed01(inst * 7919u + slot, sDim) < alpha);
}

var<private> blasStack : array<u32, STACK_SIZE>;
var<private> tlasStack : array<u32, STACK_SIZE>;

/** Walks one instance's tree in object space; t is shared with world space (unnormalized direction). */
fn traceInstance(inst: u32, wo: vec3<f32>, wd: vec3<f32>, best: ptr<function, Hit>, anyHit: bool) -> bool {
    let w = instWord(inst);
    let nodeBase = w.x;
    let triBase = w.y;
    let m = w.z;
    let o = toObjectPoint(inst, wo);
    let d = toObjectDir(inst, wd);
    let invD = safeInverse(d);
    let sh = rayShear(d);
    if (boxEntry(o, invD, nodes[nodeBase * 2u].xyz, nodes[nodeBase * 2u + 1u].xyz, (*best).t) >= MISS) {
        return false;
    }
    var found = false;
    var sp = 0u;
    var node = 0u;
    loop {
        let a = nodes[(nodeBase + node) * 2u];
        let b = nodes[(nodeBase + node) * 2u + 1u];
        let first = bitcast<u32>(a.w);
        let count = bitcast<u32>(b.w);
        if (count > 0u) {
            for (var s = first; s < first + count; s++) {
                let r = intersectTriangle(o, sh, triBase + s, (*best).t);
                if (r.x < (*best).t && acceptHit(inst, m, triBase + s, r.yz, o, d)) {
                    (*best).t = r.x;
                    (*best).inst = inst;
                    (*best).tri = triBase + s;
                    (*best).bary = r.yz;
                    found = true;
                    if (anyHit) { return true; }
                }
            }
            if (sp == 0u) { break; }
            sp -= 1u;
            node = blasStack[sp];
            continue;
        }
        var near = first;
        var far = first + 1u;
        let n0 = nodes[(nodeBase + near) * 2u];
        let n1 = nodes[(nodeBase + near) * 2u + 1u];
        let f0 = nodes[(nodeBase + far) * 2u];
        let f1 = nodes[(nodeBase + far) * 2u + 1u];
        var dNear = boxEntry(o, invD, n0.xyz, n1.xyz, (*best).t);
        var dFar = boxEntry(o, invD, f0.xyz, f1.xyz, (*best).t);
        if (dFar < dNear) {
            let tn = near; near = far; far = tn;
            let td = dNear; dNear = dFar; dFar = td;
        }
        if (dNear >= MISS) {
            if (sp == 0u) { break; }
            sp -= 1u;
            node = blasStack[sp];
            continue;
        }
        node = near;
        if (dFar < MISS) {
            blasStack[sp] = far;
            sp += 1u;
        }
    }
    return found;
}

/** The floor plane (y down: its surface faces -y) as a hit, faded like the raster floor. */
/** The floor's coverage where the closest hit found it (camera rays read it exactly). */
fn floorCoverage(p: vec3<f32>) -> f32 {
    let toCam = cam.cameraPos.xyz - p;
    let dist = length(toCam);
    let fadeDist = max(pt.floorParams.z, 1.0);
    let f = clamp(1.0 - dist / (fadeDist * 2.2), 0.0, 1.0);
    let horizon = smoothstep(0.015, 0.14, max(0.0, -toCam.y / max(dist, 1e-4)));
    return pt.floorParams.w * f * f * (3.0 - 2.0 * f) * horizon;
}

fn traceFloor(o: vec3<f32>, d: vec3<f32>, best: ptr<function, Hit>) {
    if ((pt.flags & ${TRACE_FLOOR}u) == 0u || d.y <= 1e-6 || o.y >= pt.floorParams.x) {
        return;
    }
    let t = (pt.floorParams.x - o.y) / d.y;
    if (t <= 0.0 || t >= (*best).t) {
        return;
    }
    let coverage = floorCoverage(o + d * t);
    if (coverage <= 0.0 || (coverage < 1.0 && !exactAlpha && hashed01(0x51ed27u, sDim) >= coverage)) {
        return;
    }
    (*best).t = t;
    (*best).inst = FLOOR_INSTANCE;
}

/**
 * Closest hit (or any hit, for shadow rays) against the scene. Shadow rays
 * skip instances that do not cast shadows, as raster shadow maps do.
 */
fn traceScene(o: vec3<f32>, d: vec3<f32>, tMax: f32, anyHit: bool) -> Hit {
    var best = Hit(tMax, NO_INSTANCE, 0u, vec2<f32>(0.0));
    if (!anyHit) {
        traceFloor(o, d, &best);
    }
    if (pt.instanceCount == 0u) {
        return best;
    }
    let invD = safeInverse(d);
    if (boxEntry(o, invD, nodes[pt.tlasOffset * 2u].xyz, nodes[pt.tlasOffset * 2u + 1u].xyz, best.t) >= MISS) {
        return best;
    }
    var sp = 0u;
    var node = 0u;
    loop {
        let a = nodes[(pt.tlasOffset + node) * 2u];
        let b = nodes[(pt.tlasOffset + node) * 2u + 1u];
        let first = bitcast<u32>(a.w);
        let count = bitcast<u32>(b.w);
        if (count > 0u) {
            for (var i = first; i < first + count; i++) {
                if (anyHit && (instWord(i).w & ${INSTANCE_CASTS_SHADOW}u) == 0u) {
                    continue;
                }
                if (traceInstance(i, o, d, &best, anyHit) && anyHit) {
                    return best;
                }
            }
            if (sp == 0u) { break; }
            sp -= 1u;
            node = tlasStack[sp];
            continue;
        }
        var near = first;
        var far = first + 1u;
        let n0 = nodes[(pt.tlasOffset + near) * 2u];
        let n1 = nodes[(pt.tlasOffset + near) * 2u + 1u];
        let f0 = nodes[(pt.tlasOffset + far) * 2u];
        let f1 = nodes[(pt.tlasOffset + far) * 2u + 1u];
        var dNear = boxEntry(o, invD, n0.xyz, n1.xyz, best.t);
        var dFar = boxEntry(o, invD, f0.xyz, f1.xyz, best.t);
        if (dFar < dNear) {
            let tn = near; near = far; far = tn;
            let td = dNear; dNear = dFar; dFar = td;
        }
        if (dNear >= MISS) {
            if (sp == 0u) { break; }
            sp -= 1u;
            node = tlasStack[sp];
            continue;
        }
        node = near;
        if (dFar < MISS) {
            tlasStack[sp] = far;
            sp += 1u;
        }
    }
    return best;
}

fn occluded(o: vec3<f32>, d: vec3<f32>, dist: f32) -> bool {
    return traceScene(o, d, dist, true).inst != NO_INSTANCE;
}

// ── Surfaces ────────────────────────────────────────────────────────────

struct Surface {
    pos : vec3<f32>,
    /**
     * Where rays leaving the surface start: on the smooth surface the vertex
     * normals describe rather than the flat facet, so a low-polygon mesh does
     * not shadow itself in facets near the terminator.
     */
    rayPos : vec3<f32>,
    /** Geometric and shading normals, both facing the incoming ray's side. */
    ng : vec3<f32>,
    n : vec3<f32>,
    /** The ray arrived on the front (outside) of the surface. */
    front : bool,
    albedo : vec3<f32>,
    rough : f32,
    metal : f32,
    /** Dielectric reflectance at normal incidence (0.04 for most surfaces). */
    specF0 : f32,
    glass : bool,
    ior : f32,
    emission : vec3<f32>,
    unlit : bool,
    /** Display color of an unlit surface. */
    display : vec3<f32>,
    clearcoat : f32,
    coatRough : f32,
    sheen : vec3<f32>,
    sheenRough : f32,
    /** Anisotropic GGX stretch -0.95..0.95 (brushed metal) and the brush direction's rotation, rad. */
    aniso : f32,
    anisoRot : f32,
    irid : f32,
    iridThickness : f32,
    iridIor : f32,
};

fn floorSurface(p: vec3<f32>) -> Surface {
    var s: Surface;
    s.pos = p;
    s.rayPos = p;
    s.ng = vec3<f32>(0.0, -1.0, 0.0);
    s.n = s.ng;
    s.front = true;
    s.albedo = pt.floorColor.rgb;
    s.rough = max(pt.floorColor.w, 0.03);
    // Reflectivity is the floor's F0, as the raster floor's Fresnel uses it.
    s.specF0 = pt.floorParams.y;
    s.ior = 1.5;
    s.coatRough = 0.1;
    s.sheenRough = 0.5;
    return s;
}

/** Tangent-space normal map perturbation, the tangent frame from the triangle's UV gradients. */
fn applyNormalMap(m: u32, slot: u32, n: vec3<f32>, uv: vec2<f32>, inst: u32) -> vec3<f32> {
    let b = slot * TRI_VEC4;
    let p0 = tris[b].xyz; let p1 = tris[b + 1u].xyz; let p2 = tris[b + 2u].xyz;
    let uv0 = vec2<f32>(tris[b].w, tris[b + 1u].w);
    let uv1 = vec2<f32>(tris[b + 2u].w, tris[b + 3u].w);
    let uv2 = vec2<f32>(tris[b + 4u].w, tris[b + 5u].w);
    let e1 = p1 - p0; let e2 = p2 - p0;
    let d1 = uv1 - uv0; let d2 = uv2 - uv0;
    let det = d1.x * d2.y - d1.y * d2.x;
    if (abs(det) < 1e-12) {
        return n;
    }
    let r = 1.0 / det;
    let t = toWorldNormal(inst, (e1 * d2.y - e2 * d1.y) * r);
    let bt = toWorldNormal(inst, (e2 * d1.x - e1 * d2.x) * r);
    let T = normalize(t - n * dot(n, t));
    let B = cross(n, T) * select(-1.0, 1.0, dot(cross(n, T), bt) >= 0.0);
    let info = mat(m, 13u);
    let texel = atlasTexel(mat(m, 11u), info.x, mat(m, 7u).y, uv).xyz * 2.0 - 1.0;
    let scale = info.y;
    return normalize(T * texel.x * scale + B * texel.y * scale + n * texel.z);
}

fn unpackColor(w: u32) -> vec4<f32> {
    return unpack4x8unorm(w);
}

fn surfaceAt(hit: Hit, o: vec3<f32>, d: vec3<f32>) -> Surface {
    let p = o + d * hit.t;
    if (hit.inst == FLOOR_INSTANCE) {
        return floorSurface(p);
    }
    let w = instWord(hit.inst);
    let m = w.z;
    let flags = matFlags(m);
    let b = hit.tri * TRI_VEC4;
    let bw = vec3<f32>(1.0 - hit.bary.x - hit.bary.y, hit.bary.x, hit.bary.y);
    let ngObj = cross(tris[b + 1u].xyz - tris[b].xyz, tris[b + 2u].xyz - tris[b].xyz);
    var nObj = tris[b + 3u].xyz * bw.x + tris[b + 4u].xyz * bw.y + tris[b + 5u].xyz * bw.z;
    if (dot(nObj, nObj) < 1e-12) {
        nObj = ngObj;
    }
    var s: Surface;
    s.pos = p;
    var ng = toWorldNormal(hit.inst, ngObj);
    var n = toWorldNormal(hit.inst, nObj);
    // Orient the geometric normal like the shading normal: winding varies between sources.
    ng = select(ng, -ng, dot(ng, n) < 0.0);
    s.front = dot(ng, d) < 0.0;
    let uv = triUv(hit.tri, hit.bary);
    let quad = (flags & ${MAT_QUAD}u) != 0u;
    let texUv = select(uv, uv * mat(m, 12u).xy, quad);
    let tex = mat(m, 7u);

    // Base color in display space, then linear: tint × vertex color × texture.
    let base4 = mat(m, 0u);
    var base = base4.rgb;
    let c = bw.x * unpackColor(bitcast<u32>(tris[b + 6u].x)) + bw.y * unpackColor(bitcast<u32>(tris[b + 6u].y)) + bw.z * unpackColor(bitcast<u32>(tris[b + 6u].z));
    base *= c.rgb;
    if ((flags & ${MAT_BASE_TEX}u) != 0u) {
        let t = atlasTexel(mat(m, 6u), tex.x, tex.y, texUv);
        base *= select(t.rgb / t.a, t.rgb, t.a < 0.001);
    }
    if (quad) {
        let dims = mat(m, 10u);
        let border = mat(m, 11u);
        if (dims.w > 0.0 && border.a > 0.0) {
            let dist = roundRect((uv - 0.5) * dims.xy, dims.xy * 0.5, dims.z);
            let inBorder = select(0.0, border.a, dist > -dims.w);
            base = mix(base, border.rgb, inBorder);
        }
    }
    s.display = clamp(base, vec3<f32>(0.0), vec3<f32>(1.0));
    s.albedo = srgbToLinear(clamp(base, vec3<f32>(0.0), vec3<f32>(1.0)));

    let pbr = mat(m, 1u);
    s.rough = pbr.x;
    s.metal = pbr.y;
    s.specF0 = 0.04;
    s.glass = (flags & ${MAT_GLASS}u) != 0u;
    s.ior = pbr.w;
    if ((flags & ${MAT_MR_TEX}u) != 0u) {
        let mr = atlasTexel(mat(m, 8u), tex.z, tex.y, uv);
        s.rough *= mr.g;
        s.metal *= mr.b;
    }
    s.rough = clamp(s.rough, 0.03, 1.0);
    let em = mat(m, 2u);
    // Light leaves the front of a surface only, as raster culling shows it,
    // unless the material is two-sided.
    let emits = s.front || (flags & ${MAT_TWO_SIDED}u) != 0u;
    s.emission = select(vec3<f32>(0.0), em.rgb, emits);
    if ((flags & ${MAT_EMISSIVE_TEX}u) != 0u) {
        s.emission *= srgbToLinear(atlasTexel(mat(m, 9u), tex.w, tex.y, uv).rgb);
    }
    s.unlit = (flags & ${MAT_UNLIT}u) != 0u;
    let coat = mat(m, 3u);
    s.clearcoat = coat.x;
    s.coatRough = clamp(coat.y, 0.03, 1.0);
    let sheen = mat(m, 4u);
    s.sheen = sheen.rgb * coat.z;
    s.sheenRough = max(coat.w, 0.07);
    s.irid = sheen.w;
    let ir = mat(m, 5u);
    s.iridThickness = ir.x;
    s.iridIor = ir.y;
    let ex = mat(m, 13u);
    s.aniso = clamp(ex.z, -0.95, 0.95);
    s.anisoRot = ex.w;

    if ((flags & ${MAT_NORMAL_TEX}u) != 0u) {
        n = applyNormalMap(m, hit.tri, n, uv, hit.inst);
    }
    // Face the side the ray came from, unless the surface transmits.
    let side = select(-1.0, 1.0, dot(ng, d) < 0.0);
    s.ng = ng * side;
    s.n = n * side;
    if (dot(s.n, -d) < 0.0) {
        // A shading normal facing away from the viewer: bend it onto the visible side.
        s.n = normalize(s.n + d * (dot(s.n, -d) - 1e-3));
    }
    s.rayPos = p;
    if (!s.glass) {
        s.rayPos = toWorldPoint(hit.inst, shadingPoint(b, bw, side));
    }
    return s;
}

/**
 * The hit moved onto the curved surface its vertex normals imply (Hanika
 * 2021, "Hacking the Shadow Terminator", Ray Tracing Gems II ch. 4): each
 * corner's tangent plane lifts the point, never sinks it, and the lifts
 * blend by barycentric weight. Object space; \`side\` flips the normals
 * when the ray arrived from the back.
 */
fn shadingPoint(b: u32, bw: vec3<f32>, side: f32) -> vec3<f32> {
    var p = vec3<f32>(0.0);
    for (var i = 0u; i < 3u; i++) {
        p += tris[b + i].xyz * bw[i];
    }
    var lifted = vec3<f32>(0.0);
    for (var i = 0u; i < 3u; i++) {
        let v = tris[b + i].xyz;
        let raw = tris[b + 3u + i].xyz;
        let n = raw * (side / max(length(raw), 1e-12));
        let toP = p - v;
        lifted += (toP - n * min(0.0, dot(toP, n)) + v) * bw[i];
    }
    return lifted;
}

// ── BSDF ────────────────────────────────────────────────────────────────

fn onb(n: vec3<f32>) -> mat3x3<f32> {
    let sgn = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (sgn + n.z);
    let b = n.x * n.y * a;
    let t = vec3<f32>(1.0 + sgn * n.x * n.x * a, sgn * b, -sgn * n.x);
    let bt = vec3<f32>(b, sgn + n.y * n.y * a, -n.y);
    return mat3x3<f32>(t, bt, n);
}
/**
 * The shading frame (tangent, bitangent, normal) whose tangent is the brush
 * direction of anisotropic surfaces, built as the raster shading builds it.
 */
fn tangentFrame(s: Surface) -> mat3x3<f32> {
    let n = s.n;
    let upRef = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.y) > 0.99);
    let t0 = normalize(cross(upRef, n));
    let b0 = cross(n, t0);
    let c = cos(s.anisoRot);
    let sn = sin(s.anisoRot);
    return mat3x3<f32>(t0 * c + b0 * sn, -t0 * sn + b0 * c, n);
}
fn toLocal(f: mat3x3<f32>, v: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(f[0], v), dot(f[1], v), dot(f[2], v));
}

fn ggxD(nh: f32, a2: f32) -> f32 {
    let d = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / (PI * d * d);
}
fn smithG1(nx: f32, a2: f32) -> f32 {
    return 2.0 * nx / (nx + sqrt(a2 + (1.0 - a2) * nx * nx));
}
fn visCorrelated(nv: f32, nl: f32, a2: f32) -> f32 {
    let gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
    let gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-7);
}
/** Anisotropic GGX: the distribution of a local half vector (Trowbridge-Reitz). */
fn ggxDAniso(h: vec3<f32>, alpha: vec2<f32>) -> f32 {
    let e = vec3<f32>(h.x / alpha.x, h.y / alpha.y, h.z);
    let d = dot(e, e);
    return 1.0 / (PI * alpha.x * alpha.y * d * d);
}
/** Smith Λ of a local direction. */
fn smithLambda(v: vec3<f32>, alpha: vec2<f32>) -> f32 {
    let t = (alpha.x * alpha.x * v.x * v.x + alpha.y * alpha.y * v.y * v.y) / max(v.z * v.z, 1e-8);
    return (sqrt(1.0 + t) - 1.0) * 0.5;
}
/** Visible-normal sample, spherical caps (Dupuy & Benyoub 2023); v in the local frame. */
fn sampleVndf(v: vec3<f32>, alpha: vec2<f32>, u: vec2<f32>) -> vec3<f32> {
    let vh = normalize(vec3<f32>(alpha.x * v.x, alpha.y * v.y, v.z));
    let phi = 2.0 * PI * u.x;
    let z = (1.0 - u.y) * (1.0 + vh.z) - vh.z;
    let st = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
    let hh = vec3<f32>(st * cos(phi), st * sin(phi), z) + vh;
    return normalize(vec3<f32>(alpha.x * hh.x, alpha.y * hh.y, max(hh.z, 1e-6)));
}
fn schlick(f0: vec3<f32>, c: f32) -> vec3<f32> {
    return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
}
fn fresnelDielectric(cosI: f32, eta: f32) -> f32 {
    let c = clamp(cosI, 0.0, 1.0);
    let s2 = (1.0 - c * c) / (eta * eta);
    if (s2 >= 1.0) {
        return 1.0;
    }
    let ct = sqrt(1.0 - s2);
    let rs = (c - eta * ct) / (c + eta * ct);
    let rp = (eta * c - ct) / (eta * c + ct);
    return 0.5 * (rs * rs + rp * rp);
}
fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

/** Lobe weights of an opaque surface seen from wo. */
struct Lobes {
    f0 : vec3<f32>,
    diffuse : vec3<f32>,
    /** Specular roughness along the tangent and the bitangent. */
    alpha : vec2<f32>,
    ca2 : f32,
    pDiffuse : f32,
    pSpec : f32,
    pCoat : f32,
};

fn lobes(s: Surface, nv: f32) -> Lobes {
    var l: Lobes;
    l.f0 = mix(vec3<f32>(s.specF0), s.albedo, s.metal);
    l.diffuse = s.albedo * (1.0 - s.metal);
    let a = s.rough * s.rough;
    l.alpha = max(vec2<f32>(a * (1.0 + s.aniso), a * (1.0 - s.aniso)), vec2<f32>(0.001));
    let ca = s.coatRough * s.coatRough;
    l.ca2 = ca * ca;
    let fv = luminance(schlick(l.f0, nv));
    let fc = s.clearcoat * (0.04 + 0.96 * pow(1.0 - nv, 5.0));
    let wSpec = max(fv, 0.02) * (1.0 - fc);
    let wDiff = (luminance(l.diffuse) + luminance(s.sheen)) * (1.0 - fv) * (1.0 - fc);
    let wCoat = fc;
    let total = max(wSpec + wDiff + wCoat, 1e-6);
    l.pSpec = wSpec / total;
    l.pDiffuse = wDiff / total;
    l.pCoat = wCoat / total;
    return l;
}

/** f · cos and the sampling pdf of an opaque surface for one direction pair. */
struct BsdfEval {
    f : vec3<f32>,
    pdf : f32,
};

fn evalOpaque(s: Surface, l: Lobes, wo: vec3<f32>, wi: vec3<f32>) -> BsdfEval {
    let nv = max(dot(s.n, wo), 1e-4);
    let nl = dot(s.n, wi);
    if (nl <= 0.0 || dot(s.ng, wi) <= 0.0) {
        return BsdfEval(vec3<f32>(0.0), 0.0);
    }
    let h = normalize(wo + wi);
    let nh = max(dot(s.n, h), 0.0);
    let vh = max(dot(wo, h), 0.0);
    var F = schlick(l.f0, vh);
    if (s.irid > 0.001) {
        F = mix(F, evalIridescence(vh, s.iridThickness, s.iridIor, l.f0), s.irid);
    }
    // Specular in the brush frame: anisotropic GGX with height-correlated Smith shadowing.
    let frame = tangentFrame(s);
    let hl = toLocal(frame, h);
    let vl = toLocal(frame, wo);
    let ll = toLocal(frame, wi);
    let D = ggxDAniso(hl, l.alpha);
    let lambdaV = smithLambda(vl, l.alpha);
    let spec = D * F / ((1.0 + lambdaV + smithLambda(ll, l.alpha)) * 4.0 * nv * nl);
    var base = (vec3<f32>(1.0) - F) * l.diffuse / PI + spec;
    if (luminance(s.sheen) > 0.0) {
        let invR = 1.0 / (s.sheenRough * s.sheenRough);
        let sin2h = max(1.0 - nh * nh, 1e-4);
        let dCharlie = (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
        base += s.sheen * dCharlie / max(4.0 * (nl + nv - nl * nv), 1e-4);
    }
    var f = base;
    var pdf = l.pDiffuse * nl / PI + l.pSpec * D / ((1.0 + lambdaV) * 4.0 * nv);
    if (s.clearcoat > 0.0) {
        let fc = s.clearcoat * (0.04 + 0.96 * pow(1.0 - vh, 5.0));
        let dc = ggxD(nh, l.ca2);
        f = base * (1.0 - fc) + vec3<f32>(dc * visCorrelated(nv, nl, l.ca2) * fc);
        pdf += l.pCoat * dc * smithG1(nv, l.ca2) / (4.0 * nv);
    }
    return BsdfEval(f * nl, pdf);
}

struct BsdfSample {
    wi : vec3<f32>,
    /** f · cos / pdf. */
    weight : vec3<f32>,
    pdf : f32,
    /** Light along wi is evaluated by light sampling too (MIS applies). */
    mis : bool,
    transmitted : bool,
    /** The diffuse lobe chose the direction. */
    diffuse : bool,
    valid : bool,
};

fn cosineSample(u: vec2<f32>) -> vec3<f32> {
    let r = sqrt(u.x);
    let phi = 2.0 * PI * u.y;
    return vec3<f32>(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}

fn sampleOpaque(s: Surface, wo: vec3<f32>) -> BsdfSample {
    var out: BsdfSample;
    let frame = tangentFrame(s);
    let v = toLocal(frame, wo);
    let nv = max(v.z, 1e-4);
    let l = lobes(s, nv);
    let u = next2D();
    let pick = next2D().x;
    var wiLocal: vec3<f32>;
    if (pick < l.pDiffuse) {
        wiLocal = cosineSample(u);
    } else {
        let coatAlpha = vec2<f32>(s.coatRough * s.coatRough);
        let a = select(l.alpha, coatAlpha, pick >= l.pDiffuse + l.pSpec);
        let h = sampleVndf(vec3<f32>(v.xy, nv), a, u);
        wiLocal = reflect(-vec3<f32>(v.xy, nv), h);
    }
    let wi = frame * wiLocal;
    let e = evalOpaque(s, l, wo, wi);
    out.valid = e.pdf > 0.0;
    out.wi = wi;
    out.pdf = e.pdf;
    out.weight = select(vec3<f32>(0.0), e.f / e.pdf, out.valid);
    out.mis = true;
    out.diffuse = pick < l.pDiffuse;
    return out;
}

/** Rough dielectric (Walter et al. 2007) with visible-normal sampling; the tint colors transmission. */
fn sampleGlass(s: Surface, wo: vec3<f32>) -> BsdfSample {
    var out: BsdfSample;
    let frame = onb(s.n);
    let v = toLocal(frame, wo);
    let nv = max(v.z, 1e-4);
    let a = s.rough * s.rough;
    let a2 = a * a;
    let h = sampleVndf(vec3<f32>(v.xy, nv), vec2<f32>(a), next2D());
    let eta = select(1.0 / s.ior, s.ior, s.front);
    let vh = dot(vec3<f32>(v.xy, nv), h);
    let F = fresnelDielectric(vh, eta);
    var wiLocal: vec3<f32>;
    if (next2D().x < F) {
        wiLocal = reflect(-vec3<f32>(v.xy, nv), h);
        out.transmitted = false;
        if (wiLocal.z <= 0.0) {
            return out;
        }
    } else {
        wiLocal = refract(-vec3<f32>(v.xy, nv), h, 1.0 / eta);
        out.transmitted = true;
        if (wiLocal.z >= 0.0 || dot(wiLocal, wiLocal) < 0.5) {
            return out;
        }
    }
    out.wi = frame * wiLocal;
    let g1 = smithG1(abs(wiLocal.z), a2);
    // The tint colors light once per crossing: a full pass through takes the base color.
    out.weight = select(vec3<f32>(g1), sqrt(s.albedo) * g1, out.transmitted);
    out.pdf = 1.0;
    out.mis = false;
    out.valid = true;
    return out;
}

/** The reflection a glass surface shows of a light (its transmission is left to paths). */
fn evalGlassReflection(s: Surface, wo: vec3<f32>, wi: vec3<f32>) -> vec3<f32> {
    let nv = max(dot(s.n, wo), 1e-4);
    let nl = dot(s.n, wi);
    if (nl <= 0.0) {
        return vec3<f32>(0.0);
    }
    let h = normalize(wo + wi);
    let a = s.rough * s.rough;
    let a2 = a * a;
    let F = fresnelDielectric(dot(wo, h), select(1.0 / s.ior, s.ior, s.front));
    return vec3<f32>(ggxD(max(dot(s.n, h), 0.0), a2) * visCorrelated(nv, nl, a2) * F * nl);
}

// ── Lights ──────────────────────────────────────────────────────────────

fn offsetOrigin(p: vec3<f32>, n: vec3<f32>, towards: vec3<f32>) -> vec3<f32> {
    let scale = 1e-4 * (1.0 + max(abs(p.x), max(abs(p.y), abs(p.z))));
    return p + n * select(-scale, scale, dot(n, towards) > 0.0);
}

struct DirectSample {
    L : vec3<f32>,
    dist : f32,
    radiance : vec3<f32>,
    valid : bool,
};

/**
 * One light, as the raster renderer lights a point (same falloff, cone and
 * rect terms), with a position on rect lights sampled for soft shadows.
 */
fn sampleDirect(i: i32, p: vec3<f32>) -> DirectSample {
    var out: DirectSample;
    let light = directLights[i];
    let kind = light.posType.w;
    let radiance = srgbToLinear(light.colorIntensity.rgb) * light.colorIntensity.w * PI;
    if (kind > 0.5 && kind < 1.5) {
        out.L = normalize(-light.dirRadius.xyz);
        out.dist = MISS;
        out.radiance = radiance;
        out.valid = true;
        return out;
    }
    if (kind > 3.5) {
        let u = next2D() * 2.0 - 1.0;
        let halfW = max(0.5, light.rectRight.w);
        let halfH = max(0.5, light.rectUp.w);
        let forward = normalize(light.dirRadius.xyz);
        let q = light.posType.xyz + light.rectRight.xyz * (u.x * halfW) + light.rectUp.xyz * (u.y * halfH);
        let toLight = q - p;
        let dist = length(toLight);
        let range = max(1.0, light.dirRadius.w);
        if (dist > range || dist < 1e-4) {
            return out;
        }
        out.L = toLight / dist;
        let twoSided = light.spotParams.w > 0.5;
        let c = dot(-out.L, forward);
        let emitCos = select(max(0.0, c), abs(c), twoSided);
        if (emitCos <= 0.0) {
            return out;
        }
        let decay = max(0.5, light.spotParams.z);
        let area = 4.0 * halfW * halfH;
        let areaFactor = clamp(area / (area + PI * dist * dist), 0.12, 1.0);
        let att = pow(clamp(1.0 - dist / range, 0.0, 1.0), decay) * emitCos * (0.45 + 0.55 * areaFactor);
        out.dist = dist;
        out.radiance = radiance * att;
        out.valid = true;
        return out;
    }
    if (kind < 1.5) {
        return out;
    }
    let ls = sampleLight(i, p);
    if (!ls.valid) {
        return out;
    }
    out.L = ls.L;
    out.dist = length(light.posType.xyz - p);
    out.radiance = radiance * ls.attenuation;
    out.valid = true;
    return out;
}

/** The environment's radiance along a world direction: HDRI or gradient, plus ambient light. */
fn envLight(d: vec3<f32>) -> vec3<f32> {
    return envRadiance(d, 0.0);
}

fn rotateEnv(d: vec3<f32>, sign: f32) -> vec3<f32> {
    let rot = lights.envTop.w * sign;
    let c = cos(rot);
    let s = sin(rot);
    return vec3<f32>(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

/** Index of the CDF interval containing u, among count intervals at offset. */
fn cdfSearch(offset: u32, count: u32, u: f32) -> u32 {
    var lo = 0u;
    var hi = count;
    while (lo + 1u < hi) {
        let mid = (lo + hi) / 2u;
        if (envTable[offset + mid] <= u) { lo = mid; } else { hi = mid; }
    }
    return lo;
}

struct EnvSample {
    dir : vec3<f32>,
    pdf : f32,
};

fn envTableSize() -> vec2<u32> {
    return vec2<u32>(u32(envTable[0]), u32(envTable[1]));
}

fn sampleEnv() -> EnvSample {
    let size = envTableSize();
    let w = size.x;
    let h = size.y;
    let u = next2D();
    let marginal = ENV_HEADER;
    let conditional = marginal + h + 1u;
    let values = conditional + h * (w + 1u);
    let y = cdfSearch(marginal, h + 1u, u.y);
    let row = conditional + y * (w + 1u);
    let x = cdfSearch(row, w + 1u, u.x);
    let y0 = envTable[marginal + y];
    let y1 = envTable[marginal + y + 1u];
    let x0 = envTable[row + x];
    let x1 = envTable[row + x + 1u];
    let fv = (f32(y) + (u.y - y0) / max(y1 - y0, 1e-12)) / f32(h);
    let fu = (f32(x) + (u.x - x0) / max(x1 - x0, 1e-12)) / f32(w);
    let theta = fv * PI;
    let phi = (fu - 0.5) * 2.0 * PI;
    let st = sin(theta);
    let local = vec3<f32>(st * sin(phi), -cos(theta), -st * cos(phi));
    let pdfUv = envTable[values + y * w + x] / max(envTable[2], 1e-12);
    return EnvSample(rotateEnv(local, -1.0), pdfUv / max(2.0 * PI * PI * st, 1e-6));
}

fn envPdf(dWorld: vec3<f32>) -> f32 {
    let size = envTableSize();
    let d = rotateEnv(dWorld, 1.0);
    let u = fract(atan2(d.x, -d.z) / (2.0 * PI) + 0.5);
    let v = acos(clamp(-d.y, -1.0, 1.0)) / PI;
    let x = min(u32(u * f32(size.x)), size.x - 1u);
    let y = min(u32(v * f32(size.y)), size.y - 1u);
    let values = ENV_HEADER + size.y + 1u + size.y * (size.x + 1u);
    let st = sin(v * PI);
    return envTable[values + y * size.x + x] / max(envTable[2], 1e-12) / max(2.0 * PI * PI * st, 1e-6);
}

fn powerHeuristic(a: f32, b: f32) -> f32 {
    let a2 = a * a;
    return a2 / max(a2 + b * b, 1e-20);
}

// ── Emissive surfaces ───────────────────────────────────────────────────

/** The world corners of a triangle of an instance. */
fn worldTriangle(inst: u32, slot: u32) -> array<vec3<f32>, 3> {
    let b = slot * TRI_VEC4;
    return array<vec3<f32>, 3>(
        toWorldPoint(inst, tris[b].xyz),
        toWorldPoint(inst, tris[b + 1u].xyz),
        toWorldPoint(inst, tris[b + 2u].xyz),
    );
}

/** Light a material gives off at a point: its emissive color, times its emissive map. */
fn emissionAt(m: u32, uv: vec2<f32>) -> vec3<f32> {
    var e = mat(m, 2u).rgb;
    if ((matFlags(m) & ${MAT_EMISSIVE_TEX}u) != 0u) {
        e *= srgbToLinear(atlasTexel(mat(m, 9u), mat(m, 7u).w, mat(m, 7u).y, uv).rgb);
    }
    return e;
}

/**
 * Solid-angle density with which emitter sampling picks the point a ray
 * from o along unit d hit at distance t: triangles are chosen by area ×
 * emission and points uniformly on them, so the area cancels.
 */
fn emitterPdf(hit: Hit, d: vec3<f32>) -> f32 {
    if (pt.emitterCount == 0u || hit.inst == FLOOR_INSTANCE) {
        return 0.0;
    }
    let m = instWord(hit.inst).z;
    let strength = luminance(mat(m, 2u).rgb);
    if (strength <= 0.0 || (matFlags(m) & ${MAT_UNLIT}u) != 0u) {
        return 0.0;
    }
    let p = worldTriangle(hit.inst, hit.tri);
    let ng = normalize(cross(p[1] - p[0], p[2] - p[0]));
    let c = abs(dot(ng, d));
    return strength * hit.t * hit.t / max(pt.emitterPower * c, 1e-12);
}

/** Index of the emitter whose cumulative probability first exceeds u. */
fn pickEmitter(u: f32) -> u32 {
    var lo = 0u;
    var hi = pt.emitterCount - 1u;
    while (lo < hi) {
        let mid = (lo + hi) / 2u;
        if (emitters[mid].z < u) { lo = mid + 1u; } else { hi = mid; }
    }
    return lo;
}

/** A point on an emitter, as a light sample from a shading point. */
struct EmitterPoint {
    inst : u32,
    slot : u32,
    bary : vec2<f32>,
    q : vec3<f32>,
    /** The emitter's normal, oriented like its vertex normals (its front). */
    n : vec3<f32>,
    L : vec3<f32>,
    /** Solid-angle density of picking this point (triangle by power, then uniformly). */
    pdf : f32,
    valid : bool,
};

fn emitterPoint(origin: vec3<f32>) -> EmitterPoint {
    var out: EmitterPoint;
    let e = emitters[pickEmitter(next2D().x)];
    let ids = bitcast<vec2<u32>>(e.xy);
    out.inst = ids.x;
    out.slot = ids.y;
    let u = next2D();
    let su = sqrt(u.x);
    out.bary = vec2<f32>(su * (1.0 - u.y), su * u.y);
    let p = worldTriangle(out.inst, out.slot);
    out.q = p[0] * (1.0 - out.bary.x - out.bary.y) + p[1] * out.bary.x + p[2] * out.bary.y;
    let cr = cross(p[1] - p[0], p[2] - p[0]);
    let area = 0.5 * length(cr);
    let b = out.slot * TRI_VEC4;
    let vn = toWorldNormal(out.inst, tris[b + 3u].xyz + tris[b + 4u].xyz + tris[b + 5u].xyz);
    out.n = cr / max(2.0 * area, 1e-20) * select(-1.0, 1.0, dot(cr, vn) >= 0.0);
    let toQ = out.q - origin;
    let dist2 = dot(toQ, toQ);
    out.L = toQ / sqrt(dist2);
    let m = instWord(out.inst).z;
    let twoSided = (matFlags(m) & ${MAT_TWO_SIDED}u) != 0u;
    let c = select(-dot(out.n, out.L), abs(dot(out.n, out.L)), twoSided);
    out.valid = area > 0.0 && c > 1e-6;
    out.pdf = e.w / max(area, 1e-20) * dist2 / max(c, 1e-6);
    return out;
}

/** Candidates resampled per emitter light sample. */
const EMITTER_CANDIDATES = 8u;

/**
 * Emissive-surface light by resampled importance sampling (Talbot 2005, the
 * core of ReSTIR): several candidate points, each picked by power, weighed
 * by what it would contribute unshadowed (BSDF × emission); one is kept in
 * proportion and gets the shadow ray. Points on the far side of a thin
 * emitter or behind the shading point weigh nothing, so the one shadow ray
 * goes where light can arrive. MIS-weighted against BSDF sampling with the
 * power-based density: any partition of unity keeps both unbiased.
 */
fn emitterLighting(s: Surface, l: Lobes, wo: vec3<f32>) -> vec3<f32> {
    var chosen: EmitterPoint;
    var chosenTarget = 0.0;
    var wSum = 0.0;
    for (var i = 0u; i < EMITTER_CANDIDATES; i++) {
        let c = emitterPoint(s.pos);
        let keep = next2D().x;
        if (!c.valid) {
            continue;
        }
        let ev = evalOpaque(s, l, wo, c.L);
        let weight = luminance(ev.f * mat(instWord(c.inst).z, 2u).rgb);
        if (weight <= 0.0) {
            continue;
        }
        let w = weight / c.pdf;
        wSum += w;
        if (keep * wSum < w) {
            chosen = c;
            chosenTarget = weight;
        }
    }
    if (wSum <= 0.0) {
        return vec3<f32>(0.0);
    }
    // Both ends leave their surfaces as ray origins do, so neither the
    // shaded surface nor the emitter's own triangle shadows the sample.
    let o = offsetOrigin(s.rayPos, s.ng, chosen.L);
    let end = offsetOrigin(chosen.q, chosen.n, -chosen.L);
    if (occluded(o, normalize(end - o), distance(o, end))) {
        return vec3<f32>(0.0);
    }
    let ev = evalOpaque(s, l, wo, chosen.L);
    let le = emissionAt(instWord(chosen.inst).z, triUv(chosen.slot, chosen.bary));
    let mis = powerHeuristic(chosen.pdf, ev.pdf);
    return ev.f * le * mis * (wSum / f32(EMITTER_CANDIDATES)) / chosenTarget;
}

/** Direct light at an opaque or glass surface: every light, and one environment sample. */
fn directLighting(s: Surface, wo: vec3<f32>) -> vec3<f32> {
    var sum = vec3<f32>(0.0);
    var l: Lobes;
    if (!s.glass) {
        l = lobes(s, max(dot(s.n, wo), 1e-4));
    }
    for (var i = 0; i < i32(pt.lightCount); i++) {
        let ds = sampleDirect(i, s.pos);
        if (!ds.valid) {
            continue;
        }
        var f: vec3<f32>;
        if (s.glass) {
            f = evalGlassReflection(s, wo, ds.L);
        } else {
            f = evalOpaque(s, l, wo, ds.L).f;
        }
        if (luminance(f) <= 0.0) {
            continue;
        }
        let o = offsetOrigin(s.rayPos, s.ng, ds.L);
        if (!occluded(o, ds.L, ds.dist)) {
            sum += f * ds.radiance;
        }
    }
    if (!s.glass && pt.emitterCount > 0u) {
        sum += emitterLighting(s, l, wo);
    }
    if (!s.glass && (pt.flags & ${TRACE_ENV_TABLE}u) != 0u) {
        let es = sampleEnv();
        let e = evalOpaque(s, l, wo, es.dir);
        if (e.pdf > 0.0 && es.pdf > 0.0) {
            let o = offsetOrigin(s.rayPos, s.ng, es.dir);
            if (!occluded(o, es.dir, MISS)) {
                sum += e.f * envLight(es.dir) * powerHeuristic(es.pdf, e.pdf) / es.pdf;
            }
        }
    }
    return sum;
}

// ── Camera and integrator ───────────────────────────────────────────────

struct CameraRay {
    o : vec3<f32>,
    d : vec3<f32>,
};

fn cameraRay(px: vec2<u32>) -> CameraRay {
    let jitter = next2D();
    let uv = (vec2<f32>(px) + jitter) / vec2<f32>(pt.size);
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let n4 = cam.invViewProjMatrix * vec4<f32>(ndc, 0.0, 1.0);
    let f4 = cam.invViewProjMatrix * vec4<f32>(ndc, 1.0, 1.0);
    var o = n4.xyz / n4.w;
    var d = normalize(f4.xyz / f4.w - o);
    if (pt.lensRadius > 0.0) {
        // Thin lens: points at the focus distance stay sharp.
        let fwd = cam.cameraDir.xyz;
        let tFocus = (pt.focusDistance - dot(o - cam.cameraPos.xyz, fwd)) / max(dot(d, fwd), 1e-4);
        let focus = o + d * tFocus;
        let right = vec3<f32>(cam.viewMatrix[0].x, cam.viewMatrix[1].x, cam.viewMatrix[2].x);
        let up = vec3<f32>(cam.viewMatrix[0].y, cam.viewMatrix[1].y, cam.viewMatrix[2].y);
        let disk = next2D();
        let r = pt.lensRadius * sqrt(disk.x);
        let a = 2.0 * PI * disk.y;
        o += right * (r * cos(a)) + up * (r * sin(a));
        d = normalize(focus - o);
    }
    return CameraRay(o, d);
}

/** The 2D picture behind the 3D batch, seen along a direction from the eye (at infinity). */
fn backdropAlong(d: vec3<f32>) -> vec3<f32> {
    let clip = cam.viewProjMatrix * vec4<f32>(cam.cameraPos.xyz + d * 1e4, 1.0);
    if (clip.w <= 0.0) {
        return vec3<f32>(0.0);
    }
    let ndc = clip.xy / clip.w;
    let uv = clamp(vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5), vec2<f32>(0.0), vec2<f32>(1.0));
    let size = vec2<f32>(textureDimensions(backdrop));
    let t = textureLoad(backdrop, vec2<i32>(uv * (size - 1.0)), 0);
    return t.rgb;
}

/** What one camera path carries back. */
struct PathResult {
    radiance : vec3<f32>,
    /** 0 = missed, 1 = lit (radiance), 2 = unlit or backdrop (display). */
    kind : u32,
    display : vec3<f32>,
    albedo : vec3<f32>,
    normal : vec3<f32>,
    depth : f32,
    /** Coverage of the first surface, and its distance along the camera ray. */
    alpha : f32,
    firstT : f32,
};

fn clampIndirect(c: vec3<f32>, bounce: u32) -> vec3<f32> {
    if (bounce == 0u || pt.clampIndirect <= 0.0) {
        return c;
    }
    let l = luminance(c);
    return select(c, c * (pt.clampIndirect / l), l > pt.clampIndirect);
}

fn hitAlpha(hit: Hit, o: vec3<f32>, d: vec3<f32>) -> f32 {
    if (hit.inst == FLOOR_INSTANCE) {
        return floorCoverage(o + d * hit.t);
    }
    let m = instWord(hit.inst).z;
    if ((matFlags(m) & ${MAT_ALPHA}u) == 0u) {
        return 1.0;
    }
    return clamp(surfaceAlpha(m, triUv(hit.tri, hit.bary)), 0.0, 1.0);
}

fn tracePath(ray: CameraRay) -> PathResult {
    var out: PathResult;
    out.kind = 0u;
    var o = ray.o;
    var d = ray.d;
    var throughput = vec3<f32>(1.0);
    var radiance = vec3<f32>(0.0);
    var lastPdf = 0.0;
    var lastMis = false;
    var transmittedOnly = true;
    var regularize = false;
    let hasTable = (pt.flags & ${TRACE_ENV_TABLE}u) != 0u;
    // Bounces off glass count against their own budget: crossing a thick
    // vase takes four or more, which would starve the light of everything else.
    var depth = 0u;
    var glassDepth = 0u;
    for (var bounce = 0u; bounce <= pt.maxBounces + pt.maxTransmission; bounce++) {
        exactAlpha = bounce == 0u;
        let hit = traceScene(o, d, MISS, false);
        exactAlpha = false;
        if (hit.inst == NO_INSTANCE) {
            if (bounce == 0u) {
                return out;
            }
            if (transmittedOnly && (pt.flags & ${TRACE_BACKDROP}u) != 0u) {
                // Seen through glass: the picture behind the batch, bent by it.
                out.kind = 2u;
                out.display = linearToSrgb(throughput) * backdropAlong(d);
                out.radiance = radiance;
                return out;
            }
            var env = envLight(d);
            if (hasTable && lastMis) {
                env *= powerHeuristic(lastPdf, envPdf(d));
            }
            radiance += clampIndirect(throughput * (env + lights.ambientLinear.rgb), bounce);
            break;
        }
        var s = surfaceAt(hit, o, d);
        if (regularize) {
            // Light reaching a diffuse bounce through a near-mirror (a caustic)
            // is found only by rare paths: widen the lobes so it arrives as glow.
            s.rough = max(s.rough, pt.filterGlossy);
            s.coatRough = max(s.coatRough, pt.filterGlossy);
        }
        let wo = -d;
        if (bounce == 0u) {
            out.alpha = hitAlpha(hit, o, d);
            out.firstT = hit.t;
            out.kind = 1u;
            out.albedo = s.albedo;
            out.normal = s.n;
            out.depth = dot(s.pos - cam.cameraPos.xyz, cam.cameraDir.xyz);
        }
        if (s.unlit) {
            if (bounce == 0u) {
                out.kind = 2u;
                out.display = s.display;
                return out;
            }
            radiance += clampIndirect(throughput * (s.albedo + s.emission), bounce);
            break;
        }
        // Light a bounce found on an emissive surface, weighted against emitter sampling there.
        var emitted = s.emission;
        if (bounce > 0u && lastMis && pt.emitterCount > 0u) {
            emitted *= powerHeuristic(lastPdf, emitterPdf(hit, d));
        }
        radiance += clampIndirect(throughput * emitted, bounce);
        if ((!s.glass && depth >= pt.maxBounces) || (s.glass && glassDepth >= pt.maxTransmission)) {
            break;
        }
        radiance += clampIndirect(throughput * directLighting(s, wo), bounce);
        var bs: BsdfSample;
        if (s.glass) {
            bs = sampleGlass(s, wo);
        } else {
            bs = sampleOpaque(s, wo);
            transmittedOnly = false;
        }
        if (!bs.valid) {
            break;
        }
        if (!bs.transmitted) {
            transmittedOnly = false;
        }
        regularize = regularize || (bs.diffuse && pt.filterGlossy > 0.0);
        throughput *= bs.weight;
        lastPdf = bs.pdf;
        lastMis = bs.mis;
        if (s.glass) {
            glassDepth += 1u;
        } else {
            depth += 1u;
        }
        if (depth >= pt.rrDepth) {
            let q = min(0.95, max(throughput.x, max(throughput.y, throughput.z)));
            if (next2D().x >= q) {
                break;
            }
            throughput /= q;
        }
        o = offsetOrigin(s.rayPos, s.ng, bs.wi);
        d = bs.wi;
    }
    out.radiance = radiance;
    return out;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= pt.tileSize.x || gid.y >= pt.tileSize.y) {
        return;
    }
    let px = gid.xy + pt.origin;
    if (px.x >= pt.size.x || px.y >= pt.size.y) {
        return;
    }
    sPixel = px.y * pt.size.x + px.x;
    sIndex = pt.sampleIndex;
    sDim = 0u;
    var ray = cameraRay(px);
    let base = sPixel * ACC_VEC4;
    var a0 = accum[base];
    var a1 = accum[base + 1u];
    var a2 = accum[base + 2u];
    var a3 = accum[base + 3u];
    // Up to four partly covering surfaces along the camera ray, front to back.
    var remaining = 1.0;
    for (var layer = 0u; layer < 4u; layer++) {
        let r = tracePath(ray);
        if (r.kind == 0u) {
            break;
        }
        let w = remaining * r.alpha;
        let rad = select(vec3<f32>(0.0), r.radiance, r.radiance == r.radiance);
        if (r.kind == 1u) {
            a0 += vec4<f32>(rad, 1.0) * w;
            let l = luminance(rad);
            a2.w += l * l * w;
        } else {
            // A display sample can still carry highlights a glass surface reflected:
            // they add in linear display light, after tone mapping.
            let shown = linearToSrgb(srgbToLinear(r.display) + toneMap(rad));
            a1 += vec4<f32>(shown, 1.0) * w;
        }
        a2 += vec4<f32>(r.albedo * w, 0.0);
        a3 += vec4<f32>(r.normal, r.depth) * w;
        remaining *= 1.0 - r.alpha;
        if (remaining < 1e-3) {
            break;
        }
        ray.o += ray.d * (r.firstT * (1.0 + 1e-5) + 1e-2);
    }
    accum[base] = a0;
    accum[base + 1u] = a1;
    accum[base + 2u] = a2;
    accum[base + 3u] = a3;
}
`;
