/**
 * The clay field in WGSL: the same records, order and arithmetic as the
 * CPU reference in `eval.ts` (change them together), and the ray that
 * finds the surface: a walk over the brick grid, marching inside the bricks
 * the surface can cross.
 */
import { GROUP_END, MAX_WARPS, OP } from "./layout.js";

export const clayStructsWgsl = /* wgsl */ `
struct ClayBrick {
    origin    : vec3<f32>,
    size      : f32,
    offset    : u32,
    count     : u32,
    warps     : u32,
    // 1 / the Lipschitz bound of the field without its detail.
    stepScale : f32,
    // x = how far detail can move the surface, y = 1 / the bound with detail,
    // z = as x for detail that is not at the list's end, w = detail records
    // at the list's end (nothing after them reads the field).
    detail    : vec4<f32>,
};

struct ClayUniforms {
    invModel : mat4x4<f32>,
    params   : vec4<f32>, // x = symmetry bits (1 = x, 2 = y, 4 = z), y = detail filter (1 = fade octaves below a pixel, 0 = keep all)
    grid     : vec4<f32>, // xyz = the grid's corner, w = brick size
    dims     : vec4<f32>, // xyz = bricks along each axis
    // The cache: x = cells along a brick's edge (0 = none), z = bricks,
    // w = 1 while baking (the cache holds the field without its detail).
    // y = while baking, invocations per row of the dispatch; while
    // drawing, 1 when the cache also holds colors.
    bake     : vec4<f32>,
};
`;

/** Bindings of the field's data for drawing, in bind group `group`. */
export const clayBindingsWgsl = (group: number) => /* wgsl */ `
${clayStructsWgsl}
@group(${group}) @binding(1) var<uniform> clay : ClayUniforms;
@group(${group}) @binding(2) var<storage, read> clayOps : array<vec4<f32>>;
@group(${group}) @binding(3) var<storage, read> clayLists : array<u32>;
@group(${group}) @binding(4) var<storage, read> clayBricks : array<ClayBrick>;
// Per grid cell: 1 + the index of its brick, 0 where the surface cannot be.
@group(${group}) @binding(5) var<storage, read> clayGrid : array<u32>;
// The cache: per brick, the field without its detail on a lattice of
// (cells + 1)^3 points, x fastest; then, per brick, how far reading it
// between lattice points can be from the field; then, per brick, the color
// (rgb) on a lattice half as fine.
@group(${group}) @binding(6) var<storage, read> clayCache : array<f32>;
`;

export const clayFieldWgsl = /* wgsl */ `
const CLAY_EMPTY = 1e9;
const CLAY_GROUP_END = ${GROUP_END}u;
const CLAY_MAX_WARPS = ${MAX_WARPS};

fn clayRotate(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

fn clayFade(r2: f32, reach: f32) -> f32 {
    let x = max(0.0, 1.0 - r2 / (reach * reach));
    return x * x;
}

// Distance to the solid at record o (cylinders, capsules and tori stand along y).
fn claySolid(kind: i32, o: u32, pIn: vec3<f32>) -> f32 {
    let p1 = clayOps[o + 1u];
    let shape = clayOps[o + 3u];
    let p = clayRotate(clayOps[o + 2u], pIn - p1.xyz);
    let size = p1.w;
    if (kind == ${OP.sphere}) {
        return length(p) - size;
    }
    if (kind == ${OP.box}) {
        let q = abs(p) - shape.xyz + vec3<f32>(size);
        return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - size;
    }
    if (kind == ${OP.cylinder}) {
        let d = vec2<f32>(length(p.xz) - size, abs(p.y) - shape.x);
        return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
    }
    if (kind == ${OP.capsule}) {
        return length(vec3<f32>(p.x, p.y - clamp(p.y, -shape.x, shape.x), p.z)) - size;
    }
    return length(vec2<f32>(length(p.xz) - size, p.y)) - shape.x;
}

fn claySegmentAt(t: f32, limit: f32, d: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r0: f32, r1: f32) -> f32 {
    let tc = clamp(t, 0.0, limit);
    return length(d + (2.0 * a + b * tc) * tc) - mix(r0, r1, tc);
}

fn clayCbrt(x: f32) -> f32 {
    return sign(x) * pow(abs(x), 1.0 / 3.0);
}

// A ball swept along the quadratic Bezier of record o: the closest point
// solves the cubic the curve's distance derivative is.
fn claySegment(o: u32, p: vec3<f32>) -> f32 {
    let A = clayOps[o + 1u];
    let B = clayOps[o + 2u];
    let C = clayOps[o + 3u];
    let a = B.xyz - A.xyz;
    let b = A.xyz - 2.0 * B.xyz + C.xyz;
    let d = A.xyz - p;
    let limit = B.w;
    let aa = dot(a, a);
    let bb = dot(b, b);
    if (bb <= 1e-6 * aa || bb < 1e-12) {
        let c = 2.0 * a + b;
        let cc = dot(c, c);
        var t = 0.0;
        if (cc > 1e-12) {
            t = -dot(d, c) / cc;
        }
        return claySegmentAt(t, limit, d, a, b, A.w, C.w);
    }
    let kk = 1.0 / bb;
    let kx = kk * dot(a, b);
    let ky = kk * (2.0 * aa + dot(d, b)) / 3.0;
    let kz = kk * dot(d, a);
    let pp = ky - kx * kx;
    let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    let h = q * q + 4.0 * pp * pp * pp;
    if (h >= 0.0) {
        let s = sqrt(h);
        let t = clayCbrt((s - q) * 0.5) + clayCbrt((-s - q) * 0.5) - kx;
        return claySegmentAt(t, limit, d, a, b, A.w, C.w);
    }
    let z = sqrt(-pp);
    let v = acos(clamp(q / (pp * z * 2.0), -1.0, 1.0)) / 3.0;
    let m = cos(v);
    let n = sin(v) * 1.7320508075688772;
    return min(
        claySegmentAt((m + m) * z - kx, limit, d, a, b, A.w, C.w),
        min(
            claySegmentAt((-n - m) * z - kx, limit, d, a, b, A.w, C.w),
            claySegmentAt((n - m) * z - kx, limit, d, a, b, A.w, C.w),
        ),
    );
}

// Displacement of the warp at record o: a regularized Kelvinlet of an
// incompressible solid, faded to zero at its reach.
fn clayWarp(kind: i32, o: u32, p: vec3<f32>) -> vec3<f32> {
    let p1 = clayOps[o + 1u];
    let p2 = clayOps[o + 2u];
    let r = p - p1.xyz;
    let e = p1.w;
    let r2 = dot(r, r);
    let w = clayFade(r2, p2.w);
    let re = sqrt(r2 + e * e);
    let v = p2.xyz;
    if (kind == ${OP.grab}) {
        let re3 = re * re * re;
        let a = e * (0.5 / re + e * e / (2.0 * re3)) * w;
        let b = e * 0.5 / re3 * dot(r, v) * w;
        return a * v + b * r;
    }
    let s = e / re;
    let s3 = s * s * s;
    let k = (s3 + 1.5 * s3 * s * s) / 2.5 * w;
    if (kind == ${OP.twist}) {
        return k * cross(v, r);
    }
    return k * v.x * r;
}

// Lattice values in -1..1 at four corners at once: the bits the CPU's
// hash gives each, from products shared between the corners.
fn clayHash4(h: vec4<u32>) -> vec4<f32> {
    var v = h;
    v ^= v >> vec4<u32>(15u);
    v *= 0x2c1b3c6du;
    v ^= v >> vec4<u32>(12u);
    v *= 0x297a2d39u;
    v ^= v >> vec4<u32>(15u);
    return vec4<f32>(v >> vec4<u32>(8u)) / 16777216.0 * 2.0 - 1.0;
}

struct ClayLattice {
    near : vec4<f32>, // the cell's corners at z, x fastest
    far  : vec4<f32>, // and at z + 1
    f    : vec3<f32>, // the point inside the cell, 0..1
};

fn clayLattice(p: vec3<f32>, seed: u32) -> ClayLattice {
    let cell = floor(p);
    let i = bitcast<vec3<u32>>(vec3<i32>(cell));
    // (i + 1) * k = i * k + k: each axis costs one product for both corners.
    let x0 = i.x * 0x8da6b343u;
    let y0 = i.y * 0xd8163841u;
    let zk = i.z * 0xcb1ab31fu;
    let s = seed * 0x165667b1u;
    let x1 = x0 + 0x8da6b343u;
    let y1 = y0 + 0xd8163841u;
    let face = vec4<u32>(x0 ^ y0, x1 ^ y0, x0 ^ y1, x1 ^ y1);
    return ClayLattice(
        clayHash4(face ^ vec4<u32>(zk ^ s)),
        clayHash4(face ^ vec4<u32>((zk + 0xcb1ab31fu) ^ s)),
        p - cell,
    );
}

// Value noise in -1..1.
fn clayNoise(p: vec3<f32>, seed: u32) -> f32 {
    let l = clayLattice(p, seed);
    let f = l.f;
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let nearRow = mix(l.near.xz, l.near.yw, vec2<f32>(u.x));
    let farRow = mix(l.far.xz, l.far.yw, vec2<f32>(u.x));
    return mix(mix(nearRow.x, nearRow.y, u.y), mix(farRow.x, farRow.y, u.y), u.z);
}

// The same noise with its gradient: xyz = gradient, w = value.
fn clayNoiseGradient(p: vec3<f32>, seed: u32) -> vec4<f32> {
    let l = clayLattice(p, seed);
    let f = l.f;
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
    let nearRow = mix(l.near.xz, l.near.yw, vec2<f32>(u.x));
    let farRow = mix(l.far.xz, l.far.yw, vec2<f32>(u.x));
    let nearPlane = mix(nearRow.x, nearRow.y, u.y);
    let farPlane = mix(farRow.x, farRow.y, u.y);
    let dxNear = mix(l.near.y - l.near.x, l.near.w - l.near.z, u.y);
    let dxFar = mix(l.far.y - l.far.x, l.far.w - l.far.z, u.y);
    return vec4<f32>(
        mix(dxNear, dxFar, u.z) * du.x,
        mix(nearRow.y - nearRow.x, farRow.y - farRow.x, u.z) * du.y,
        (farPlane - nearPlane) * du.z,
        mix(nearPlane, farPlane, u.z),
    );
}

// How far the detail at record o raises the surface. An octave fades out
// as its wavelength nears two pixels (footprint = the size of a pixel here).
fn clayDetail(o: u32, p: vec3<f32>, footprint: f32) -> f32 {
    let p1 = clayOps[o + 1u];
    let p2 = clayOps[o + 2u];
    let p3 = clayOps[o + 3u];
    let octaves = i32(p2.z);
    let seed = bitcast<u32>(i32(p2.w));
    var frequency = p2.y;
    var height = 1.0;
    var sum = 0.0;
    for (var i = 0; i < octaves; i++) {
        var visible = 1.0;
        if (footprint > 0.0) {
            visible = clamp(1.0 / (2.0 * footprint * frequency) - 1.0, 0.0, 1.0);
        }
        if (visible > 0.0) {
            let n = clayNoise(p * frequency, seed + u32(i));
            sum += height * visible * select(n, 1.0 - 2.0 * abs(n), p3.z > 0.5);
        }
        height *= p3.x;
        frequency *= p3.y;
    }
    if (p1.w > 0.0) {
        let r = p - p1.xyz;
        sum *= clayFade(dot(r, r), p1.w);
    }
    return sum * p2.x;
}

// The gradient of clayDetail in space (it has no finite-difference width:
// the octave fade already limits it to the pixel).
fn clayDetailGradient(o: u32, p: vec3<f32>, footprint: f32) -> vec3<f32> {
    let p1 = clayOps[o + 1u];
    let p2 = clayOps[o + 2u];
    let p3 = clayOps[o + 3u];
    let octaves = i32(p2.z);
    let seed = bitcast<u32>(i32(p2.w));
    var frequency = p2.y;
    var height = 1.0;
    var sum = vec4<f32>(0.0);
    for (var i = 0; i < octaves; i++) {
        var visible = 1.0;
        if (footprint > 0.0) {
            visible = clamp(1.0 / (2.0 * footprint * frequency) - 1.0, 0.0, 1.0);
        }
        if (visible > 0.0) {
            var n = clayNoiseGradient(p * frequency, seed + u32(i));
            n = vec4<f32>(n.xyz * frequency, n.w);
            if (p3.z > 0.5) {
                n = vec4<f32>(-2.0 * sign(n.w) * n.xyz, 1.0 - 2.0 * abs(n.w));
            }
            sum += height * visible * n;
        }
        height *= p3.x;
        frequency *= p3.y;
    }
    var gradient = sum.xyz;
    if (p1.w > 0.0) {
        let r = p - p1.xyz;
        let x = max(0.0, 1.0 - dot(r, r) / (p1.w * p1.w));
        gradient = gradient * (x * x) + sum.w * (-4.0 * x / (p1.w * p1.w)) * r;
    }
    return gradient * p2.x;
}

// Joins e into the running sample (rgb = color, w = distance): Quilez's
// polynomial smooth min / max, whose weight also blends the colors.
// A record without a color of its own (alpha 0) keeps the running one.
fn clayJoin(acc: vec4<f32>, e: f32, mode: f32, smoothness: f32, own: vec4<f32>) -> vec4<f32> {
    let color = select(acc.rgb, own.rgb, own.a >= 0.5);
    let k = max(smoothness, 1e-6);
    let d = acc.w;
    if (mode < 0.5) {
        let h = clamp(0.5 + 0.5 * (e - d) / k, 0.0, 1.0);
        return vec4<f32>(mix(color, acc.rgb, h), e + (d - e) * h - k * h * (1.0 - h));
    }
    let o = select(e, -e, mode < 1.5);
    let h = clamp(0.5 + 0.5 * (d - o) / k, 0.0, 1.0);
    return vec4<f32>(mix(color, acc.rgb, h), o + (d - o) * h + k * h * (1.0 - h));
}

fn clayIsWarp(kind: i32) -> bool {
    return kind >= ${OP.grab} && kind <= ${OP.bulge};
}

// The field inside one brick: rgb = color, w = signed distance bound.
fn clayField(pIn: vec3<f32>, brick: ClayBrick, footprint: f32) -> vec4<f32> {
    let bits = u32(clay.params.x);
    var levels : array<vec3<f32>, ${MAX_WARPS + 1}>;
    var level = brick.warps;
    levels[level] = select(pIn, abs(pIn), vec3<bool>((bits & 1u) != 0u, (bits & 2u) != 0u, (bits & 4u) != 0u));
    // Walk the warps backwards: where the material now here came from.
    for (var n = brick.count; n > 0u && level > 0u; n--) {
        let o = (clayLists[brick.offset + n - 1u] & ~CLAY_GROUP_END) * 5u;
        let kind = i32(clayOps[o].x);
        if (!clayIsWarp(kind)) {
            continue;
        }
        let at = levels[level];
        let first = at - clayWarp(kind, o, at);
        level--;
        levels[level] = at - clayWarp(kind, o, first);
    }

    var acc = vec4<f32>(1.0, 1.0, 1.0, CLAY_EMPTY);
    var stroke = CLAY_EMPTY;
    level = 0u;
    for (var n = 0u; n < brick.count; n++) {
        let entry = clayLists[brick.offset + n];
        let o = (entry & ~CLAY_GROUP_END) * 5u;
        let head = clayOps[o];
        let kind = i32(head.x);
        if (clayIsWarp(kind)) {
            level++;
            continue;
        }
        let p = levels[level];
        if (kind == ${OP.segment}) {
            stroke = min(stroke, claySegment(o, p));
            if ((entry & CLAY_GROUP_END) != 0u) {
                acc = clayJoin(acc, stroke, head.y, head.z, clayOps[o + 4u]);
                stroke = CLAY_EMPTY;
            }
        } else if (kind == ${OP.inflate}) {
            let p1 = clayOps[o + 1u];
            let r = p - p1.xyz;
            acc.w -= clayOps[o + 2u].x * clayFade(dot(r, r), p1.w);
        } else if (kind == ${OP.detail}) {
            if (clay.bake.w < 0.5) {
                acc.w -= clayDetail(o, p, footprint);
            }
        } else {
            acc = clayJoin(acc, claySolid(kind, o, p), head.y, head.z, clayOps[o + 4u]);
        }
    }
    return acc;
}

// Unit outward normal in the field's space: the gradient from four samples
// e apart, which also band-limits it to the pixel when e follows the footprint.
fn clayNormal(p: vec3<f32>, brick: ClayBrick, e: f32, footprint: f32) -> vec3<f32> {
    let k = vec2<f32>(1.0, -1.0);
    return normalize(
        k.xyy * clayField(p + k.xyy * e, brick, footprint).w +
        k.yyx * clayField(p + k.yyx * e, brick, footprint).w +
        k.yxy * clayField(p + k.yxy * e, brick, footprint).w +
        k.xxx * clayField(p + k.xxx * e, brick, footprint).w,
    );
}

struct ClayShading {
    normal : vec3<f32>,
    color  : vec3<f32>,
};

// What shading needs at a surface point, from the same four evaluations:
// the normal as above, and the color averaged over the pixel.
fn clayShading(p: vec3<f32>, brick: ClayBrick, e: f32, footprint: f32) -> ClayShading {
    let k = vec2<f32>(1.0, -1.0);
    let a = clayField(p + k.xyy * e, brick, footprint);
    let b = clayField(p + k.yyx * e, brick, footprint);
    let c = clayField(p + k.yxy * e, brick, footprint);
    let d = clayField(p + k.xxx * e, brick, footprint);
    return ClayShading(
        normalize(k.xyy * a.w + k.yyx * b.w + k.yxy * c.w + k.xxx * d.w),
        0.25 * (a.rgb + b.rgb + c.rgb + d.rgb),
    );
}
`;

/** The ray that finds the surface; needs the drawing bindings. */
export const clayRayWgsl = /* wgsl */ `
struct ClayRay {
    origin    : vec3<f32>, // field space
    dir       : vec3<f32>, // field space, per unit of world distance
    // A pixel's size at distance t is length(spread0 + t * spread1), field space.
    spread0   : vec3<f32>,
    spread1   : vec3<f32>,
};

struct ClayHit {
    // 1 = the ray meets the surface; between 0 and 1 it passes within a
    // pixel of it (the share of the pixel the surface covers); 0 = a miss.
    cover : f32,
    t     : f32,
};

const CLAY_MAX_STEPS = 96;

// The cached smooth field at a point of a brick: trilinear between
// the lattice points around it.
fn clayCached(p: vec3<f32>, index: u32, brick: ClayBrick) -> f32 {
    let cells = u32(clay.bake.x);
    let side = cells + 1u;
    let u = clamp((p - brick.origin) / brick.size, vec3<f32>(0.0), vec3<f32>(1.0)) * f32(cells);
    let lo = min(vec3<u32>(u), vec3<u32>(cells - 1u));
    let f = u - vec3<f32>(lo);
    let at = index * side * side * side + (lo.z * side + lo.y) * side + lo.x;
    let dy = side;
    let dz = side * side;
    let x00 = mix(clayCache[at], clayCache[at + 1u], f.x);
    let x10 = mix(clayCache[at + dy], clayCache[at + dy + 1u], f.x);
    let x01 = mix(clayCache[at + dz], clayCache[at + dz + 1u], f.x);
    let x11 = mix(clayCache[at + dz + dy], clayCache[at + dz + dy + 1u], f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
}

// The detail records that close a brick's list, summed at a point: with
// the cache they give the field without evaluating the rest of the list.
fn clayTrailingDetail(pIn: vec3<f32>, brick: ClayBrick, footprint: f32) -> f32 {
    let bits = u32(clay.params.x);
    let p = select(pIn, abs(pIn), vec3<bool>((bits & 1u) != 0u, (bits & 2u) != 0u, (bits & 4u) != 0u));
    var sum = 0.0;
    for (var n = 0u; n < u32(brick.detail.w); n++) {
        let o = (clayLists[brick.offset + brick.count - 1u - n] & ~CLAY_GROUP_END) * 5u;
        sum += clayDetail(o, p, footprint);
    }
    return sum;
}

// How far the cached value can be from the field in a brick: the cache's
// own error there, and detail it holds no record of.
fn clayCacheBlur(index: u32, brick: ClayBrick) -> f32 {
    let side = u32(clay.bake.x) + 1u;
    return clayCache[u32(clay.bake.z) * side * side * side + index] + brick.detail.z;
}

// The field at a point of the ray: from the cache (with the detail on top
// of it) where that is trusted, else evaluated.
fn clayAlong(ray: ClayRay, t: f32, index: u32, brick: ClayBrick, trusted: bool) -> f32 {
    let p = ray.origin + ray.dir * t;
    let footprint = max(length(ray.spread0 + ray.spread1 * t), 1e-6) * clay.params.y;
    if (trusted) {
        return clayCached(p, index, brick) - clayTrailingDetail(p, brick, footprint);
    }
    return clayField(p, brick, footprint).w;
}

// Sphere tracing inside one brick, between t0 and t1 along the ray. While
// the cache (with the detail on top of it) shows the ray clear of the
// surface it sets the step, for a few reads. At the surface the cache
// decides where it places the surface within a tenth of a pixel; otherwise
// (close up, or in a brick it fits badly) the field itself is evaluated.
// Steps follow the field's Lipschitz bound; one that still lands inside is
// bisected back.
fn clayMarch(ray: ClayRay, index: u32, t0: f32, t1: f32) -> ClayHit {
    let brick = clayBricks[index];
    let speed = length(ray.dir);
    let cached = clay.bake.x > 0.5;
    var blur = 0.0;
    if (cached) {
        blur = clayCacheBlur(index, brick);
    }
    var t = t0;
    var before = t0;
    var best = 1e9;
    var bestT = t0;
    for (var i = 0; i < CLAY_MAX_STEPS; i++) {
        let footprint = max(length(ray.spread0 + ray.spread1 * t), 1e-6);
        let trusted = cached && blur <= 0.1 * footprint;
        var d : f32;
        if (cached) {
            let p = ray.origin + ray.dir * t;
            let base = clayCached(p, index, brick);
            // Outside the shell the trailing detail can reach, the smooth
            // field alone bounds the distance: no detail to evaluate.
            let outside = base - blur - (brick.detail.x - brick.detail.z);
            if (outside > footprint && t < t1) {
                before = t;
                t = min(t + outside * brick.stepScale / speed, t1);
                continue;
            }
            d = base - clayTrailingDetail(p, brick, footprint * clay.params.y);
            let clear = d - blur;
            // Within a pixel of the surface the distance also sets how much
            // of the pixel an edge covers: only a trusted cache may say.
            if (t < t1 && (clear > footprint || (trusted && clear > 0.25 * footprint))) {
                let ratio = d / footprint;
                if (ratio < best) {
                    best = ratio;
                    bestT = t;
                }
                before = t;
                t = min(t + max(clear * brick.detail.y, 0.25 * footprint) / speed, t1);
                continue;
            }
            if (!trusted) {
                d = clayAlong(ray, t, index, brick, false);
            }
        } else {
            d = clayAlong(ray, t, index, brick, false);
        }
        if (d < 0.0) {
            if (i == 0) {
                // Already inside on entry: the surface is the brick's face
                // (a sculpture clipped by its bounds, or by the near plane).
                return ClayHit(1.0, t);
            }
            var lo = before;
            var hi = t;
            for (var j = 0; j < 6; j++) {
                let midT = 0.5 * (lo + hi);
                if (clayAlong(ray, midT, index, brick, trusted) < 0.0) {
                    hi = midT;
                } else {
                    lo = midT;
                }
            }
            return ClayHit(1.0, hi);
        }
        if (d < 0.25 * footprint) {
            return ClayHit(1.0, t);
        }
        let ratio = d / footprint;
        if (ratio < best) {
            best = ratio;
            bestT = t;
        }
        if (t >= t1) {
            break;
        }
        before = t;
        // Detail moves the surface by at most its relief: outside that shell
        // the smooth field sets the step, inside it the detailed one does.
        let safe = max((d - 2.0 * brick.detail.x) * brick.stepScale, d * brick.detail.y);
        t = min(t + max(safe, 0.25 * footprint) / speed, t1);
    }
    return ClayHit(clamp(1.0 - best, 0.0, 1.0), bestT);
}

// The cached color at a point of a brick: trilinear on its color lattice.
fn clayCachedColor(p: vec3<f32>, index: u32, brick: ClayBrick) -> vec3<f32> {
    let full = u32(clay.bake.x) + 1u;
    let bricks = u32(clay.bake.z);
    let cells = u32(clay.bake.x) / 2u;
    let side = cells + 1u;
    let u = clamp((p - brick.origin) / brick.size, vec3<f32>(0.0), vec3<f32>(1.0)) * f32(cells);
    let lo = min(vec3<u32>(u), vec3<u32>(cells - 1u));
    let f = u - vec3<f32>(lo);
    let first = bricks * (full * full * full + 1u) + index * side * side * side * 3u;
    var corners : array<vec3<f32>, 8>;
    for (var c = 0u; c < 8u; c++) {
        let at = first + (((lo.z + (c >> 2u)) * side + lo.y + ((c >> 1u) & 1u)) * side + lo.x + (c & 1u)) * 3u;
        corners[c] = vec3<f32>(clayCache[at], clayCache[at + 1u], clayCache[at + 2u]);
    }
    return mix(
        mix(mix(corners[0], corners[1], f.x), mix(corners[2], corners[3], f.x), f.y),
        mix(mix(corners[4], corners[5], f.x), mix(corners[6], corners[7], f.x), f.y),
        f.z,
    );
}

// What shading needs at a surface point, from the cache alone: the normal
// from the cached field's gradient less the trailing detail's, the color
// from the color lattice. No record of the brick's list is evaluated
// beyond that detail.
fn clayCachedShading(p: vec3<f32>, index: u32, e: f32, footprint: f32) -> ClayShading {
    let brick = clayBricks[index];
    let k = vec2<f32>(1.0, -1.0);
    // Four taps e apart sum to 4e times the gradient.
    var gradient = (
        k.xyy * clayCached(p + k.xyy * e, index, brick) +
        k.yyx * clayCached(p + k.yyx * e, index, brick) +
        k.yxy * clayCached(p + k.yxy * e, index, brick) +
        k.xxx * clayCached(p + k.xxx * e, index, brick)
    ) / (4.0 * e);
    let bits = u32(clay.params.x);
    let mirrored = vec3<bool>((bits & 1u) != 0u, (bits & 2u) != 0u, (bits & 4u) != 0u);
    let folded = select(p, abs(p), mirrored);
    let side = select(vec3<f32>(1.0), sign(p), mirrored);
    for (var n = 0u; n < u32(brick.detail.w); n++) {
        let o = (clayLists[brick.offset + brick.count - 1u - n] & ~CLAY_GROUP_END) * 5u;
        gradient -= side * clayDetailGradient(o, folded, footprint);
    }
    var color = vec3<f32>(1.0);
    if (clay.bake.y > 0.5) {
        color = clayCachedColor(p, index, brick);
    }
    return ClayShading(normalize(gradient + vec3<f32>(1e-20)), color);
}

// Which way a surface point faces, for a shadow map's depth bias: from the
// cache where there is one (the bias needs no more), else from the field.
fn clayFacing(p: vec3<f32>, index: u32, e: f32) -> vec3<f32> {
    let brick = clayBricks[index];
    if (clay.bake.x < 0.5) {
        return clayNormal(p, brick, e, 0.0);
    }
    let k = vec2<f32>(1.0, -1.0);
    let h = max(e, 0.5 * brick.size / clay.bake.x);
    return normalize(
        k.xyy * clayCached(p + k.xyy * h, index, brick) +
        k.yyx * clayCached(p + k.yyx * h, index, brick) +
        k.yxy * clayCached(p + k.yxy * h, index, brick) +
        k.xxx * clayCached(p + k.xxx * h, index, brick) + vec3<f32>(1e-12),
    );
}

// The ray through a fragment, in the field's space.
fn clayPixelRay(fragXY: vec2<f32>, screen: vec2<f32>, invViewProj: mat4x4<f32>) -> ClayRay {
    let ndc = vec2<f32>(fragXY.x / screen.x * 2.0 - 1.0, 1.0 - fragXY.y / screen.y * 2.0);
    let ndc2 = ndc + vec2<f32>(2.0 / screen.x, 0.0);
    let n0 = invViewProj * vec4<f32>(ndc, 0.0, 1.0);
    let f0 = invViewProj * vec4<f32>(ndc, 1.0, 1.0);
    let n1 = invViewProj * vec4<f32>(ndc2, 0.0, 1.0);
    let f1 = invViewProj * vec4<f32>(ndc2, 1.0, 1.0);
    let o0 = n0.xyz / n0.w;
    let o1 = n1.xyz / n1.w;
    let d0 = normalize(f0.xyz / f0.w - o0);
    let d1 = normalize(f1.xyz / f1.w - o1);
    var ray : ClayRay;
    ray.origin = (clay.invModel * vec4<f32>(o0, 1.0)).xyz;
    ray.dir = (clay.invModel * vec4<f32>(d0, 0.0)).xyz;
    ray.spread0 = (clay.invModel * vec4<f32>(o1, 1.0)).xyz - ray.origin;
    ray.spread1 = (clay.invModel * vec4<f32>(d1, 0.0)).xyz - ray.dir;
    return ray;
}

// Where the ray is inside the grid's box: x = entry (never behind the near
// plane), y = exit; x > y when it misses.
fn clayGridSpan(ray: ClayRay, inv: vec3<f32>) -> vec2<f32> {
    let lo3 = (clay.grid.xyz - ray.origin) * inv;
    let hi3 = (clay.grid.xyz + clay.grid.w * clay.dims.xyz - ray.origin) * inv;
    let lo = min(lo3, hi3);
    let hi = max(lo3, hi3);
    return vec2<f32>(max(max(lo.x, max(lo.y, lo.z)), 0.0), min(hi.x, min(hi.y, hi.z)));
}

struct ClayPoint {
    cover     : f32,
    local     : vec3<f32>,
    footprint : f32,
    brick     : u32,
};

struct ClaySurface {
    // The first surface the ray meets (cover 1), if any.
    hit  : ClayPoint,
    // The closest silhouette it grazes before that: cover = the share of
    // the pixel that silhouette takes.
    edge : ClayPoint,
    dir  : vec3<f32>, // the ray, field space per unit of world distance
};

fn clayPointAt(ray: ClayRay, hit: ClayHit, brick: u32) -> ClayPoint {
    return ClayPoint(hit.cover, ray.origin + ray.dir * hit.t, max(length(ray.spread0 + ray.spread1 * hit.t), 1e-6), brick);
}

// The surface a fragment of the grid's box sees: one ray per pixel walks
// the bricks it crosses, front to back (a 3D DDA), marching only inside
// those the surface can cross and stopping at the first hit. Both faces of
// the box are rasterized (the camera may be inside it): the far one works.
fn claySurface(fragXY: vec2<f32>, screen: vec2<f32>, invViewProj: mat4x4<f32>, boxPoint: vec3<f32>) -> ClaySurface {
    var out : ClaySurface;
    out.hit.cover = 0.0;
    out.edge.cover = 0.0;
    let ray = clayPixelRay(fragXY, screen, invViewProj);
    out.dir = ray.dir;
    let safe = select(ray.dir, vec3<f32>(1e-20), abs(ray.dir) < vec3<f32>(1e-20));
    let inv = 1.0 / safe;
    let span = clayGridSpan(ray, inv);
    let tFace = dot(boxPoint - ray.origin, ray.dir) / dot(ray.dir, ray.dir);
    if (span.x > span.y || tFace < 0.5 * (span.x + span.y)) {
        return out;
    }
    let size = clay.grid.w;
    let dims = vec3<i32>(clay.dims.xyz);
    let stride = vec3<i32>(sign(safe));
    var t = span.x;
    var cell = clamp(vec3<i32>(floor((ray.origin + ray.dir * t - clay.grid.xyz) / size)), vec3<i32>(0), dims - vec3<i32>(1));
    // Where the ray leaves the current cell along each axis.
    var leave = (clay.grid.xyz + size * (vec3<f32>(cell) + max(vec3<f32>(stride), vec3<f32>(0.0))) - ray.origin) * inv;
    let advance = abs(size * inv);
    for (var n = 0; n < 160; n++) {
        let tExit = min(min(leave.x, min(leave.y, leave.z)), span.y);
        let id = clayGrid[u32((cell.z * dims.y + cell.y) * dims.x + cell.x)];
        if (id != 0u && tExit > t) {
            let found = clayMarch(ray, id - 1u, t, tExit);
            if (found.cover >= 1.0) {
                out.hit = clayPointAt(ray, found, id - 1u);
                break;
            }
            if (found.cover > out.edge.cover) {
                out.edge = clayPointAt(ray, found, id - 1u);
            }
        }
        if (leave.x <= leave.y && leave.x <= leave.z) {
            cell.x += stride.x;
            leave.x += advance.x;
        } else if (leave.y <= leave.z) {
            cell.y += stride.y;
            leave.y += advance.y;
        } else {
            cell.z += stride.z;
            leave.z += advance.z;
        }
        t = tExit;
        if (t >= span.y || any(cell < vec3<i32>(0)) || any(cell >= dims)) {
            break;
        }
    }
    return out;
}

const CLAY_CUBE = array<u32, 36>(
    0u, 2u, 6u, 0u, 6u, 4u, 1u, 5u, 7u, 1u, 7u, 3u,
    0u, 4u, 5u, 0u, 5u, 1u, 2u, 3u, 7u, 2u, 7u, 6u,
    0u, 1u, 3u, 0u, 3u, 2u, 4u, 6u, 7u, 4u, 7u, 5u,
);

// A corner of the grid's box, field space.
fn clayBoxCorner(vertex: u32) -> vec3<f32> {
    var cube = CLAY_CUBE;
    let c = cube[vertex];
    return clay.grid.xyz + clay.grid.w * clay.dims.xyz * vec3<f32>(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
}
`;
