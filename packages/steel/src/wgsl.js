// WGSL sources for the Steel colored-propagation port.
import { ART } from './artwgsl.js';
// Bodies use COM twists (v, w) in world frame; impulses are (force, torque about COM).

export const BUFFERS = {
  statF: 'array<vec4f>',
  statU: 'array<u32>',
  poses: 'array<vec4f>',
  vel: 'array<vec4f>',
  counters: 'array<atomic<u32>>',
  pairs: 'array<vec2u>',
  contacts: 'array<vec4f>',
  sched: 'array<atomic<u32>>',
  rows: 'array<vec4f>',
  warm: 'array<atomic<u32>>',
  art: 'array<f32>',
  stats: 'array<atomic<u32>>',
  indirect: 'array<u32>',
  scratch: 'array<vec4u>',
  craw: 'array<vec4f>',
};
export const BUFFER_NAMES = Object.keys(BUFFERS);

function decls(uses) {
  let s = '';
  for (const name of uses) {
    const i = BUFFER_NAMES.indexOf(name);
    const ro = name === 'statF' || name === 'statU';
    s += `@group(0) @binding(${i}) var<storage, ${ro ? 'read' : 'read_write'}> ${name}: ${BUFFERS[name]};\n`;
  }
  return s;
}

const PARAMS = /* wgsl */ `
struct Params {
  dt: f32, substep: u32, parity: u32, iterations: u32,
  phase: f32, frame_dt: f32, beta: f32, max_depen: f32,
  gravity: vec4f,
  pad0: f32, warm_scale: f32, path_frames: u32, driven: u32,
  integral_count: u32, reg: f32, pad1: u32, pad2: u32,
  pick_local: vec4f,   // grab point in the body's COM frame, w = body index
  pick_target: vec4f,  // world target, w = 1 while dragging
};
@group(1) @binding(0) var<uniform> P: Params;
`;

const MATH = /* wgsl */ `
fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let u = q.xyz; let s = q.w;
  return 2.0 * dot(u, v) * u + (s * s - dot(u, u)) * v + 2.0 * s * cross(u, v);
}
fn qinvrot(q: vec4f, v: vec3f) -> vec3f { return qrot(vec4f(-q.xyz, q.w), v); }
fn qmul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
fn qconj(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }
fn qaxis(axis: vec3f, angle: f32) -> vec4f { return vec4f(axis * sin(0.5 * angle), cos(0.5 * angle)); }
fn qmat(q: vec4f) -> mat3x3f {
  return mat3x3f(qrot(q, vec3f(1.0, 0.0, 0.0)), qrot(q, vec3f(0.0, 1.0, 0.0)), qrot(q, vec3f(0.0, 0.0, 1.0)));
}
fn hash_u32(x0: u32) -> u32 {
  var x = x0;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
`;

// Body data helpers (statF body block: 8 vec4 per body).
const BODY = /* wgsl */ `
fn body_inv_mass(b: i32) -> f32 { return statF[SF_BODY + u32(b) * 8u].x; }
fn body_kind(b: i32) -> u32 { return u32(statF[SF_BODY + u32(b) * 8u].y); }
fn body_art(b: i32) -> i32 { return i32(statF[SF_BODY + u32(b) * 8u].z); }
fn body_link(b: i32) -> i32 { return i32(statF[SF_BODY + u32(b) * 8u].w); }
fn body_com_local(b: i32) -> vec3f { return statF[SF_BODY + u32(b) * 8u + 1u].xyz; }
fn same_art(a: i32, b: i32) -> bool {
  return a >= 0 && b >= 0 && body_kind(a) == 2u && body_kind(b) == 2u && body_art(a) == body_art(b);
}
fn body_mass(b: i32) -> f32 { return statF[SF_BODY + u32(b) * 8u + 1u].w; }
// angular damping, max linear velocity, max angular velocity, max depenetration velocity (<0 unbounded)
fn body_limits(b: i32) -> vec4f {
  let o = SF_BODY + u32(b) * 8u;
  return vec4f(statF[o + 3u].w, statF[o + 4u].w, statF[o + 5u].w, statF[o + 6u].w);
}
fn depen_cap(a: i32, b: i32) -> f32 {
  var m = 1e20;
  if (a >= 0) { let l = body_limits(a).w; if (l > 0.0) { m = min(m, l); } }
  if (b >= 0) { let l = body_limits(b).w; if (l > 0.0) { m = min(m, l); } }
  return m;
}
fn body_flags(b: i32) -> u32 { if (b < 0) { return 0u; } return u32(statF[SF_BODY + u32(b) * 8u + 7u].w); }
fn body_radius(b: i32) -> f32 { if (b < 0) { return 1e30; } return statF[SF_BODY + u32(b) * 8u + 2u].w; }
// framefields: gravity scale, linear damping (1/s), planar lock (1: moves in world xy, turns about z), 0.
fn body_ext(b: i32) -> vec4f { return statF[SF_BODYX + u32(b)]; }
// framefields: a triangle mesh shape's BVH root node + 1, 0 for every other shape.
fn mesh_root(s: u32) -> u32 { return u32(statF[SF_SHAPE + s * 7u + 5u].w); }
// Friction-anchor table after the contact warm table: keys [2 * AH], then AVN values per slot
// (pair key, anchor index, anchor, displacement, tangent impulse and normal in body-a frame).
const AK: u32 = 10u * WH;
const AV: u32 = 10u * WH + 2u * AH;
const AVN: u32 = 14u;
fn anchor_hash(pair: u32, k: u32) -> u32 { return max(hash_u32(pair * 2u + k), 1u); }
fn body_inertia(b: i32) -> mat3x3f {
  let o = SF_BODY + u32(b) * 8u;
  return transpose(mat3x3f(statF[o + 2u].xyz, statF[o + 3u].xyz, statF[o + 4u].xyz));
}
fn body_inv_inertia(b: i32) -> mat3x3f {
  let o = SF_BODY + u32(b) * 8u;
  return transpose(mat3x3f(statF[o + 5u].xyz, statF[o + 6u].xyz, statF[o + 7u].xyz));
}
`;

const HEADER = (C, uses) => {
  let s = '';
  // F_-prefixed constants are floats, the rest u32.
  for (const [k, v] of Object.entries(C)) s += k.startsWith('F_') ? `const ${k}: f32 = ${Number(v).toExponential()};\n` : `const ${k}: u32 = ${v}u;\n`;
  return s + PARAMS + decls(uses) + MATH;
};

// ---------------------------------------------------------------------------
// Shape world poses and AABBs.
export function shapesWGSL(C) {
  return HEADER(C, ['statF', 'statU', 'poses']) + BODY + /* wgsl */ `
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s >= NS) { return; }
  let o = SF_SHAPE + s * 7u;
  let body = i32(statF[o].x);
  let hull = u32(statF[o].y);
  var bp = vec3f(0.0); var bq = vec4f(0.0, 0.0, 0.0, 1.0);
  if (body >= 0) {
    let c = poses[P_BODY + u32(body) * 2u].xyz;
    bq = poses[P_BODY + u32(body) * 2u + 1u];
    bp = c - qrot(bq, body_com_local(body));
  }
  let sp = bp + qrot(bq, statF[o + 1u].xyz);
  let sq = normalize(qmul(bq, statF[o + 2u]));
  poses[P_SHAPE + s * 2u] = vec4f(sp, 0.0);
  poses[P_SHAPE + s * 2u + 1u] = sq;
  if (statF[o + 3u].x == 4.0) {  // planes are unbounded
    poses[P_AABB + s * 2u] = vec4f(vec3f(-1e6), 0.0);
    poses[P_AABB + s * 2u + 1u] = vec4f(vec3f(1e6), 0.0);
    return;
  }
  var hc = statF[SF_HAABB + hull * 2u].xyz;
  var hh = statF[SF_HAABB + hull * 2u + 1u].xyz;
  let root = mesh_root(s);
  if (root > 0u) {  // framefields: a triangle mesh's box is its BVH root's
    let lo = statF[SF_BVH + (root - 1u) * 2u].xyz; let hi = statF[SF_BVH + (root - 1u) * 2u + 1u].xyz;
    hc = 0.5 * (lo + hi); hh = 0.5 * (hi - lo);
  }
  let m = qmat(sq);
  let c = sp + m * hc;
  // framefields: the border radius (statF[o + 1u].w) widens the box like the gap.
  let e = abs(m[0]) * hh.x + abs(m[1]) * hh.y + abs(m[2]) * hh.z + vec3f(statF[o].w + statF[o + 1u].w);
  poses[P_AABB + s * 2u] = vec4f(c - e, 0.0);
  poses[P_AABB + s * 2u + 1u] = vec4f(c + e, 0.0);
}
`;
}

// ---------------------------------------------------------------------------
// All-pairs broadphase (small shape counts).
export function broadWGSL(C) {
  return HEADER(C, ['statF', 'statU', 'poses', 'counters', 'pairs']) + BODY + /* wgsl */ `
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; let j = gid.y;
  if (i >= NS || j >= NS || i >= j) { return; }
  let bi = i32(statF[SF_SHAPE + i * 7u].x);
  let bj = i32(statF[SF_SHAPE + j * 7u].x);
  if (bi == bj) { return; }
  if (bi < 0 && bj < 0) { return; }
  // Bodies that no contact can move: static, immovable links and kinematic bodies.
  let fi = bi < 0 || body_kind(bi) == 3u || (body_flags(bi) & 1u) != 0u;
  let fj = bj < 0 || body_kind(bj) == 3u || (body_flags(bj) & 1u) != 0u;
  if (fi && fj) { return; }
  let k = i * NS + j;
  if ((statU[SU_FILTER + (k >> 5u)] & (1u << (k & 31u))) != 0u) { return; }
  let lo_i = poses[P_AABB + i * 2u].xyz; let hi_i = poses[P_AABB + i * 2u + 1u].xyz;
  let lo_j = poses[P_AABB + j * 2u].xyz; let hi_j = poses[P_AABB + j * 2u + 1u].xyz;
  if (any(lo_i > hi_j) || any(lo_j > hi_i)) { return; }
  // framefields: a triangle mesh pairs the other shape with each triangle its box overlaps.
  let mi = mesh_root(i); let mj = mesh_root(j);
  if (mi != 0u || mj != 0u) {
    if (mi == 0u || mj == 0u) { mesh_pairs(select(i, j, mi != 0u), select(j, i, mi != 0u), max(mi, mj) - 1u); }
    return;
  }
  let slot = atomicAdd(&counters[0], 1u);
  if (slot < MAXP) { pairs[slot] = vec2u(i, j); }
}

// Triangle pairs of shape d and mesh shape m: (d | m << 16, triangle hull | bit 31). The BVH is walked
// with d's box in m's frame, widened by m's gap.
fn mesh_pairs(d: u32, m: u32, root: u32) {
  let mp = poses[P_SHAPE + m * 2u].xyz; let mq = poses[P_SHAPE + m * 2u + 1u];
  let lo = poses[P_AABB + d * 2u].xyz; let hi = poses[P_AABB + d * 2u + 1u].xyz;
  let c = qinvrot(mq, 0.5 * (lo + hi) - mp);
  let R = qmat(qconj(mq));
  let w = 0.5 * (hi - lo);
  let e = abs(R[0]) * w.x + abs(R[1]) * w.y + abs(R[2]) * w.z + vec3f(statF[SF_SHAPE + m * 7u].w);
  let qlo = c - e; let qhi = c + e;
  var stack: array<u32, 64>;
  stack[0] = root;
  var n = 1u;
  while (n > 0u) {
    n--;
    let k = stack[n];
    let a = statF[SF_BVH + k * 2u]; let b = statF[SF_BVH + k * 2u + 1u];
    if (any(a.xyz > qhi) || any(qlo > b.xyz)) { continue; }
    let first = u32(a.w); let count = u32(b.w);
    if (count == 0u) {
      if (n + 2u <= 64u) { stack[n] = first; stack[n + 1u] = first + 1u; n += 2u; }
      continue;
    }
    for (var t = 0u; t < count; t++) {
      let h = first + t;
      let tc = statF[SF_HAABB + h * 2u].xyz; let th = statF[SF_HAABB + h * 2u + 1u].xyz;
      if (any(tc - th > qhi) || any(qlo > tc + th)) { continue; }
      let slot = atomicAdd(&counters[0], 1u);
      if (slot < MAXP) { pairs[slot] = vec2u(d | (m << 16u), h | 0x80000000u); }
    }
  }
}
`;
}

// ---------------------------------------------------------------------------
// Convex hull narrowphase: SAT over face normals (plus edge pairs for small hulls),
// reference-face clipping, reduction to four points.
export function narrowWGSL(C) {
  return (C.SG ? 'enable subgroups;\ndiagnostic(off, subgroup_uniformity);\n' : '') + HEADER(C, ['statF', 'statU', 'poses', 'counters', 'pairs', 'contacts']) + BODY + /* wgsl */ `

fn hv(h: u32, i: u32) -> vec3f { return statF[SF_VERTS + statU[SU_HULL + h * 4u] + i].xyz; }
fn hnv(h: u32) -> u32 { return statU[SU_HULL + h * 4u + 1u]; }
fn hfo(h: u32) -> u32 { return statU[SU_HULL + h * 4u + 2u]; }
fn hnf(h: u32) -> u32 { return statU[SU_HULL + h * 4u + 3u]; }
fn fplane(f: u32) -> vec4f { return statF[SF_FPLANE + f]; }
fn fstart(f: u32) -> u32 { return statU[SU_FACE + f * 2u]; }
fn fcount(f: u32) -> u32 { return statU[SU_FACE + f * 2u + 1u]; }
fn fvert(k: u32) -> u32 { return statU[SU_FV + k]; }
fn hne(h: u32) -> u32 { return statU[SU_HEDGE + h * 2u + 1u]; }
// Hull edge k: vertices v0 < v1 and its two faces.
fn hedge(h: u32, k: u32) -> vec4u { let o = SU_EDGE + (statU[SU_HEDGE + h * 2u] + k) * 4u; return vec4u(statU[o], statU[o + 1u], statU[o + 2u], statU[o + 3u]); }

// max over faces of A of min over B verts of (n.x - d), B given in A frame by (R, t).
struct FaceQ { sep: f32, face: u32 };
fn face_query(ha: u32, hb: u32, rq: vec4f, t: vec3f, lane: u32) -> FaceQ {
  var best = FaceQ(-1e30, 0u);
  let fo = hfo(ha); let nf = hnf(ha); let nv = hnv(hb);
  for (var f = lane; f < nf; f += NLANE) {
    let pl = fplane(fo + f);
    let nb = qinvrot(rq, pl.xyz);  // normal in B frame
    var m = 1e30;
    for (var v = 0u; v < nv; v++) { m = min(m, dot(nb, hv(hb, v))); }
    let s = m + dot(pl.xyz, t) - pl.w;
    if (s > best.sep) { best = FaceQ(s, f); }
  }
  return best;
}

fn support_min(h: u32, n: vec3f) -> f32 {
  var m = 1e30;
  for (var v = 0u; v < hnv(h); v++) { m = min(m, dot(n, hv(h, v))); }
  return m;
}
fn support_max(h: u32, n: vec3f) -> f32 {
  var m = -1e30;
  for (var v = 0u; v < hnv(h); v++) { m = max(m, dot(n, hv(h, v))); }
  return m;
}

struct EdgeQ { sep: f32, axis: vec3f, a0: vec3f, a1: vec3f, b0: vec3f, b1: vec3f, id: u32 };
// Edge-edge axes in A frame; edges taken from face loops with v0 < v1.
fn edge_query(ha: u32, hb: u32, rq: vec4f, t: vec3f, lane: u32) -> EdgeQ {
  var best = EdgeQ(-1e30, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
  let foa = hfo(ha); let fob = hfo(hb);
  let cena = statF[SF_HAABB + ha * 2u].xyz;
  let cenb = qrot(rq, statF[SF_HAABB + hb * 2u].xyz) + t;
  let nea = hne(ha); let neb = hne(hb);
  for (var k = lane; k < nea * neb; k += NLANE) {
    let ea_ = hedge(ha, k / neb); let eb_ = hedge(hb, k % neb);
    // Gauss map: only edge pairs whose normal arcs cross build a face of the Minkowski difference
    // (Gregorius); the margin keeps the near-boundary pairs the exact support test below may accept.
    let a = fplane(foa + ea_.z).xyz; let b = fplane(foa + ea_.w).xyz;
    let c = -qrot(rq, fplane(fob + eb_.z).xyz); let d = -qrot(rq, fplane(fob + eb_.w).xyz);
    let bxa = cross(b, a); let dxc = cross(d, c);
    let cba = dot(c, bxa); let dba = dot(d, bxa); let adc = dot(a, dxc); let bdc = dot(b, dxc);
    if (cba * dba > 1e-3 || adc * bdc > 1e-3 || cba * bdc < -1e-3) { continue; }
    let va0 = ea_.x; let va1 = ea_.y; let vb0 = eb_.x; let vb1 = eb_.y;
    let a0 = hv(ha, va0); let a1 = hv(ha, va1);
    let ea = a1 - a0;
    let b0 = qrot(rq, hv(hb, vb0)) + t; let b1 = qrot(rq, hv(hb, vb1)) + t;
    var ax = cross(ea, b1 - b0);
    let l = length(ax);
    if (l < 1e-6 * length(ea) * length(b1 - b0)) { continue; }
    ax = ax / l;
    if (dot(ax, cenb - cena) < 0.0) { ax = -ax; }
    let amax = support_max(ha, ax); let bmin = dot(ax, t) + support_min(hb, qinvrot(rq, ax));
    let s = bmin - amax;
    // Only the edges that are the supports along the axis: parallel edges share the axis and
    // separation, and the closest points of a non-supporting pair land on the wrong edges.
    let tol = 1e-4 + 1e-3 * (length(ea) + length(b1 - b0));
    if (dot(ax, a0) < amax - tol || dot(ax, a1) < amax - tol || dot(ax, b0) > bmin + tol || dot(ax, b1) > bmin + tol) { continue; }
    if (s > best.sep) { best = EdgeQ(s, ax, a0, a1, b0, b1, (va0 << 24u) ^ (va1 << 16u) ^ (vb0 << 8u) ^ vb1); }
  }
  return best;
}

// 0 average, 1 min, 2 multiply, 3 max.
fn combine(a: f32, b: f32, mode: u32) -> f32 {
  if (mode == 1u) { return min(a, b); }
  if (mode == 2u) { return a * b; }
  if (mode == 3u) { return max(a, b); }
  return 0.5 * (a + b);
}

// framefields: a shape's border radius (rounded hulls). Detection runs on the cores with the
// threshold widened by both radii; emit moves each contact out to the rounded surfaces.
fn shape_round(s: u32) -> f32 { return statF[SF_SHAPE + s * 7u + 1u].w; }

fn emit(sa: u32, sb: u32, p0: vec3f, n: vec3f, phi0: f32, key0: u32) {
  // framefields: a mesh triangle's contacts keep keys of their own (warm starts, anchors).
  let key = select(key0, hash_u32(key0 ^ (tri_hull * 0x9e3779b1u + 0x7f4au)), tri_shape != 0xffffffffu);
  let ra = shape_round(sa); let rb = shape_round(sb);
  let phi = phi0 - ra - rb;
  let p = p0 + n * (0.5 * (ra - rb));
  let ba = i32(statF[SF_SHAPE + sa * 7u].x);
  let bb = i32(statF[SF_SHAPE + sb * 7u].x);
  // Pair materials by Steel's friction_combine (mu, torsional, rolling) and restitution_combine.
  let ma = statF[SF_SHAPE + sa * 7u + 4u]; let mb = statF[SF_SHAPE + sb * 7u + 4u];
  let mu = combine(statF[SF_SHAPE + sa * 7u].z, statF[SF_SHAPE + sb * 7u].z, FRICTION_COMBINE);
  // Angular coefficients: articulated contacts combine them under enable_torsional_rolling_friction;
  // free-body contacts take the larger of the shapes' steel:condim >= 4 (spin) / 6 (rolling) values.
  let art_c = (ba >= 0 && body_kind(ba) >= 2u) || (bb >= 0 && body_kind(bb) >= 2u);
  var mt = 0.0; var mr = 0.0;
  if (art_c) {
    if (ANG_ART == 1u) { mt = combine(ma.y, mb.y, FRICTION_COMBINE); mr = combine(ma.z, mb.z, FRICTION_COMBINE); }
  } else {
    mt = max(select(0.0, ma.y, ma.w >= 4.0), select(0.0, mb.y, mb.w >= 4.0));
    mr = max(select(0.0, ma.z, ma.w >= 6.0), select(0.0, mb.z, mb.w >= 6.0));
    if (F_FR_MUT >= 0.0) { mt = F_FR_MUT; }
    if (F_FR_MUR >= 0.0) { mr = F_FR_MUR; }
  }
  // Contact torsion radius (articulated contacts only): the larger of the two shapes'.
  let tr = select(0.0, max(statF[SF_SHAPE + sa * 7u + 3u].w, statF[SF_SHAPE + sb * 7u + 3u].w), art_c);
  let mat = vec3f(combine(clamp(ma.x, 0.0, 1.0), clamp(mb.x, 0.0, 1.0), RESTITUTION_COMBINE), mt, mr);
  var a = ba; var b = bb; var nn = n;
  var shape_mu = vec2f(statF[SF_SHAPE + sa * 7u].z, statF[SF_SHAPE + sb * 7u].z);
  if (a > b) { a = bb; b = ba; nn = -n; shape_mu = shape_mu.yx; }
  let k = atomicAdd(&counters[1], 1u);
  if (k >= MAXC) { return; }
  contacts[MAXC * 5u + k] = vec4f(shape_mu, 0.0, 0.0);
  contacts[k * 5u] = vec4f(p, phi);
  contacts[k * 5u + 1u] = vec4f(nn, mu);
  contacts[k * 5u + 2u] = vec4f(f32(a), f32(b), f32(key & 0xffffu), f32(key >> 16u));
  contacts[k * 5u + 3u] = vec4f(mat, tr);  // restitution, torsional, rolling, torsion radius
  // Contact compliance (contact_compliance): shapes' ke in series, kd summed.
  let ka = statF[SF_SHAPE + sa * 7u + 5u].x; let kb = statF[SF_SHAPE + sb * 7u + 5u].x;
  let kc = select(0.0, ka * kb / (ka + kb), CCOMPL == 1u && ka > 0.0 && kb > 0.0);
  // Reduction groups of the A and B shapes (body-pair contact reduction).
  var ga = statF[SF_SHAPE + sa * 7u + 5u].z; var gb = statF[SF_SHAPE + sb * 7u + 5u].z;
  if (ba > bb) { let t = ga; ga = gb; gb = t; }
  contacts[k * 5u + 4u] = vec4f(kc, statF[SF_SHAPE + sa * 7u + 5u].y + statF[SF_SHAPE + sb * 7u + 5u].y, ga, gb);
}

const NLANE: u32 = 32u;

// Hull support point along d (hull frame), computed across the subgroup.
${C.SG ? `fn sup_lane(h: u32, d: vec3f, lane: u32) -> vec3f {
  var best = -1e30; var bp = vec3f(0.0);
  for (var v = lane; v < hnv(h); v += NLANE) {
    let x = hv(h, v); let s = dot(d, x);
    if (s > best) { best = s; bp = x; }
  }
  let m = subgroupMax(best);
  let win = subgroupMin(select(0xffffffffu, lane, best == m));
  return subgroupShuffle(bp, win);
}` : `// Without subgroups each lane scans every vertex in the lanes' order (same tie-break).
fn sup_lane(h: u32, d: vec3f, lane: u32) -> vec3f {
  var best = -1e30; var bp = vec3f(0.0);
  for (var l = 0u; l < NLANE; l++) {
    for (var v = l; v < hnv(h); v += NLANE) {
      let x = hv(h, v); let s = dot(d, x);
      if (s > best) { best = s; bp = x; }
    }
  }
  return bp;
}`}

// Support of (B + sphere r) - (A + sphere r) along d, in A's frame.
fn sup_md(ha: u32, hb: u32, rq: vec4f, t: vec3f, r: f32, d: vec3f, lane: u32) -> vec3f {
  let sb = qrot(rq, sup_lane(hb, qinvrot(rq, d), lane)) + t;
  let sa = sup_lane(ha, -d, lane);
  return sb - sa + (2.0 * r) * normalize(d);
}

// Minkowski portal refinement (XenoCollide) on the shapes inflated by r.
// Returns (outward Minkowski normal, inflated depth); w < 0 when the inflated shapes miss.
fn mpr(ha: u32, hb: u32, rq: vec4f, t: vec3f, r: f32, lane: u32) -> vec4f {
  let none = vec4f(0.0, 0.0, 1.0, -1.0);
  var v0 = qrot(rq, statF[SF_HAABB + hb * 2u].xyz) + t - statF[SF_HAABB + ha * 2u].xyz;
  if (dot(v0, v0) < 1e-14) { v0 = vec3f(1e-5, 0.0, 0.0); }
  var n = -v0;
  var v1 = sup_md(ha, hb, rq, t, r, n, lane);
  if (dot(v1, n) <= 0.0) { return none; }
  n = cross(v1, v0);
  if (dot(n, n) < 1e-14) {
    let nn = normalize(v1 - v0);
    return vec4f(nn, dot(v1, nn));
  }
  var v2 = sup_md(ha, hb, rq, t, r, n, lane);
  if (dot(v2, n) <= 0.0) { return none; }
  n = cross(v1 - v0, v2 - v0);
  if (dot(n, v0) > 0.0) { let tmp = v1; v1 = v2; v2 = tmp; n = -n; }
  var v3 = vec3f(0.0);
  var found = false;
  for (var i = 0u; i < 32u; i++) {
    v3 = sup_md(ha, hb, rq, t, r, n, lane);
    if (dot(v3, n) <= 0.0) { return none; }
    if (dot(cross(v1, v3), v0) < 0.0) { v2 = v3; n = cross(v1 - v0, v3 - v0); continue; }
    if (dot(cross(v3, v2), v0) < 0.0) { v1 = v3; n = cross(v3 - v0, v2 - v0); continue; }
    found = true;
    break;
  }
  if (!found) { return none; }
  for (var i = 0u; i < 32u; i++) {
    n = cross(v2 - v1, v3 - v1);
    let ln = length(n);
    if (ln < 1e-12) { break; }
    n = n / ln;
    if (dot(n, v1 - v0) < 0.0) { n = -n; }
    let v4 = sup_md(ha, hb, rq, t, r, n, lane);
    let d1 = dot(n, v1);
    if (dot(v4, n) - d1 < 1e-6 || i == 31u) {
      if (d1 < 0.0) { return none; }
      return vec4f(n, d1);
    }
    if (dot(v4, n) < 0.0) { return none; }
    let c = cross(v4, v0);
    if (dot(v1, c) > 0.0) { if (dot(v2, c) > 0.0) { v1 = v4; } else { v3 = v4; } }
    else { if (dot(v3, c) > 0.0) { v2 = v4; } else { v1 = v4; } }
  }
  let d1 = dot(n, v1);
  if (d1 < 0.0) { return none; }
  return vec4f(n, d1);
}

fn shape_prim(s: u32) -> vec4f { return statF[SF_SHAPE + s * 7u + 3u]; }  // kind (0 hull, 1 sphere, 2 capsule, 4 plane), radius, half height

fn closest_seg(a0: vec3f, a1: vec3f, b0: vec3f, b1: vec3f) -> array<vec3f, 2> {
  let d1 = a1 - a0; let d2 = b1 - b0; let r = a0 - b0;
  let a = dot(d1, d1); let e = dot(d2, d2); let f = dot(d2, r);
  var s = 0.0; var t = 0.0;
  if (a <= 1e-12 && e <= 1e-12) { return array<vec3f, 2>(a0, b0); }
  if (a <= 1e-12) { t = clamp(f / e, 0.0, 1.0); }
  else {
    let c = dot(d1, r);
    if (e <= 1e-12) { s = clamp(-c / a, 0.0, 1.0); }
    else {
      let b = dot(d1, d2); let den = a * e - b * b;
      if (den > 1e-12) { s = clamp((b * f - c * e) / den, 0.0, 1.0); }
      t = (b * s + f) / e;
      if (t < 0.0) { t = 0.0; s = clamp(-c / a, 0.0, 1.0); }
      else if (t > 1.0) { t = 1.0; s = clamp((b - c) / a, 0.0, 1.0); }
    }
  }
  return array<vec3f, 2>(a0 + d1 * s, b0 + d2 * t);
}

// Newton's collide_sphere_sphere on core points p1, p2: distance, contact point, normal.
fn sphere_sphere(p1: vec3f, r1: f32, p2: vec3f, r2: f32) -> array<vec4f, 2> {
  let dv = p2 - p1;
  let l = length(dv);
  let n = select(dv / l, vec3f(1.0, 0.0, 0.0), l == 0.0);
  let d = l - (r1 + r2);
  return array<vec4f, 2>(vec4f(p1 + n * (r1 + 0.5 * d), d), vec4f(n, 0.0));
}

// Sphere/capsule pairs (sphere first): Newton's collide_sphere_sphere, collide_sphere_capsule and
// collide_capsule_capsule (two contacts only for exactly parallel capsules).
fn prim_prim(sa: u32, sb: u32, pa: vec3f, qa: vec4f, pb: vec3f, qb: vec4f, thresh: f32) {
  let A = statF[SF_SHAPE + sa * 7u + 6u]; let B = statF[SF_SHAPE + sb * 7u + 6u];
  let ua = qrot(qa, vec3f(0.0, 0.0, A.z)); let ub = qrot(qb, vec3f(0.0, 0.0, B.z));
  let base = hash_u32(sa * 7919u + sb * 104729u);
  var c: array<array<vec4f, 2>, 2>;
  var nc = 1u;
  if (u32(A.x) == GT_SPHERE) {
    let a = pb - ub; let ab = (pb + ub) - a;
    c[0] = sphere_sphere(pa, A.y, a + clamp(dot(pa - a, ab) / (dot(ab, ab) + 1e-6), 0.0, 1.0) * ab, B.y);
  } else {
    let dif = pa - pb;
    let ma = dot(ua, ua); let mb = -dot(ua, ub); let mc = dot(ub, ub);
    let u = -dot(ua, dif); let v = dot(ub, dif);
    let det = ma * mc - mb * mb;
    if (abs(det) >= 1e-15) {
      let inv_det = 1.0 / det;
      var x1 = (mc * u - mb * v) * inv_det; var x2 = (ma * v - mb * u) * inv_det;
      if (x1 > 1.0) { x1 = 1.0; x2 = (v - mb) / mc; } else if (x1 < -1.0) { x1 = -1.0; x2 = (v + mb) / mc; }
      if (x2 > 1.0) { x2 = 1.0; x1 = clamp((u - mb) / ma, -1.0, 1.0); } else if (x2 < -1.0) { x2 = -1.0; x1 = clamp((u + mb) / ma, -1.0, 1.0); }
      c[0] = sphere_sphere(pa + ua * x1, A.y, pb + ub * x2, B.y);
    } else {
      c[0] = sphere_sphere(pa + ua, A.y, pb + ub * clamp((v - mb) / mc, -1.0, 1.0), B.y);
      c[1] = sphere_sphere(pa - ua, A.y, pb + ub * clamp((v + mb) / mc, -1.0, 1.0), B.y);
      c[1][1] = c[0][1];
      nc = 2u;
    }
  }
  for (var i = 0u; i < nc; i++) {
    if (c[i][0].w <= thresh) { emit(sa, sb, c[i][0].xyz, c[0][1].xyz, c[i][0].w, hash_u32(base ^ (i * 977u + 13u))); }
  }
}

// Plane (shape pl, normal = its local z) against sphere, capsule, box or cylinder os: Newton's
// analytic routines (collide_plane_sphere/capsule/box/cylinder). flip when the plane is shape B.
fn plane_contacts(pl: u32, os: u32, pp: vec3f, pq: vec4f, op: vec3f, oq: vec4f, thresh: f32, flip: bool) {
  let n = qrot(pq, vec3f(0.0, 0.0, 1.0));
  let sa = select(pl, os, flip); let sb = select(os, pl, flip);
  let nab = select(n, -n, flip);
  let base = hash_u32(sa * 7919u + sb * 104729u);
  let g = statF[SF_SHAPE + os * 7u + 6u];
  let gt = u32(g.x);
  var d = array<f32, 4>(1e30, 1e30, 1e30, 1e30);
  var x: array<vec3f, 4>;
  var nc = 0u;
  if (gt == GT_SPHERE || gt == GT_CAPSULE) {
    let u = qrot(oq, vec3f(0.0, 0.0, g.z));
    for (var i = 0u; i < select(2u, 1u, gt == GT_SPHERE); i++) {
      let e = op + select(u, -u, i == 1u);
      d[i] = dot(n, e - pp) - g.y; x[i] = e - n * (g.y + 0.5 * d[i]);
    }
    nc = select(2u, 1u, gt == GT_SPHERE);
  } else if (gt == GT_BOX) {
    // The four deepest corners within the margin.
    let cd0 = dot(op - pp, n);
    var worst = 0u;
    let rot = qmat(oq);
    for (var i = 0u; i < 8u; i++) {
      let c = rot * vec3f(select(-g.y, g.y, (i & 1u) != 0u), select(-g.z, g.z, (i & 2u) != 0u), select(-g.w, g.w, (i & 4u) != 0u));
      let cd = cd0 + dot(n, c);
      if (cd > thresh) { continue; }
      let cp = c + op - 0.5 * n * cd;
      if (nc < 4u) {
        d[nc] = cd; x[nc] = cp;
        if (nc == 0u || cd > d[worst]) { worst = nc; }
        nc++;
      } else if (cd < d[worst]) {
        d[worst] = cd; x[worst] = cp;
        worst = 0u;
        for (var k = 1u; k < 4u; k++) { if (d[k] > d[worst]) { worst = k; } }
      }
    }
  } else if (gt == GT_CYL) {
    // Deepest rim point, then three cap points (within 22.5 deg of upright) or the opposite rim
    // and the cap's side point (rolling).
    var ax = qrot(oq, vec3f(0.0, 0.0, 1.0));
    var dna = dot(n, ax);
    if (dna > 0.0) { ax = -ax; dna = -dna; }
    let cap = op + ax * g.z;
    var pa = -n + ax * dna;
    let l2 = dot(pa, pa);
    let has = l2 > 1e-10;
    if (has) { pa = pa * (1.0 / sqrt(l2)); }
    let flat = -dna >= 0.9238795325112867;
    var pf = vec3f(0.0);
    if (flat || !has) {
      var rf = vec3f(1.0, 0.0, 0.0);
      if (abs(dot(ax, rf)) > 0.9) { rf = vec3f(0.0, 1.0, 0.0); }
      pf = normalize(rf - ax * dot(ax, rf));
    }
    let dp = select(pf, pa, has);
    let dpt = cap + dp * g.y;
    d[0] = dot(dpt - pp, n); x[0] = dpt - n * (d[0] * 0.5);
    nc = 1u;
    let mt = 0.01 * max(g.y, g.z);
    var cand: array<vec3f, 3>;
    var ncand = 0u;
    if (flat) {
      let u = pf * g.y; let v = cross(ax, pf) * g.y;
      cand[0] = cap + u; cand[1] = cap - 0.5 * u + 0.8660254 * v; cand[2] = cap - 0.5 * u - 0.8660254 * v;
      ncand = 3u;
    } else {
      let u = dp * g.y; let v = cross(ax, dp) * g.y;
      cand[0] = op - ax * g.z + u;
      let dpv = dot(cap + v - pp, n); let dnv = dot(cap - v - pp, n);
      cand[1] = select(cap - v, cap + v, dpv <= dnv);
      ncand = 2u;
    }
    for (var k = 0u; k < ncand; k++) {
      let dk = dot(cand[k] - pp, n);
      let pk = cand[k] - n * (dk * 0.5);
      if (nc < 4u && dot(pk - x[0], pk - x[0]) > mt * mt) { d[nc] = dk; x[nc] = pk; nc++; }
    }
  }
  for (var i = 0u; i < nc; i++) {
    if (d[i] <= thresh) { emit(sa, sb, x[i], nab, d[i], hash_u32(base ^ (i + 7u))); }
  }
}

// Segment (sphere/capsule core, endpoints e0/e1 in hull frame, radius r) against the faces of hull h.
fn face_query_seg(h: u32, e0: vec3f, e1: vec3f, r: f32, lane: u32) -> FaceQ {
  var best = FaceQ(-1e30, 0u);
  let fo = hfo(h);
  for (var f = lane; f < hnf(h); f += NLANE) {
    let pl = fplane(fo + f);
    let s = min(dot(pl.xyz, e0), dot(pl.xyz, e1)) - pl.w - r;
    if (s > best.sep) { best = FaceQ(s, f); }
  }
  return best;
}

fn seg_hits_hull(h: u32, e0: vec3f, e1: vec3f) -> bool {
  var t0 = 0.0; var t1 = 1.0;
  for (var f = 0u; f < hnf(h); f++) {
    let pl = fplane(hfo(h) + f);
    let d0 = dot(pl.xyz, e0) - pl.w; let d1 = dot(pl.xyz, e1) - pl.w;
    if (d0 > 0.0 && d1 > 0.0) { return false; }
    if (d0 > 0.0) { t0 = max(t0, d0 / (d0 - d1)); } else if (d1 > 0.0) { t1 = min(t1, d0 / (d0 - d1)); }
  }
  return t0 <= t1;
}

// Closest points of a segment (outside hull h) and the hull: endpoints over face interiors, the
// segment against every face edge. kind 0 face interior, 1 edge.
struct SegQ { d2: f32, ps: vec3f, ph: vec3f, face: u32, kind: u32 };
fn seg_hull_query(h: u32, e0: vec3f, e1: vec3f, lane: u32) -> SegQ {
  var best = SegQ(1e30, vec3f(0.0), vec3f(0.0), 0u, 1u);
  let fo = hfo(h);
  for (var f = lane; f < hnf(h); f += NLANE) {
    let pl = fplane(fo + f);
    let sr = fstart(fo + f); let cr = fcount(fo + f);
    var in0 = dot(pl.xyz, e0) > pl.w; var in1 = dot(pl.xyz, e1) > pl.w;
    for (var k = 0u; k < cr; k++) {
      let r0 = hv(h, fvert(sr + k));
      let r1 = hv(h, fvert(sr + (k + 1u) % cr));
      let out = cross(r1 - r0, pl.xyz);
      if (dot(e0 - r0, out) > 0.0) { in0 = false; }
      if (dot(e1 - r0, out) > 0.0) { in1 = false; }
      let c = closest_seg(e0, e1, r0, r1);
      let d2 = dot(c[0] - c[1], c[0] - c[1]);
      if (d2 < best.d2) { best = SegQ(d2, c[0], c[1], f, 1u); }
    }
    // Ties go to the face so a capsule lying on it keeps its two-point manifold.
    if (in0) { let sd = dot(pl.xyz, e0) - pl.w; if (sd * sd <= best.d2 * 1.0001) { best = SegQ(sd * sd, e0, e0 - pl.xyz * sd, f, 0u); } }
    if (in1) { let sd = dot(pl.xyz, e1) - pl.w; if (sd * sd <= best.d2 * 1.0001) { best = SegQ(sd * sd, e1, e1 - pl.xyz * sd, f, 0u); } }
  }
  return best;
}

// Contacts of a segment on the reference face f of hull h; hs/ps are shape ids for the key,
// flip when the hull is shape B (normals are emitted from A to B).
fn seg_on_face(hs: u32, ps: u32, h: u32, f: u32, e0: vec3f, e1: vec3f, r: f32, wp: vec3f, wq: vec4f, thresh: f32, flip: bool) {
  let pl = fplane(hfo(h) + f);
  var t0 = 0.0; var t1 = 1.0;
  let sr = fstart(hfo(h) + f); let cr = fcount(hfo(h) + f);
  for (var k = 0u; k < cr; k++) {
    let r0 = hv(h, fvert(sr + k));
    let r1 = hv(h, fvert(sr + (k + 1u) % cr));
    let out = cross(r1 - r0, pl.xyz);
    let d0 = dot(e0 - r0, out); let d1 = dot(e1 - r0, out);
    if (d0 > 0.0 && d1 > 0.0) { t0 = 2.0; break; }
    if (d0 > 0.0) { t0 = max(t0, d0 / (d0 - d1)); }
    if (d1 > 0.0) { t1 = min(t1, d0 / (d0 - d1)); }
  }
  var ts = array<f32, 2>(t0, t1);
  var n = 2u;
  if (t0 > t1) {
    // Segment misses the face polygon: use its deeper endpoint.
    ts[0] = select(1.0, 0.0, dot(pl.xyz, e0) <= dot(pl.xyz, e1)); n = 1u;
  } else if (t1 - t0 < 1e-4 || length(e1 - e0) < 1e-7) { n = 1u; }
  let nw = qrot(wq, pl.xyz);
  let sa = select(hs, ps, flip); let sb = select(ps, hs, flip);
  let base = hash_u32(sa * 7919u + sb * 104729u);
  for (var i = 0u; i < n; i++) {
    let x = e0 + (e1 - e0) * ts[i];
    let sd = dot(pl.xyz, x) - pl.w;
    let phi = sd - r;
    if (phi > thresh) { continue; }
    let mid = x - pl.xyz * (0.5 * (sd + r));
    emit(sa, sb, wp + qrot(wq, mid), select(nw, -nw, flip), phi, hash_u32(base ^ (f * 131u + i * 7u + 3u)));
  }
}
// Newton's generic convex manifold (geometry/multicontact.py build_manifold) with its support maps.
// Geometry: Newton type and scale; spheres and capsules use Newton's 1e-4 Minkowski core.
const GT_PLANE: u32 = 1u;
const GT_SPHERE: u32 = 3u;
const GT_CAPSULE: u32 = 4u;
const GT_CYL: u32 = 6u;
const GT_BOX: u32 = 7u;
const GT_CONE: u32 = 9u;
const GT_CONVEX: u32 = 10u;
const MEPS: f32 = 1e-5;
const COS_TILT: f32 = 0.9993908270190958;
const SIN_TILT: f32 = 0.03489949670250097;
const COS_DEEP: f32 = 0.9999984769132877;
const WITNESS_TOL: f32 = 1e-3;
const SAT_TIE: f32 = 1e-5;
const PENT = array<vec2f, 5>(vec2f(1.0, 0.0), vec2f(0.30901699437494745, 0.9510565162951535),
  vec2f(-0.8090169943749473, 0.5877852522924732), vec2f(-0.8090169943749476, -0.587785252292473),
  vec2f(0.30901699437494723, -0.9510565162951536));

struct Geo { t: u32, s: vec3f, h: u32 };

// framefields: in a triangle pair (mesh_pairs), the mesh shape's hull is that triangle's.
var<private> tri_shape: u32 = 0xffffffffu;
var<private> tri_hull: u32 = 0u;
fn shape_hull(s: u32) -> u32 { return select(u32(statF[SF_SHAPE + s * 7u].y), tri_hull, s == tri_shape); }

fn geo_type(s: u32) -> u32 { return u32(statF[SF_SHAPE + s * 7u + 6u].x); }
fn geo(s: u32) -> Geo {
  let g = statF[SF_SHAPE + s * 7u + 6u];
  var r = Geo(u32(g.x), g.yzw, shape_hull(s));
  if (r.t == GT_SPHERE || r.t == GT_CAPSULE) { r.s.x = 1e-4; }
  return r;
}

fn gsup(g: Geo, d: vec3f) -> vec3f {
  if (g.t == GT_BOX) {
    let th = 1e-10 * max(abs(d.x), max(abs(d.y), abs(d.z)));
    return vec3f(select(-g.s.x, g.s.x, d.x >= -th), select(-g.s.y, g.s.y, d.y >= -th), select(-g.s.z, g.s.z, d.z >= -th));
  }
  if (g.t == GT_SPHERE || g.t == GT_CAPSULE) {
    let l2 = dot(d, d);
    var p = select(vec3f(1.0, 0.0, 0.0), d * inverseSqrt(l2), l2 > 1e-12) * g.s.x;
    if (g.t == GT_CAPSULE) { p.z += select(-g.s.y, g.s.y, d.z >= 0.0); }
    return p;
  }
  if (g.t == GT_CYL) {
    let xy = vec3f(d.x, d.y, 0.0);
    let l2 = dot(xy, xy);
    var p = select(vec3f(g.s.x, 0.0, 0.0), xy * inverseSqrt(l2) * g.s.x, l2 > 1e-12);
    if (d.z > 0.0) { p.z = g.s.y; } else if (d.z < 0.0) { p.z = -g.s.y; }
    return p;
  }
  var best = -1e10; var bp = vec3f(0.0);
  for (var v = 0u; v < hnv(g.h); v++) { let x = hv(g.h, v); let s = dot(x, d); if (s > best) { best = s; bp = x; } }
  return bp;
}

// Capsule and flat-cylinder sides perpendicular to the normal give a line feature.
fn fsup(g: Geo, d: vec3f, n: vec3f) -> vec3f {
  var p = gsup(g, d);
  if ((g.t == GT_CAPSULE || (g.t == GT_CYL && g.s.z == 0.0)) && abs(n.z) <= 1e-4) {
    let rad = normalize(vec3f(n.x, n.y, 0.0)) * g.s.x;
    p = vec3f(rad.x, rad.y, select(-g.s.y, g.s.y, d.z >= 0.0));
  }
  return p;
}

fn planar_geo(g: Geo) -> bool { return g.t == GT_BOX || g.t == GT_CONVEX; }

struct Trk { r: vec3f, p: vec3f, n: vec3f, a2: f32, np: bool };
fn trk_add(t: Trk, x: vec3f, id: u32, chk: bool) -> Trk {
  var o = t;
  if (id == 0u) { o.r = x; o.a2 = 0.0; o.n = vec3f(0.0); o.np = false; }
  else if (id == 1u) { o.p = x; }
  else {
    if (chk && o.a2 > 0.0) { let off = dot(o.n, x - o.r); if (off * off > MEPS * MEPS * o.a2) { o.np = true; } }
    let c = cross(o.p - o.r, x - o.r);
    let a2 = dot(c, c);
    if (a2 > o.a2) { o.a2 = a2; o.n = c; }
    o.p = x;
  }
  return o;
}
fn trk_anchor(t: Trk, x: vec3f) -> bool {
  let off = dot(t.n, x - t.r);
  return !t.np && off * off <= MEPS * MEPS * t.a2;
}

struct Proj { d: f32, n: vec3f };
fn line_proj_n(dir: vec3f, rn: vec3f) -> vec3f {
  let nn = cross(cross(dir, rn), dir);
  let l = length(nn);
  return select(rn, nn * (1.0 / l), l > 1e-12);
}
fn make_proj(ta: Trk, pa: vec3f, tb: Trk, pb: vec3f, n: vec3f) -> array<Proj, 2> {
  var A = Proj(0.0, vec3f(0.0)); var B = Proj(0.0, vec3f(0.0));
  if (ta.a2 == 0.0 && tb.a2 == 0.0) {
    A.n = line_proj_n(ta.p - ta.r, n); A.d = -dot(0.5 * (ta.r + ta.p), A.n);
    B.n = line_proj_n(tb.p - tb.r, n); B.d = -dot(0.5 * (tb.r + tb.p), B.n);
    return array<Proj, 2>(A, B);
  }
  if (ta.a2 > 0.0) { A.n = ta.n * (1.0 / sqrt(max(1e-12, ta.a2))); A.d = -dot(pa, A.n); }
  if (tb.a2 > 0.0) { B.n = tb.n * (1.0 / sqrt(max(1e-12, tb.a2))); B.d = -dot(pb, B.n); }
  if (ta.a2 == 0.0) { A.n = line_proj_n(ta.p - ta.r, B.n); A.d = -dot(0.5 * (ta.r + ta.p), A.n); }
  if (tb.a2 == 0.0) { B.n = line_proj_n(tb.p - tb.r, A.n); B.d = -dot(0.5 * (tb.r + tb.p), B.n); }
  return array<Proj, 2>(A, B);
}
fn proj_on(pr: Proj, x: vec3f, n: vec3f) -> vec3f {
  let den = dot(n, pr.n);
  if (abs(den) < 1e-12) { return x; }
  return x + n * (-(dot(x, pr.n) + pr.d) / den);
}

fn sarea(a: vec2f, b: vec2f, q: vec2f) -> f32 { return (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x); }

fn add_nodup(arr: ptr<function, array<vec2f, 10>>, cnt: i32, v: vec2f) -> bool {
  if (cnt > 0) { let d = (*arr)[0] - v; if (dot(d, d) < MEPS * MEPS) { return false; } }
  if (cnt > 1) { let d = (*arr)[cnt - 1] - v; if (dot(d, d) < MEPS * MEPS) { return false; } }
  (*arr)[cnt] = v;
  return true;
}

fn trim_in_place(s0: vec2f, s1: vec2f, lp: ptr<function, array<vec2f, 10>>, cnt0: i32) -> i32 {
  var cnt = cnt0;
  if (cnt < 3) { return cnt; }
  var ia = vec2f(0.0); var ca = -1; var ib = vec2f(0.0); var cb = -1; var keep = false;
  var prev_out = sarea(s0, s1, (*lp)[0]) <= 0.0;
  for (var i = 0; i < cnt; i++) {
    let nx = (i + 1) % cnt;
    let out = sarea(s0, s1, (*lp)[nx]) <= 0.0;
    if (out != prev_out) {
      let a = (*lp)[i]; let b = (*lp)[nx];
      let sa = sarea(s0, s1, a); let sb = sarea(s0, s1, b);
      let t = abs(sa) / abs(sa - sb);
      let x = (1.0 - t) * a + t * b;
      if (ca < 0) { ca = i; keep = !prev_out; ia = x; } else { cb = i; ib = x; }
    }
    prev_out = out;
  }
  if (ca >= 0 && cb >= 0) {
    var li = -1; var ncnt = cnt; var i = 0;
    for (var guard = 0; guard < 24 && i < cnt; guard++) {
      if (keep) { li++; (*lp)[li] = (*lp)[i]; }
      if (i == ca || i == cb) {
        let pt = select(ib, ia, i == ca);
        if (li == i && !keep) {
          li++;
          for (var k = min(ncnt, 9); k > li; k--) { (*lp)[k] = (*lp)[k - 1]; }
          (*lp)[li] = pt;
          ncnt++; i++; cb++; cnt++;
        } else { li++; (*lp)[li] = pt; }
        keep = !keep;
      }
      i++;
    }
    return li + 1;
  }
  return select(cnt, 0, prev_out);
}

fn trim_all(tp: ptr<function, array<vec2f, 10>>, tn: i32, lp: ptr<function, array<vec2f, 10>>, ln: i32) -> i32 {
  if (tn <= 1) { return min(1, ln); }
  if (tn == 2 || ln == 2) {
    // Clip the segment itself; two nonparallel segments meet in at most the witness point.
    var st = (*lp)[0]; var en = (*lp)[1];
    if (tn == 2) { st = (*tp)[0]; en = (*tp)[1]; }
    let dir = en - st;
    let l2 = dot(dir, dir);
    if (l2 <= MEPS * MEPS) { return 0; }
    var lo = 0.0; var hi = 1.0;
    if (tn == 2 && ln == 2) {
      let os = (*lp)[0]; let od = (*lp)[1] - os;
      let cr = dir.x * od.y - dir.y * od.x;
      if (abs(cr) > 1e-6 * sqrt(l2 * dot(od, od))) { return 0; }
      let t0 = dot(os - st, dir) / l2; let t1 = dot((*lp)[1] - st, dir) / l2;
      lo = max(lo, min(t0, t1)); hi = min(hi, max(t0, t1));
    } else {
      let useLoop = tn == 2;
      let pc = select(tn, ln, useLoop);
      for (var i = 0; i < pc; i++) {
        let e0 = select((*tp)[i], (*lp)[i], useLoop);
        let e1 = select((*tp)[(i + 1) % pc], (*lp)[(i + 1) % pc], useLoop);
        let a = sarea(e0, e1, st); let b = sarea(e0, e1, en);
        if (a < 0.0 && b < 0.0) { return 0; }
        if (a < 0.0) { lo = max(lo, a / (a - b)); } else if (b < 0.0) { hi = min(hi, a / (a - b)); }
      }
    }
    if (hi <= lo) { return 0; }
    (*lp)[0] = st + lo * dir; (*lp)[1] = st + hi * dir;
    return 2;
  }
  var c = ln;
  let t0 = (*tp)[0];
  for (var i = 0; i < tn; i++) {
    let s1 = select((*tp)[i + 1], t0, i == tn - 1);
    c = trim_in_place((*tp)[i], s1, lp, c);
  }
  return c;
}

fn remove_zero_edges(lp: ptr<function, array<vec2f, 10>>, cnt: i32) -> i32 {
  if (cnt < 2) { return 0; }
  var w = 0;
  for (var r = 1; r < cnt; r++) {
    let d = (*lp)[r] - (*lp)[w];
    if (dot(d, d) > MEPS * MEPS) { w++; (*lp)[w] = (*lp)[r]; }
  }
  var n = w + 1;
  if (w > 0) { let d = (*lp)[w] - (*lp)[0]; if (dot(d, d) < MEPS * MEPS) { n = w; } }
  return select(n, 0, n < 2);
}

fn calipers(h: ptr<function, array<vec2f, 10>>, n: i32) -> vec4i {
  var p1 = 0; var p3 = 1;
  var d0 = (*h)[0] - (*h)[1];
  var md = dot(d0, d0);
  let te = 1e-3;
  var j = 1;
  for (var i = 0; i < n; i++) {
    let hi = (*h)[i]; let hi1 = (*h)[(i + 1) % n];
    for (var g = 0; g < 16; g++) {
      if (sarea(hi, hi1, (*h)[(j + 1) % n]) > sarea(hi, hi1, (*h)[j])) { j = (j + 1) % n; } else { break; }
    }
    let hj = (*h)[j];
    let a = hi - hj;
    if (dot(a, a) > md * (1.0 + te)) { md = dot(a, a); p1 = i; p3 = j; }
    let b = hi1 - hj;
    if (dot(b, b) > md * (1.0 + te)) { md = dot(b, b); p1 = (i + 1) % n; p3 = j; }
  }
  var p2 = 0; var p4 = 0; var m1 = 0.0; var m2 = 0.0;
  let q1 = (*h)[p1]; let q3 = (*h)[p3];
  for (var i = 0; i < n; i++) {
    let ar = sarea(q1, q3, (*h)[i]);
    if (ar > m1 * (1.0 + te)) { m1 = ar; p2 = i; } else if (-ar > m2 * (1.0 + te)) { m2 = -ar; p4 = i; }
  }
  return vec4i(p1, p2, p3, p4);
}

fn onb(n: vec3f) -> array<vec3f, 2> {
  if (n.z < 0.0) {
    let a = 1.0 / (1.0 - n.z); let b = n.x * n.y * a;
    return array<vec3f, 2>(vec3f(1.0 - n.x * n.x * a, -b, n.x), vec3f(b, n.y * n.y * a - 1.0, -n.y));
  }
  let a = 1.0 / (1.0 + n.z); let b = -n.x * n.y * a;
  return array<vec3f, 2>(vec3f(1.0 - n.x * n.x * a, b, -n.x), vec3f(b, 1.0 - n.y * n.y * a, -n.y));
}

fn plane_supporting(g: Geo, dir: vec3f, d: f32) -> bool {
  let off = dot(dir, gsup(g, dir)) + d;
  return off * off <= MEPS * MEPS * dot(dir, dir);
}

// Manifold of A (frame of the computation) and B (pose rq, rt in A's frame) from the witnesses
// wa, wb and normal n (A to B). Up to four polygon points, then the deepest witness contact.
struct Man { p: array<vec3f, 5>, d: array<f32, 5>, n: u32 };
fn build_manifold(ga: Geo, gb: Geo, rq: vec4f, rt: vec3f, wa: vec3f, wb: vec3f, n: vec3f) -> Man {
  var out: Man;
  out.n = 0u;
  var fna = n;
  if (ga.t == GT_CYL && gb.t == GT_CYL && ga.s.z == 0.0 && gb.s.z == 0.0) {
    let axb = qrot(rq, vec3f(0.0, 0.0, 1.0));
    let ro = vec3f(rt.x, rt.y, 0.0);
    if (axb.x * axb.x + axb.y * axb.y <= 1e-12 && abs(rt.z) < ga.s.y + gb.s.y && dot(ro, ro) > 1e-20) {
      let rn = normalize(ro);
      if (dot(n, rn) >= COS_TILT) { fna = rn; }
    }
  }
  let tb = onb(n);
  let pa = planar_geo(ga); let pb = planar_geo(gb);
  let center = 0.5 * (wa + wb);
  var A: array<vec2f, 10>; var B: array<vec2f, 10>;
  var ac = 0; var bc = 0;
  var ta = Trk(vec3f(0.0), vec3f(0.0), vec3f(0.0), 0.0, false); var tbk = ta;
  let lnb = qinvrot(rq, -n); let lfb = qinvrot(rq, -fna);
  let lta = qinvrot(rq, -tb[0]); let ltb = qinvrot(rq, -tb[1]);
  for (var e = 0u; e < 5u; e++) {
    let cs = PENT[e] * SIN_TILT;
    let x = fsup(ga, n * COS_TILT + cs.x * tb[0] + cs.y * tb[1], fna);
    let xa = x - center;
    if (add_nodup(&A, ac, vec2f(dot(tb[0], xa), dot(tb[1], xa)))) { ac++; ta = trk_add(ta, x, u32(ac - 1), pa); }
    let y = qrot(rq, fsup(gb, lnb * COS_TILT + cs.x * lta + cs.y * ltb, lfb)) + rt;
    let yb = y - center;
    if (add_nodup(&B, bc, vec2f(dot(tb[0], yb), dot(tb[1], yb)))) { bc++; tbk = trk_add(tbk, y, u32(bc - 1), pb); }
  }
  var cnt = 0u; var ndot = 0.0;
  if (ac >= 2 && bc >= 2 && !(pa && !trk_anchor(ta, wa)) && !(pb && !trk_anchor(tbk, wb))) {
    let pr = make_proj(ta, wa, tbk, wb, n);
    var ok = abs(dot(n, pr[0].n)) >= COS_TILT && abs(dot(n, pr[1].n)) >= COS_TILT;
    if (ok && pa && (ta.a2 == 0.0 || dot(cross(n, pr[0].n), cross(n, pr[0].n)) > 0.0)) {
      let flip = dot(pr[0].n, n) < 0.0;
      ok = plane_supporting(ga, select(pr[0].n, -pr[0].n, flip), select(pr[0].d, -pr[0].d, flip));
    }
    if (ok && pb && (tbk.a2 == 0.0 || dot(cross(n, pr[1].n), cross(n, pr[1].n)) > 0.0)) {
      let flip = dot(pr[1].n, n) > 0.0;
      let db = select(pr[1].n, -pr[1].n, flip); let dd = select(pr[1].d, -pr[1].d, flip);
      ok = plane_supporting(gb, qinvrot(rq, db), dd + dot(db, rt));
    }
    if (ok) {
      ndot = abs(dot(pr[0].n, pr[1].n));
      var lc = remove_zero_edges(&B, trim_all(&A, ac, &B, bc));
      if (lc > 1) {
        var idx = vec4i(0, 1, 2, 3);
        if (lc > 4) { idx = calipers(&B, lc); lc = 4; }
        for (var i = 0; i < lc; i++) {
          let q = B[idx[i]];
          let pl = q.x * tb[0] + q.y * tb[1] + center;
          let a = proj_on(pr[0], pl, n); let b = proj_on(pr[1], pl, n);
          out.p[cnt] = 0.5 * (a + b); out.d[cnt] = dot(b - a, n); cnt++;
        }
      } else { ndot = 0.0; }
    }
  }
  if (ndot < COS_DEEP || cnt == 0u) {
    out.p[cnt] = 0.5 * (wa + wb); out.d[cnt] = dot(wb - wa, n); cnt++;
  }
  out.n = cnt;
  return out;
}

fn is_discrete(t: u32) -> bool { return t == GT_BOX || t == GT_CONVEX || t == GT_PLANE; }

// The collision paths only queue the manifold; main builds it once, so the compiler keeps one copy.
struct GenJob { on: bool, sa: u32, sb: u32, ga: Geo, gb: Geo, pa: vec3f, qa: vec4f, rq: vec4f, rt: vec3f, wa: vec3f, wb: vec3f, n: vec3f, thresh: f32 };
var<private> job: GenJob;
fn gen_emit(sa: u32, sb: u32, ga: Geo, gb: Geo, pa: vec3f, qa: vec4f, rq: vec4f, rt: vec3f,
            wa: vec3f, wb: vec3f, n: vec3f, thresh: f32) {
  job = GenJob(true, sa, sb, ga, gb, pa, qa, rq, rt, wa, wb, n, thresh);
}
// Build, post-process (Minkowski radius, axial rolling) and emit the generic manifold of shapes
// sa (A, pose pa/qa of the computation frame) and sb (pose rq/rt in that frame).
fn gen_run(sa: u32, sb: u32, ga: Geo, gb: Geo, pa: vec3f, qa: vec4f, rq: vec4f, rt: vec3f,
           wa: vec3f, wb: vec3f, n: vec3f, thresh: f32) {
  let m = build_manifold(ga, gb, rq, rt, wa, wb, n);
  let nw = qrot(qa, n);
  let ra = select(0.0, statF[SF_SHAPE + sa * 7u + 6u].y, ga.t == GT_SPHERE || ga.t == GT_CAPSULE);
  let rb = select(0.0, statF[SF_SHAPE + sb * 7u + 6u].y, gb.t == GT_SPHERE || gb.t == GT_CAPSULE);
  let axA = ga.t == GT_CYL || ga.t == GT_CONE; let axB = gb.t == GT_CYL || gb.t == GT_CONE;
  var roll = false; var rpos = vec3f(0.0); var rn = vec3f(0.0);
  if ((is_discrete(ga.t) && axB) || (is_discrete(gb.t) && axA)) {
    let onB = is_discrete(ga.t) && axB;
    let ax = select(qrot(qa, vec3f(0.0, 0.0, 1.0)), qrot(qmul(qa, rq), vec3f(0.0, 0.0, 1.0)), onB);
    let an = select(-nw, nw, onB);
    // Cones are not ported; cylinders roll when the axis is within 2 degrees of the tangent plane.
    if (abs(dot(ax, an)) <= SIN_TILT) {
      roll = true;
      rpos = select(pa, pa + qrot(qa, rt), onB);
      rn = normalize(cross(ax, an));
    }
  }
  let base = hash_u32(sa * 7919u + sb * 104729u);
  for (var i = 0u; i < m.n; i++) {
    var p = pa + qrot(qa, m.p[i]) + nw * (0.5 * ra) - nw * (0.5 * rb);
    let d = m.d[i] - ra - rb;
    if (roll) { p = p - rn * dot(p - rpos, rn); }
    if (d > thresh) { continue; }
    emit(sa, sb, p, nw, d, hash_u32(base ^ (i * 0x9e3779b1u + 0x51u)));
  }
}

// Witnesses on the supporting planes along n, inside both hulls as MPR's are: B's support point when
// it lies over A (preferred when A holds the reference face), else A's. A tie-broken support corner
// of the larger shape can sit outside the overlap.
fn hull_out(h: u32, x: vec3f) -> f32 {
  var m = -1e30;
  for (var f = 0u; f < hnf(h); f++) { let pl = fplane(hfo(h) + f); m = max(m, dot(pl.xyz, x) - pl.w); }
  return m;
}
// Point where o + t n meets the face of hull h most aligned with n (hull frame), or the plane through
// support point s normal to n when that tilted face would misstate the depth (deep overlap).
fn ray_face(h: u32, o: vec3f, n: vec3f, s: vec3f) -> vec3f {
  var best = -2.0; var pl = vec4f(0.0);
  for (var f = 0u; f < hnf(h); f++) { let q = fplane(hfo(h) + f); if (dot(q.xyz, n) > best) { best = dot(q.xyz, n); pl = q; } }
  let x = o + n * ((pl.w - dot(pl.xyz, o)) / dot(pl.xyz, n));
  if (abs(dot(x - s, n)) > WITNESS_TOL) { return o + n * dot(s - o, n); }
  return x;
}
fn sup_witness(ga: Geo, gb: Geo, rq: vec4f, rt: vec3f, n: vec3f, refA: bool) -> array<vec3f, 2> {
  let sA = gsup(ga, n);
  let lb = gsup(gb, qinvrot(rq, -n));
  let sB = qrot(rq, lb) + rt;
  let wb = array<vec3f, 2>(ray_face(ga.h, sB, n, sA), sB);
  let wa = array<vec3f, 2>(sA, qrot(rq, ray_face(gb.h, qinvrot(rq, sA - rt), qinvrot(rq, -n), lb)) + rt);
  let ob = max(hull_out(ga.h, wb[0]), hull_out(gb.h, qinvrot(rq, wb[1] - rt)));
  let oa = max(hull_out(ga.h, wa[0]), hull_out(gb.h, qinvrot(rq, wa[1] - rt)));
  if ((refA && !(oa < ob - 1e-6)) || (!refA && ob < oa - 1e-6)) { return wb; }
  return wa;
}

// Hull pair from SAT: edge axis or reference face, then Newton's manifold.
fn sat_generic(sa: u32, sb: u32, ha: u32, hb: u32, pa: vec3f, qa: vec4f, rBA: vec4f, tBA: vec3f,
               thresh: f32, fa: FaceQ, fb: FaceQ, eq: EdgeQ) {
  let ga = geo(sa); let gb = geo(sb);
  // Least-penetrating axis wins, as in Newton's MPR; the tolerance only breaks ties toward faces.
  if (eq.sep > max(fa.sep, fb.sep) + SAT_TIE) {
    let c = closest_seg(eq.a0, eq.a1, eq.b0, eq.b1);
    gen_emit(sa, sb, ga, gb, pa, qa, rBA, tBA, c[0], c[1], eq.axis, thresh);
    return;
  }
  let refA = !(fb.sep > fa.sep + SAT_TIE);
  let n = select(-qrot(rBA, fplane(hfo(hb) + fb.face).xyz), fplane(hfo(ha) + fa.face).xyz, refA);
  let w = sup_witness(ga, gb, rBA, tBA, n, refA);
  gen_emit(sa, sb, ga, gb, pa, qa, rBA, tBA, w[0], w[1], n, thresh);
}

// Plane against a convex hull: Newton turns the plane into a large box whose top face is the
// plane, centered under the hull.
fn plane_convex(sa: u32, sb: u32, pa: vec3f, qa: vec4f, pb: vec3f, qb: vec4f, thresh: f32) {
  let gb = geo(sb);
  let nw = qrot(qa, vec3f(0.0, 0.0, 1.0));
  let L = 10.0 * (length(statF[SF_HAABB + gb.h * 2u].xyz) + length(statF[SF_HAABB + gb.h * 2u + 1u].xyz));
  let c = pb - nw * (dot(pb - pa, nw) + L);
  let rq = qmul(qconj(qa), qb); let rt = qinvrot(qa, pb - c);
  let n = vec3f(0.0, 0.0, 1.0);
  let wb = qrot(rq, gsup(gb, qinvrot(rq, -n))) + rt;
  let sep = wb.z - L;
  if (sep > thresh) { return; }
  gen_emit(sa, sb, Geo(GT_BOX, vec3f(L, L, L), 0u), gb, c, qa, rq, rt, wb - n * sep, wb, n, thresh);
}
var<workgroup> rsep: array<f32, NLANE>;
var<workgroup> rface: array<u32, NLANE>;
var<workgroup> wbest: vec2f;
var<workgroup> wedge: EdgeQ;
var<workgroup> wflag: u32;
var<workgroup> wseg: SegQ;

// Make a value every lane computes identically provably uniform for barriers.
fn uniform_bool(lane: u32, b: bool) -> bool {
  if (lane == 0u) { wflag = select(0u, 1u, b); }
  return workgroupUniformLoad(&wflag) != 0u;
}

fn reduce_face(lane: u32, q: FaceQ) -> FaceQ {
  rsep[lane] = q.sep; rface[lane] = q.face;
  workgroupBarrier();
  if (lane == 0u) {
    var b = 0u;
    for (var k = 1u; k < NLANE; k++) { if (rsep[k] > rsep[b]) { b = k; } }
    wbest = vec2f(rsep[b], f32(rface[b]));
  }
  let r = workgroupUniformLoad(&wbest);
  return FaceQ(r.x, u32(r.y));
}

var<workgroup> wnpairs: u32;

@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lane: u32) {
  if (lane == 0u) { wnpairs = min(atomicLoad(&counters[0]), MAXP); }
  let np = workgroupUniformLoad(&wnpairs);
  if (wid.x >= np) {
    if (lane == 0u) { line_row(wid.x - np); }
    return;
  }
  narrow_pair(wid.x, lane);
  if (job.on) {
    let j = job;
    gen_run(j.sa, j.sb, j.ga, j.gb, j.pa, j.qa, j.rq, j.rt, j.wa, j.wb, j.n, j.thresh);
  }
}

// framefields: ropes and springs as frictionless contact rows on their line. Both anchors lie on it, so
// one point there (the midpoint) gives each body its anchor's lever arm about the normal. Row i < NROPE
// is rope i: the normal runs from B's anchor to A's and the gap is the slack, so it only ever pulls.
// Then two soft rows per spring (stiffness and damping as the row's compliance, implicit): one pulls
// past its rest length, the other pushes short of it.
fn line_anchor(b: i32, arm: vec3f) -> vec3f {
  if (b < 0) { return arm; }
  return poses[P_BODY + u32(b) * 2u].xyz + qrot(poses[P_BODY + u32(b) * 2u + 1u], arm);
}
fn line_row(i: u32) {
  let rope = i < NROPE;
  let s = (i - NROPE) / 2u;
  let push = !rope && ((i - NROPE) & 1u) == 1u;
  let o = select(SF_SPRING + s * 4u, SF_ROPE + i * 3u, rope);
  let r0 = statF[o];
  let ba = i32(r0.x); let bb = i32(r0.y);
  let fa = ba < 0 || body_kind(ba) == 3u || (body_flags(ba) & 1u) != 0u;
  let fb = bb < 0 || body_kind(bb) == 3u || (body_flags(bb) & 1u) != 0u;
  if (fa && fb) { return; }
  let pa = line_anchor(ba, statF[o + 1u].xyz);
  let pb = line_anchor(bb, statF[o + 2u].xyz);
  let len = length(pa - pb);
  if (len < 1e-9) { return; }
  var a = ba; var b = bb;
  var n = select(pa - pb, pb - pa, push) / len;
  let phi = select(r0.z - len, len - r0.z, push);
  if (a > b) { a = bb; b = ba; n = -n; }
  let k = atomicAdd(&counters[1], 1u);
  if (k >= MAXC) { return; }
  let key = hash_u32(0x726f7065u ^ (i * 0x9e3779b1u));
  let g = f32(ROPE_G0 + i);
  var soft = vec2f(0.0);
  if (!rope) { soft = statF[o + 3u].xy; }
  contacts[MAXC * 5u + k] = vec4f(0.0);
  contacts[k * 5u] = vec4f(0.5 * (pa + pb), phi);
  contacts[k * 5u + 1u] = vec4f(n, 0.0);
  contacts[k * 5u + 2u] = vec4f(f32(a), f32(b), f32(key & 0xffffu), f32(key >> 16u));
  // No restitution or angular friction; a negative torsion radius marks a rope (-1) or spring (-2).
  contacts[k * 5u + 3u] = vec4f(0.0, 0.0, 0.0, select(-2.0, -1.0, rope));
  contacts[k * 5u + 4u] = vec4f(soft, g, g);  // compliance, and a reduction group of its own
}

fn narrow_pair(pi: u32, lane: u32) {
  let raw = pairs[pi];
  var pr0 = raw;
  if ((raw.y & 0x80000000u) != 0u) {
    tri_shape = raw.x >> 16u; tri_hull = raw.y & 0x7fffffffu;
    pr0 = vec2u(raw.x & 0xffffu, tri_shape);
  }
  // Newton's pair order: shape A has the lower geometry type.
  let swp = geo_type(pr0.x) > geo_type(pr0.y);
  let sa = select(pr0.x, pr0.y, swp); let sb = select(pr0.y, pr0.x, swp);
  let ha = shape_hull(sa);
  let hb = shape_hull(sb);
  let pa = poses[P_SHAPE + sa * 2u].xyz; let qa = poses[P_SHAPE + sa * 2u + 1u];
  let pb = poses[P_SHAPE + sb * 2u].xyz; let qb = poses[P_SHAPE + sb * 2u + 1u];
  // Newton's detection margin: the shapes' gaps.
  let thresh_gap = min(statF[SF_SHAPE + sa * 7u].w + statF[SF_SHAPE + sb * 7u].w, F_GAP_GATE);
  // framefields: cores are tested against the gap plus the border radii (emit takes them off).
  let thresh = thresh_gap + shape_round(sa) + shape_round(sb);
  let rBA = qmul(qconj(qa), qb); let tBA = qinvrot(qa, pb - pa);
  let rAB = qconj(rBA); let tAB = qinvrot(qb, pa - pb);
  let ka = shape_prim(sa); let kb = shape_prim(sb);
  if (uniform_bool(lane, ka.x == 4.0 || kb.x == 4.0)) {
    if (lane == 0u) {
      if (geo_type(sb) == GT_CONVEX) { plane_convex(sa, sb, pa, qa, pb, qb, thresh); }
      else { plane_contacts(sa, sb, pa, qa, pb, qb, thresh, false); }
    }
    return;
  }
  if (uniform_bool(lane, ka.x != 0.0 && kb.x != 0.0)) {
    if (lane == 0u) { prim_prim(sa, sb, pa, qa, pb, qb, thresh); }
    return;
  }
  if (uniform_bool(lane, ka.x != 0.0 || kb.x != 0.0)) {
    // One primitive against a hull: work in the hull's frame.
    let flip = ka.x != 0.0;
    let hs = select(sa, sb, flip); let ps = select(sb, sa, flip);
    let h = select(ha, hb, flip);
    let pr = select(kb, ka, flip);
    let rq = select(rBA, rAB, flip); let rt = select(tBA, tAB, flip);
    let u = qrot(rq, vec3f(0.0, 0.0, pr.z));
    let e0 = rt - u; let e1 = rt + u;
    let fq = reduce_face(lane, face_query_seg(h, e0, e1, pr.y, lane));
    if (uniform_bool(lane, fq.sep > thresh)) { return; }
    let wp = select(pa, pb, flip); let wq = select(qa, qb, flip);
    // A capsule core crossing a face plane can still miss the hull past an edge.
    if (uniform_bool(lane, fq.sep + pr.y > 1e-6 || (pr.x == 2.0 && !seg_hits_hull(h, e0, e1)))) {
      // Core outside the hull: face planes alone overstate overlap beside edges, so use the
      // exact closest features.
      let mine = seg_hull_query(h, e0, e1, lane);
      rsep[lane] = mine.d2;
      workgroupBarrier();
      if (lane == 0u) {
        var b = 0u;
        for (var k = 1u; k < NLANE; k++) { if (rsep[k] < rsep[b]) { b = k; } }
        rface[0] = b;
      }
      workgroupBarrier();
      if (lane == rface[0]) { wseg = mine; }
      workgroupBarrier();
      if (lane == 0u && pr.x == 2.0) {
        let q = wseg;
        let d = sqrt(q.d2);
        if (d >= 1e-9) {
          let nh = (q.ph - q.ps) / d;
          capsule_generic(ps, hs, select(pb, pa, flip), select(qb, qa, flip), wp, wq, q.ps + nh * 1e-4, q.ph, nh, thresh);
        }
      } else if (lane == 0u) {
        let q = wseg;
        let d = sqrt(q.d2);
        let phi = d - pr.y;
        let n = (q.ps - q.ph) / max(d, 1e-9);
        if (phi > thresh || d < 1e-9) {
        } else if (dot(n, fplane(hfo(h) + fq.face).xyz) > 0.999) {
          seg_on_face(hs, ps, h, fq.face, e0, e1, pr.y, wp, wq, thresh, flip);
        } else {
          let sa2 = select(hs, ps, flip); let sb2 = select(ps, hs, flip);
          let nw = qrot(wq, n);
          let key = hash_u32(hash_u32(sa2 * 7919u + sb2 * 104729u) ^ (q.face * 131u + q.kind * 17u + 0x9e37u));
          emit(sa2, sb2, wp + qrot(wq, q.ph + n * (0.5 * phi)), select(nw, -nw, flip), phi, key);
        }
      }
      return;
    }
    if (lane == 0u && pr.x == 2.0) {
      // Core inside the hull: deeper endpoint against the least-penetrated face.
      let pl = fplane(hfo(h) + fq.face);
      let x = select(e1, e0, dot(pl.xyz, e0) <= dot(pl.xyz, e1));
      capsule_generic(ps, hs, select(pb, pa, flip), select(qb, qa, flip), wp, wq, x - pl.xyz * 1e-4,
                      x - pl.xyz * (dot(pl.xyz, x) - pl.w), -pl.xyz, thresh);
    } else if (lane == 0u) {
      seg_on_face(hs, ps, h, fq.face, e0, e1, pr.y, wp, wq, thresh, flip);
    }
    return;
  }
  let fa = reduce_face(lane, face_query(ha, hb, rBA, tBA, lane));
  if (uniform_bool(lane, fa.sep > thresh)) { return; }
  let fb = reduce_face(lane, face_query(hb, ha, rAB, tAB, lane));
  if (uniform_bool(lane, fb.sep > thresh)) { return; }
  var eq = EdgeQ(-1e30, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
  let small = uniform_bool(lane, hnv(ha) <= 16u && hnv(hb) <= 16u);
  if (!small) {
    // Face-only SAT misjudges edge contacts on large hulls; use MPR's normal instead, unless a face
    // axis separates the hulls better (MPR can take the far side of a thin wall in deep overlap).
    let m = mpr(ha, hb, rBA, tBA, 0.5 * thresh, lane);
    if (lane == 0u && m.w >= 0.0) {
      let n = -m.xyz;
      let sep = dot(n, tBA) + support_min(hb, qinvrot(rBA, n)) - support_max(ha, n);
      if (max(fa.sep, fb.sep) > sep + 1e-4) {
        sat_generic(sa, sb, ha, hb, pa, qa, rBA, tBA, thresh, fa, fb, EdgeQ(-1e30, vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u));
      } else {
        mpr_generic(sa, sb, ha, hb, pa, qa, rBA, tBA, thresh, n);
      }
    }
    return;
  }
  if (small) {
    let mine = edge_query(ha, hb, rBA, tBA, lane);
    rsep[lane] = mine.sep;
    workgroupBarrier();
    if (lane == 0u) {
      var b = 0u;
      for (var k = 1u; k < NLANE; k++) { if (rsep[k] > rsep[b]) { b = k; } }
      rface[0] = b;
    }
    workgroupBarrier();
    if (lane == rface[0]) { wedge = mine; }
    eq = workgroupUniformLoad(&wedge);
    if (uniform_bool(lane, eq.sep > thresh)) { return; }
  }
  if (lane == 0u) { sat_generic(sa, sb, ha, hb, pa, qa, rBA, tBA, thresh, fa, fb, eq); }
}

// Capsule (shape c, world pose pc/qc) against hull shape h (pose wp/wq): witnesses and normal in the
// hull frame, the manifold in the capsule's frame.
fn capsule_generic(c: u32, h: u32, pc: vec3f, qc: vec4f, wp: vec3f, wq: vec4f, wc: vec3f, wh: vec3f, nh: vec3f, thresh: f32) {
  if (dot(wh - wc, nh) - statF[SF_SHAPE + c * 7u + 6u].y > thresh) { return; }
  let rq = qmul(qconj(qc), wq); let rt = qinvrot(qc, wp - pc);
  gen_emit(c, h, geo(c), geo(h), pc, qc, rq, rt, qrot(rq, wc) + rt, qrot(rq, wh) + rt, qrot(rq, nh), thresh);
}

// Large hulls: MPR's normal, reference side from face alignment.
fn mpr_generic(sa: u32, sb: u32, ha: u32, hb: u32, pa: vec3f, qa: vec4f, rBA: vec4f, tBA: vec3f, thresh: f32, n: vec3f) {
  var alA = -2.0;
  for (var f = 0u; f < hnf(ha); f++) { alA = max(alA, dot(fplane(hfo(ha) + f).xyz, n)); }
  var alB = -2.0;
  for (var f = 0u; f < hnf(hb); f++) { alB = max(alB, -dot(qrot(rBA, fplane(hfo(hb) + f).xyz), n)); }
  let ga = geo(sa); let gb = geo(sb);
  let w = sup_witness(ga, gb, rBA, tBA, n, alA >= alB);
  gen_emit(sa, sb, ga, gb, pa, qa, rBA, tBA, w[0], w[1], n, thresh);
}

`;
}

// ---------------------------------------------------------------------------
// Prepare: articulation dynamics, contact grouping into body-pair units,
// greedy body-level coloring, row build with warm start.
export function prepareWGSL(C) {
  return (C.SG ? 'enable subgroups;\ndiagnostic(off, subgroup_uniformity);\n' : '') + HEADER(C, ['statF', 'statU', 'poses', 'vel', 'counters', 'contacts', 'sched', 'rows', 'warm', 'art']) + BODY + ART + /* wgsl */ `
const WG: u32 = PWG;
var<workgroup> wkey: array<u32, MAXU>;
var<workgroup> wcol: array<u32, MAXU>;
var<workgroup> wmask: array<u32, NBP * NCOLW>;  // per-body used colors, NCOLW words
var<workgroup> wscan: array<u32, WG>;
var<workgroup> wcount: array<atomic<u32>, NCOL + 2u>;

// Greedy first-fit edge coloring: the lowest color neither body uses, marked used; NCOL is
// the serial tail (Steel's PROPAGATION_COLOR_TAIL). A world body (< 0) never conflicts.
fn first_free_color(a: i32, b: i32) -> u32 {
  for (var w = 0u; w < NCOLW; w++) {
    var used = 0u;
    if (a >= 0) { used |= wmask[u32(a) * NCOLW + w]; }
    if (b >= 0) { used |= wmask[u32(b) * NCOLW + w]; }
    if (used != 0xffffffffu) {
      let k = countTrailingZeros(~used);
      if (a >= 0) { wmask[u32(a) * NCOLW + w] |= 1u << k; }
      if (b >= 0) { wmask[u32(b) * NCOLW + w] |= 1u << k; }
      return w * 32u + k;
    }
  }
  return NCOL;
}
var<workgroup> watomic_copy: u32;
// workgroupUniformLoad of an atomic, routed through a plain u32 since WebKit rejects the atomic form.
fn uniform_atomic_load(tid: u32, p: ptr<workgroup, atomic<u32>>) -> u32 {
  workgroupBarrier();
  if (tid == 0u) { watomic_copy = atomicLoad(p); }
  return workgroupUniformLoad(&watomic_copy);
}

// First-fit coloring of wkey[0..n) in order (0xffffffff: skip), on thread 0: the walk keeps a unit's
// points and a body's units together, so its dependency chains are long and parallel rounds cost more
// barriers than they save.
fn color_in_order(tid: u32, n: u32) {
  workgroupBarrier();
  if (tid == 0u) {
    for (var i = 0u; i < n; i++) {
      let key = wkey[i];
      if (key != 0xffffffffu) { wcol[i] = first_free_color(i32(key & 0xffffu) - 1, i32(key >> 16u) - 1); }
    }
  }
  workgroupBarrier();
}

var<workgroup> wlinkhit: array<atomic<u32>, NBP>;
var<workgroup> wnu: u32;
var<workgroup> wnwalk: u32;
var<workgroup> wnc: u32;
var<workgroup> wjsplit: array<atomic<u32>, NLP>;

// Inclusive scan of wscan over WG threads: per-subgroup adds, then one pass over the subgroup totals,
// on devices whose subgroups are always 32 lanes (SG32); else Hillis-Steele.
var<workgroup> wsgsum: array<u32, 32>;
${C.SG32 ? `fn scan_sg(tid: u32) {
  let incl = subgroupInclusiveAdd(wscan[tid]);
  if (tid % 32u == 31u) { wsgsum[tid / 32u] = incl; }
  workgroupBarrier();
  if (tid < 32u) { let t = select(0u, wsgsum[tid], tid < WG / 32u); wsgsum[tid] = subgroupExclusiveAdd(t); }
  workgroupBarrier();
  wscan[tid] = incl + wsgsum[tid / 32u];
  workgroupBarrier();
}` : ''}
fn scan(tid: u32) {
${C.SG32 ? '  scan_sg(tid);\n}\n' : `  for (var off = 1u; off < WG; off <<= 1u) {
    var v = 0u;
    if (tid >= off) { v = wscan[tid - off]; }
    workgroupBarrier();
    wscan[tid] += v;
    workgroupBarrier();
  }
}
`}
// Body response: twist change for a unit (force, torque) impulse.
// As body_response, with a link's unsplit (exact tree) response.
fn body_response_unsplit(b: i32, f: vec3f, t: vec3f) -> array<vec3f, 2> {
  if (b < 0 || body_kind(b) != 2u) { return body_response(b, f, t); }
  let wo = lo(u32(body_link(b))) + L_W2;
  let x = array<f32, 6>(f.x, f.y, f.z, t.x, t.y, t.z);
  var o: array<f32, 6>;
  for (var r = 0u; r < 6u; r++) {
    var s = 0.0;
    for (var c = 0u; c < 6u; c++) { s += art[wo + r * 6u + c] * x[c]; }
    o[r] = s;
  }
  return array<vec3f, 2>(vec3f(o[0], o[1], o[2]), vec3f(o[3], o[4], o[5]));
}

fn body_response(b: i32, f: vec3f, t: vec3f) -> array<vec3f, 2> {
  if (b < 0) { return array<vec3f, 2>(vec3f(0.0), vec3f(0.0)); }
  if (body_kind(b) == 1u) {
    let q = poses[P_BODY + u32(b) * 2u + 1u];
    let R = qmat(q);
    return array<vec3f, 2>(f * body_inv_mass(b), R * (body_inv_inertia(b) * (transpose(R) * t)));
  }
  let wo = lo(u32(body_link(b))) + L_W;
  var o: array<f32, 6>;
  let x = array<f32, 6>(f.x, f.y, f.z, t.x, t.y, t.z);
  for (var r = 0u; r < 6u; r++) {
    var s = 0.0;
    for (var c = 0u; c < 6u; c++) { s += art[wo + r * 6u + c] * x[c]; }
    o[r] = s;
  }
  return array<vec3f, 2>(vec3f(o[0], o[1], o[2]), vec3f(o[3], o[4], o[5]));
}

fn contact_key(c: u32) -> u32 { let m = contacts[c * 5u + 2u]; return u32(m.z) | (u32(m.w) << 16u); }

// Steel's contact regularization weight: loaded rows (phi <= 0) get w = 1/(1+g); speculative rows stay rigid.
// Steel's rule: closing faster than restitution_velocity_threshold and at (or reaching) the surface this step.
fn restitution_fires(e: f32, phi: f32, vn: f32) -> bool {
  if (REST == 0u || e <= 0.0 || vn >= -F_REST_SPEED) { return false; }
  return phi <= 1e-6 || phi + P.dt * vn <= 1e-6;
}

// Body COM twist (v, w) at the start of the step.
fn pre_twist(b: i32) -> array<vec3f, 2> {
  if (b < 0) { return array<vec3f, 2>(vec3f(0.0), vec3f(0.0)); }
  if (body_kind(b) == 1u) { return array<vec3f, 2>(vel[u32(b) * 2u].xyz, vel[u32(b) * 2u + 1u].xyz); }
  if (body_kind(b) == 2u) {
    let o = lo(u32(body_link(b))) + L_V;
    return array<vec3f, 2>(ld3(o + 3u), ld3(o));
  }
  return array<vec3f, 2>(vec3f(0.0), vec3f(0.0));
}

// Bilateral dense block: nb unclamped rows of J (rows 0..nb-1), their Y = H^-1 J^T and rhs.
fn put_bilateral(o: u32, art_id: u32, J: ptr<function, array<f32, JDIM>>, nb: u32, rhs: vec3f) {
  let ai = art_info(art_id);
  for (var r = 0u; r < nb; r++) {
    var tau: array<f32, NDA>; var y: array<f32, NDA>;
    for (var k = 0u; k < NDA; k++) { tau[k] = select(0.0, (*J)[r * NDA + k], k < ai.w); y[k] = 0.0; }
    art_solve_gen(art_id, &tau, &y);
    var kk = 0.0;
    for (var k = 0u; k < ai.w; k++) {
      art[o + DHDR + r * NDA + k] = (*J)[r * NDA + k];
      art[o + DHDR + 3u * NDA + r * NDA + k] = y[k];
      kk += (*J)[r * NDA + k] * y[k];
    }
    art[o + 5u + r] = select(0.0, 1.0 / kk, kk > 1e-12);
  }
  art[o] = f32(art_id); art[o + 1u] = 0.0; art[o + 2u] = 0.0;
  art[o + 4u] = rhs.x; art[o + 22u] = rhs.y; art[o + 23u] = rhs.z;
  art[o + 9u] = 0.0; art[o + 10u] = 0.0; art[o + 11u] = 0.0;
  art[o + 21u] = f32(nb);
}

// Steel's sleeping: islands of nodes joined by contacts; an island sleeps once every member has
// been quiet (below the speed thresholds, supported, undriven) for the quiet time.
fn uf_find(n: u32) -> u32 {
  var r = n;
  for (var k = 0u; k < NB + NA; k++) {
    let p = atomicLoad(&sched[S_UF + r]);
    if (p == r) { break; }
    r = p;
  }
  return r;
}
var<workgroup> wufchg: atomic<u32>;
// Sleep islands over contacts, in parallel: roots hook to the smaller root (atomicMin) and paths
// are compressed until no contact joins two islands, so each island's root is its lowest node, as
// in a serial union-find. Island flags (OR over members) land on the root: 1 supported, 2 vetoed
// (moving, driven, picked, loop or mimic owner), 4 someone too young to sleep.
fn sleep_islands(tid: u32) {
  let NN = NB + NA;
  for (var n = tid; n < NN; n += WG) { atomicStore(&sched[S_UF + n], n); atomicStore(&sched[S_UFF + n], 0u); }
  if (tid == 0u) { atomicStore(&sched[S_META + 5u], 0u); }
  storageBarrier(); workgroupBarrier();
  let nc = min(atomicLoad(&counters[1]), MAXC);
  for (var c = tid; c < nc; c += WG) {
    let m = contacts[c * 5u + 2u];
    let na = body_node(i32(m.x)); let nb = body_node(i32(m.y));
    if ((na < 0 || nb < 0) && max(na, nb) >= 0 && contacts[c * 5u].w <= 1e-5) {
      atomicOr(&sched[S_UFF + u32(max(na, nb))], 1u);  // supported by static geometry
    }
  }
  loop {
    if (tid == 0u) { atomicStore(&wufchg, 0u); }
    storageBarrier(); workgroupBarrier();
    for (var c = tid; c < nc; c += WG) {
      let m = contacts[c * 5u + 2u];
      let na = body_node(i32(m.x)); let nb = body_node(i32(m.y));
      if (na < 0 || nb < 0) { continue; }
      let ra = uf_find(u32(na)); let rb = uf_find(u32(nb));
      if (ra != rb) { atomicMin(&sched[S_UF + max(ra, rb)], min(ra, rb)); atomicStore(&wufchg, 1u); }
    }
    storageBarrier(); workgroupBarrier();
    for (var n = tid; n < NN; n += WG) { atomicStore(&sched[S_UF + n], uf_find(n)); }
    storageBarrier();
    if (uniform_atomic_load(tid, &wufchg) == 0u) { break; }
  }
  for (var n = tid; n < NN; n += WG) {
    var moving = false; var fixed = false; var veto = false;
    if (n < NB) {
      if (body_kind(i32(n)) != 1u) { continue; }
      if (art[A_SLP + n * 4u + 1u] < 0.5) {
        moving = length(vel[n * 2u].xyz) > F_SLEEP_LIN || length(vel[n * 2u + 1u].xyz) > F_SLEEP_ANG;
      }
      veto = P.pick_target.w > 0.5 && u32(P.pick_local.w) == n;
    } else {
      let ai = art_info(n - NB);
      fixed = link_type(ai.x) != JT_FREE;
      for (var k = 0u; k < ai.y; k++) {
        let l = ai.x + k;
        let v = ldsv(lo(l) + L_V);
        if (art[A_SLP + n * 4u + 1u] < 0.5 && (length(v.l) > F_SLEEP_LIN || length(v.a) > F_SLEEP_ANG)) { moving = true; }
        if (P.pick_target.w > 0.5 && u32(P.pick_local.w) == u32(link_body(l))) { veto = true; }
      }
      for (var d = ai.z; d < ai.z + ai.w; d++) { let dr = dof_drive(d); if (dr.y > 0.0 || dr.z > 0.0) { veto = true; } }
      if (art_has_constraint(n - NB)) { veto = true; }
    }
    let f = select(0u, 1u, fixed) | select(0u, 2u, moving || veto) | (atomicLoad(&sched[S_UFF + n]) & 1u);
    atomicOr(&sched[S_UFF + atomicLoad(&sched[S_UF + n])], f);
  }
  storageBarrier(); workgroupBarrier();
  // Ages: reset in vetoed or unsupported islands, else grow to the quiet time; an island sleeps
  // when all its members are old enough.
  for (var n = tid; n < NN; n += WG) {
    if (n < NB && body_kind(i32(n)) != 1u) { continue; }
    let r = atomicLoad(&sched[S_UF + n]);
    let f = atomicLoad(&sched[S_UFF + r]);
    var age = art[A_SLP + n * 4u];
    if ((f & 2u) != 0u || (f & 1u) == 0u) { age = 0.0; } else { age = min(age + P.dt, F_SLEEP_TIME); }
    art[A_SLP + n * 4u] = age;
    if (age < F_SLEEP_TIME) { atomicOr(&sched[S_UFF + r], 4u); }
  }
  storageBarrier(); workgroupBarrier();
  for (var n = tid; n < NN; n += WG) {
    if (n < NB && body_kind(i32(n)) != 1u) { continue; }
    let s = (atomicLoad(&sched[S_UFF + atomicLoad(&sched[S_UF + n])]) & 4u) == 0u;
    art[A_SLP + n * 4u + 1u] = select(0.0, 1.0, s);
    if (s) { atomicAdd(&sched[S_META + 5u], 1u); }
  }
}

// Body-pair contact reduction (Newton's ContactReductionConfig(body_pairs=True), no hysteresis).
const BP_BINS = array<vec3f, 20>(
  vec3f(-0.57095543, 0.75026579, 0.33333337), vec3f(-0.64404845, 0.17218052, 0.74535593),
  vec3f(-0.86918069, -0.36525859, 0.33333330), vec3f(-0.93522697, -0.11932883, -0.33333339),
  vec3f(-0.75091368, 0.57010308, -0.33333336), vec3f(0.36427171, 0.86959472, -0.33333337),
  vec3f(-0.17291149, 0.64385240, -0.74535609), vec3f(0.47113684, 0.47167205, 0.74535599),
  vec3f(0.11826704, 0.93536185, 0.33333335), vec3f(0.17291155, -0.64385245, 0.74535603),
  vec3f(0.0, 0.0, 1.0), vec3f(-0.11826707, -0.93536184, -0.33333335),
  vec3f(-0.36427169, -0.86959473, 0.33333337), vec3f(0.0, 0.0, -1.0),
  vec3f(-0.47113677, -0.47167196, -0.74535609), vec3f(0.93522695, 0.11932898, 0.33333339),
  vec3f(0.75091367, -0.57010306, 0.33333340), vec3f(0.57095545, -0.75026579, -0.33333334),
  vec3f(0.64404840, -0.17218051, -0.74535597), vec3f(0.86918063, 0.36525872, -0.33333332));
struct BPC { k: vec3u, pos: vec2f, gap: f32, pk: u32 };
fn fflip(f: f32) -> u32 { let i = bitcast<u32>(f); return i ^ (select(0u, 0xffffffffu, (i >> 31u) != 0u) | 0x80000000u); }
// Group key (min group, max group, bin | cell), face-plane position from the pair's lower dynamic
// body origin, signed gap and the 31-bit position identity.
fn bp_contact(c: u32) -> BPC {
  let c0 = contacts[c * 5u]; let c1 = contacts[c * 5u + 1u]; let cm = contacts[c * 5u + 2u]; let c4 = contacts[c * 5u + 4u];
  let a = i32(cm.x); let b = i32(cm.y);
  let ga = u32(c4.z); let gb = u32(c4.w);
  let ng = select(c1.xyz, -c1.xyz, gb < ga);
  let rb = select(b, a, a >= 0);
  var org = vec3f(0.0);
  if (rb >= 0) { let q = poses[P_BODY + u32(rb) * 2u + 1u]; org = poses[P_BODY + u32(rb) * 2u].xyz - qrot(q, body_com_local(rb)); }
  var bin = 0u; var bd = -2.0;
  for (var i = 0u; i < 20u; i++) { let d = dot(ng, BP_BINS[i]); if (d > bd) { bd = d; bin = i; } }
  let fn_ = BP_BINS[bin];
  let rv = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(fn_.y) < 0.9);
  let u = normalize(rv - dot(rv, fn_) * fn_); let v = cross(fn_, u);
  let x = c0.xyz - org;
  let pos = vec2f(dot(x, u), dot(x, v));
  let cx = u32(i32(clamp(floor(pos.x / F_BP_CELL + 0.5), -31.0, 31.0)) + 31);
  let cy = u32(i32(clamp(floor(pos.y / F_BP_CELL + 0.5), -31.0, 31.0)) + 31);
  let qx = u32(i32(clamp(floor(pos.x * 2000.0), -32768.0, 32767.0)) + 32768);
  let qy = u32(i32(clamp(floor(pos.y * 2000.0), -8192.0, 8191.0)) + 8192);
  return BPC(vec3u(min(ga, gb), max(ga, gb), bin | (cx << 5u) | (cy << 11u)), pos, c0.w, (qx << 15u) | (qy << 1u) | 1u);
}
// Slot q's packed (score, identity): 0-5 extremes along 60-degree directions, 6 deepest,
// 7-12 extremes over touching contacts (gap <= 0); (0, 0) when not entered.
fn bp_value(g: BPC, q: u32) -> vec2u {
  if (q == 6u) { return vec2u(fflip(-g.gap), g.pk); }
  if (q > 6u && g.gap > 0.0) { return vec2u(0u); }
  let ang = f32(select(q, q - 7u, q > 6u)) * 1.0471975511965976;
  return vec2u(fflip(dot(g.pos, vec2f(cos(ang), sin(ang)))), g.pk);
}

// A contact unit's rows as Steel counts them: the contact row, its sliding pair unless it carries
// no friction (a patch member), and its angular rows.
fn row_count(row: u32) -> u32 {
  let o = row * ROWS;
  var n = 1u;
  let member = EXTRA == 1u && rows[o + PO].w == 0.0;
  if (rows[o + 2u].w > 0.0 && !member) { n += 2u; }
  if (ANG == 1u && (rows[o + 19u].x > 0.0 || rows[o + 19u].y > 0.0)) { n += 3u; }
  return min(n, 7u);
}

// The unit whose listed range holds position p: the last start <= p.
fn unit_of(p: u32, nu: u32) -> u32 {
  var lo = 0u; var hi = nu;
  for (var it = 0u; it < 32u && hi - lo > 1u; it++) {
    let mid = (lo + hi) / 2u;
    if (atomicLoad(&sched[S_USTART + mid]) <= p) { lo = mid; } else { hi = mid; }
  }
  return lo;
}

// Contact torsion (steel:min_torsional_patch_radius): one spin row per articulated unit about the
// normal of its touching coplanar cluster, budgeted by r * (mu * N - sliding). The header lives in
// the unit's first row: (Ma lin, mu), (Ma ang, 1/K), (Mb lin, spin impulse), (Mb ang, r), (n, member).
fn build_torsion(sp: u32) {
  let st = atomicLoad(&sched[S_USTART + sp]);
  let n = min(atomicLoad(&sched[S_USIZE + sp]), MAXC - min(st, MAXC));
  if (n == 0u) { return; }
  let pair = atomicLoad(&sched[S_UKEY + sp]);
  let a = i32(pair & 0xffffu) - 1; let b = i32(pair >> 16u) - 1;
  let L = st * ROWS;
  let art_u = (a >= 0 && body_kind(a) >= 2u) || (b >= 0 && body_kind(b) >= 2u);
  var seed = st;
  for (var i = st; i < st + n; i++) { if (rows[i * ROWS + 1u].w < rows[seed * ROWS + 1u].w) { seed = i; } }
  let ns = rows[seed * ROWS].xyz; let ps = rows[seed * ROWS + TO + 4u].xyz;
  var r = 0.0;
  for (var i = st; i < st + n; i++) {
    let o = i * ROWS;
    let member = art_u && rows[o + 6u].w <= 0.0 && dot(rows[o].xyz, ns) >= 0.995 && abs(dot(rows[o + TO + 4u].xyz - ps, ns)) <= 0.002;
    if (member) { r = max(r, rows[o + TO + 3u].w); }
    rows[o + TO + 4u].w = select(0.0, 1.0, member);
  }
  let mu = rows[seed * ROWS + 2u].w;
  if (r <= 0.0 || mu <= 0.0) { rows[L + TO] = vec4f(0.0); return; }
  let Ma = body_response(a, vec3f(0.0), -ns); let Mb = body_response(b, vec3f(0.0), ns);
  let k = dot(-ns, Ma[1]) + dot(ns, Mb[1]);
  let lead = rows[L + TO + 4u].w;
  rows[L + TO] = vec4f(Ma[0], mu);
  rows[L + TO + 1u] = vec4f(Ma[1], select(0.0, 1.0 / (k + F_CFM), k > 1e-12));
  rows[L + TO + 2u] = vec4f(Mb[0], 0.0);
  rows[L + TO + 3u] = vec4f(Mb[1], r);
  rows[L + TO + 4u] = vec4f(ns, lead);
}

// The unshared friction coefficients of a contact's two shapes, in body-pair order.
fn contact_shape_mu(c: u32) -> vec2f { return contacts[MAXC * 5u + c].xy; }

fn build_patch(sp: u32) {
  let st = atomicLoad(&sched[S_USTART + sp]);
  let n = min(atomicLoad(&sched[S_USIZE + sp]), MAXC - min(st, MAXC));
  if (n == 0u) { return; }
  let pair = atomicLoad(&sched[S_UKEY + sp]);
  let a = i32(pair & 0xffffu) - 1; let b = i32(pair >> 16u) - 1;
  var ca = vec3f(0.0); var cb = vec3f(0.0); var qa = vec4f(0.0, 0.0, 0.0, 1.0);
  if (a >= 0) { ca = poses[P_BODY + u32(a) * 2u].xyz; qa = poses[P_BODY + u32(a) * 2u + 1u]; }
  if (b >= 0) { cb = poses[P_BODY + u32(b) * 2u].xyz; }
  let r = max(min(body_radius(a), body_radius(b)), 1e-4);
  var seed = st;
  for (var i = st; i < st + n; i++) { if (rows[i * ROWS + 1u].w < rows[seed * ROWS + 1u].w) { seed = i; } }
  let ns = rows[seed * ROWS].xyz;
  let kept = S_KEPT + atomicLoad(&sched[S_OSTART + sp]) - st;
  let mu_seed = contact_shape_mu(atomicLoad(&sched[kept + seed]));
  // Region members lose their own friction; the first anchor is the lexicographically smallest point.
  var first = seed;
  for (var i = st; i < st + n; i++) {
    let o = i * ROWS;
    // Steel's region rule: agreeing normal and shape coefficients, coplanar with the seed and within
    // two body radii.
    let dseed = rows[o + PO + 2u].xyz - rows[seed * ROWS + PO + 2u].xyz;
    if (dot(rows[o].xyz, ns) < 0.995 || any(contact_shape_mu(atomicLoad(&sched[kept + i])) != mu_seed)
        || abs(dot(dseed, ns)) > 0.02 * r || length(dseed) > 2.0 * r) { continue; }
    rows[o + PO].w = 0.0;
    let p = rows[o + PO + 2u].xyz; let pf = rows[first * ROWS + PO + 2u].xyz;
    if (p.x < pf.x || (p.x == pf.x && (p.y < pf.y || (p.y == pf.y && p.z < pf.z)))) { first = i; }
  }
  let pf = rows[first * ROWS + PO + 2u].xyz;
  var second = first; var far = 1e-8 * r * r;
  for (var i = st; i < st + n; i++) {
    if (rows[i * ROWS + PO].w != 0.0) { continue; }
    let d = rows[i * ROWS + PO + 2u].xyz - pf;
    if (dot(d, d) > far) { far = dot(d, d); second = i; }
  }
  let na = select(1u, 2u, second != first);
  var loc0 = rows[first * ROWS + PO + 2u].xyz; var loc1 = rows[second * ROWS + PO + 2u].xyz;
  if (na == 2u) {
    // Steel's placement: along the footprint's principal axis, each anchor at an axial extreme with
    // the transverse offset and height of the members near that end (no diagonal couple on a strip).
    var t0 = cross(ns, vec3f(1.0, 0.0, 0.0));
    if (dot(t0, t0) < 1e-6) { t0 = cross(ns, vec3f(0.0, 1.0, 0.0)); }
    t0 = normalize(t0); let t1 = normalize(cross(ns, t0));
    var sx = 0.0; var sy = 0.0; var sxx = 0.0; var sxy = 0.0; var syy = 0.0; var cen = vec3f(0.0); var cnt = 0.0;
    for (var i = st; i < st + n; i++) {
      if (rows[i * ROWS + PO].w != 0.0) { continue; }
      let pc = rows[i * ROWS + PO + 2u].xyz; let d = pc - pf;
      let x = dot(d, t0); let y = dot(d, t1);
      sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; cen += pc; cnt += 1.0;
    }
    let xx = sxx - sx * sx / cnt; let xy = sxy - sx * sy / cnt; let yy = syy - sy * sy / cnt;
    let spread = sqrt((xx - yy) * (xx - yy) + 4.0 * xy * xy);
    if (spread > 1e-6 * (xx + yy)) {
      let big = 0.5 * (xx + yy + spread);
      var a2 = vec2f(xy, big - xx);
      if (xx >= yy) { a2 = vec2f(big - yy, xy); }
      a2 = normalize(a2);
      let ax = a2.x * t0 + a2.y * t1;
      var lo = 1e30; var hi = -1e30;
      for (var i = st; i < st + n; i++) {
        if (rows[i * ROWS + PO].w != 0.0) { continue; }
        let pr = dot(rows[i * ROWS + PO + 2u].xyz - pf, ax);
        if (pr < lo) { lo = pr; first = i; }
        if (pr > hi) { hi = pr; second = i; }
      }
      let centroid = cen / cnt;
      loc0 = centroid + dot(rows[first * ROWS + PO + 2u].xyz - centroid, ax) * ax;
      loc1 = centroid + dot(rows[second * ROWS + PO + 2u].xyz - centroid, ax) * ax;
      let across = normalize(cross(ns, ax));
      let tol = max(1e-5 * r, 0.05 * (hi - lo));
      var e0 = vec3f(0.0); var e1 = vec3f(0.0); var c0 = 0.0; var c1 = 0.0;
      for (var i = st; i < st + n; i++) {
        if (rows[i * ROWS + PO].w != 0.0) { continue; }
        let pc = rows[i * ROWS + PO + 2u].xyz; let pr = dot(pc - pf, ax);
        if (pr <= lo + tol) { e0 += pc; c0 += 1.0; }
        if (pr >= hi - tol) { e1 += pc; c1 += 1.0; }
      }
      e0 /= max(c0, 1.0); e1 /= max(c1, 1.0);
      loc0 += dot(e0 - centroid, across) * across + dot(e0 - centroid, ns) * ns;
      loc1 += dot(e1 - centroid, across) * across + dot(e1 - centroid, ns) * ns;
    }
  }
  // Members keep no friction of their own; anchors keep their contact-matched warm start.
  var load = 0.0;
  for (var i = st; i < st + n; i++) {
    if (rows[i * ROWS + PO].w != 0.0) { continue; }
    load += rows[i * ROWS + 6u].x;
    if (i != first && !(na == 2u && i == second)) { rows[i * ROWS + 6u] = vec4f(rows[i * ROWS + 6u].x, 0.0, 0.0, rows[i * ROWS + 6u].w); }
  }
  let rbase = AK + P.parity * AH;
  for (var k = 0u; k < na; k++) {
    let i = select(first, second, k == 1u);
    let o = i * ROWS;
    let loc = select(loc0, loc1, k == 1u);
    let nn = rows[o].xyz; let t1 = rows[o + 1u].xyz; let t2 = rows[o + 2u].xyz;
    let fra = loc - ca; let frb = loc - cb;
    // Tangent rows at the anchor.
    var Ma: array<array<vec3f, 2>, 2>; var Mb: array<array<vec3f, 2>, 2>;
    let dirs = array<vec3f, 2>(t1, t2);
    for (var q = 0u; q < 2u; q++) {
      Ma[q] = body_response(a, -dirs[q], -cross(fra, dirs[q]));
      Mb[q] = body_response(b, dirs[q], cross(frb, dirs[q]));
      rows[o + 11u + q * 4u] = vec4f(Ma[q][0], 0.0); rows[o + 12u + q * 4u] = vec4f(Ma[q][1], 0.0);
      rows[o + 13u + q * 4u] = vec4f(Mb[q][0], 0.0); rows[o + 14u + q * 4u] = vec4f(Mb[q][1], 0.0);
    }
    var K: array<f32, 4>;
    for (var x = 0u; x < 2u; x++) {
      for (var y = 0u; y < 2u; y++) {
        let d = dirs[x];
        K[x * 2u + y] = dot(-d, Ma[y][0]) + dot(-cross(fra, d), Ma[y][1]) + dot(d, Mb[y][0]) + dot(cross(frb, d), Mb[y][1]);
      }
    }
    let ks = max(K[0] + K[3], 1e-30);
    let k00 = K[0] + 1e-6 * ks; let k01 = 0.5 * (K[1] + K[2]); let k11 = K[3] + 1e-6 * ks;
    let det = k00 * k11 - k01 * k01;
    rows[o + 5u] = vec4f(k11 / det, -k01 / det, k00 / det, rows[o + 5u].w);
    rows[o + 2u] = vec4f(t2, rows[o + 2u].w / f32(na));
    // Displacement carried from the matching anchor of the previous step.
    var e = vec3f(0.0);
    var imp = vec3f(0.0); var carried = false;
    var best = 4.0 * r * r;
    for (var kk = 0u; kk < 2u; kk++) {
      var h = anchor_hash(pair, kk) % AH;
      for (var probe = 0u; probe < 32u; probe++) {
        let key = atomicLoad(&warm[rbase + h]);
        if (key == 0u) { break; }
        let vo = AV + (P.parity * AH + h) * AVN;
        if (key == anchor_hash(pair, kk) && atomicLoad(&warm[vo]) == pair && atomicLoad(&warm[vo + 1u]) == kk) {
          let ll = vec3f(bitcast<f32>(atomicLoad(&warm[vo + 2u])), bitcast<f32>(atomicLoad(&warm[vo + 3u])), bitcast<f32>(atomicLoad(&warm[vo + 4u])));
          let el = vec3f(bitcast<f32>(atomicLoad(&warm[vo + 5u])), bitcast<f32>(atomicLoad(&warm[vo + 6u])), bitcast<f32>(atomicLoad(&warm[vo + 7u])));
          let prev = ca + qrot(qa, ll);
          let dl = prev - loc;
          if (dot(dl, dl) <= best && abs(dot(dl, nn)) <= 0.05 * r) {
            // Parallel transport onto the current tangent plane keeps the spring's length (Steel).
            var ew = qrot(qa, el);
            let on = qrot(qa, vec3f(bitcast<f32>(atomicLoad(&warm[vo + 11u])), bitcast<f32>(atomicLoad(&warm[vo + 12u])), bitcast<f32>(atomicLoad(&warm[vo + 13u]))));
            let cs = dot(on, nn);
            if (cs > 0.0) { let ax = cross(on, nn); let ce = cross(ax, ew); ew += ce + cross(ax, ce) / (1.0 + cs); }
            ew -= nn * dot(nn, ew);
            if (dot(ew, ew) <= 0.01 * r * r) {
              e = ew; best = dot(dl, dl); carried = true;
              imp = qrot(qa, vec3f(bitcast<f32>(atomicLoad(&warm[vo + 8u])), bitcast<f32>(atomicLoad(&warm[vo + 9u])), bitcast<f32>(atomicLoad(&warm[vo + 10u]))));
            }
          }
          break;
        }
        h = (h + 1u) % AH;
      }
    }
    // Warm start (Steel's seed_patch_impulses): the carried anchor impulse, else the contact's,
    // projected onto the anchor's share of the region's cone.
    if (P.warm_scale > 0.0) {
      var lw = rows[o + 6u].yz;
      if (carried) { lw = vec2f(dot(imp, t1), dot(imp, t2)) * P.warm_scale; }
      let rad = max(rows[o + 2u].w * load, 0.0);
      if (length(lw) > rad) { lw *= rad / length(lw); }
      rows[o + 6u] = vec4f(rows[o + 6u].x, lw, rows[o + 6u].w);
    }
    rows[o + PO] = vec4f(fra, 2.0);
    rows[o + PO + 1u] = vec4f(frb, f32(k));
    rows[o + PO + 2u] = vec4f(e, 0.0);
    rows[o + PO + 3u] = vec4f(qinvrot(qa, fra), bitcast<f32>(pair));
  }
}

const UNIT_HEAD: u32 = 1u;
fn contact_pair(c: u32) -> u32 {
  let m = contacts[c * 5u + 2u];
  return u32(i32(m.x) + 1) | (u32(i32(m.y) + 1) << 16u);
}
fn pair_asleep(a: i32, b: i32) -> bool {
  if (SLEEP == 0u) { return false; }
  let na = body_node(a); let nb = body_node(b);
  return (na < 0 || node_asleep(na)) && (nb < 0 || node_asleep(nb));
}
// Colors are solved in parallel, so order within one does not matter, except in the overflow color
// (past NCOL), which is solved serially in slot order: sort its rows by contact index.
var<workgroup> wov: vec2u;
fn sort_overflow_color(tid: u32, nc: u32, totp: u32) {
  if (tid == 0u) {
    let o0 = min(atomicLoad(&sched[S_CSTART + NCOL]), MAXC);
    wov = vec2u(o0, min(atomicLoad(&sched[S_CSTART + NCOL + 1u]), MAXC) - o0);
  }
  let ov = workgroupUniformLoad(&wov);
  let o0 = ov.x; let m = ov.y;
  if (m < 2u) { return; }
  if (m > MAXU) {
    // Larger than the workgroup list: a serial walk in contact order.
    if (tid == 0u) {
      var k = 0u;
      for (var c = 0u; c < nc; c++) {
        let row = atomicLoad(&sched[S_ROWOF + c]);
        if (row < totp && atomicLoad(&sched[S_PCOL + row]) == NCOL && k < m) { atomicStore(&sched[S_PORD + o0 + k], row); k++; }
      }
    }
    storageBarrier(); workgroupBarrier();
    return;
  }
  var n2 = 2u;
  for (var t = 0u; t < 12u && n2 < m; t++) { n2 <<= 1u; }
  for (var i = tid; i < n2; i += WG) {
    var v = 0xffffffffu;
    if (i < m) { let row = atomicLoad(&sched[S_PORD + o0 + i]); v = (atomicLoad(&sched[S_RCON + row]) << 13u) | row; }
    wkey[i] = v;
  }
  workgroupBarrier();
  for (var k = 2u; k <= n2; k <<= 1u) {
    for (var j = k >> 1u; j > 0u; j >>= 1u) {
      for (var t = tid; t < n2 / 2u; t += WG) {
        let i = 2u * j * (t / j) + t % j; let l = i + j;
        let a = wkey[i]; let b = wkey[l];
        if ((a > b) == ((i & k) == 0u)) { wkey[i] = b; wkey[l] = a; }
      }
      workgroupBarrier();
    }
  }
  for (var i = tid; i < m; i += WG) { atomicStore(&sched[S_PORD + o0 + i], wkey[i] & 0x1fffu); }
  storageBarrier(); workgroupBarrier();
}

fn row_weight(phi: f32) -> f32 {
  if (phi > 0.0 || P.reg <= 0.0) { return 1.0; }
  return 1.0 / (1.0 + P.reg);
}

@compute @workgroup_size(PWG)
fn main(@builtin(local_invocation_index) tid: u32) {
  // Phase 0: clear unit hash and the warm table being written this substep; drive commands.
  for (var i = tid; i < UH; i += WG) { atomicStore(&sched[S_HKEY + i], 0u); atomicStore(&sched[S_HCNT + i], 0u); }
  let wbase = (1u - P.parity) * WH;
  for (var i = tid; i < WH; i += WG) { atomicStore(&warm[wbase + i], 0u); atomicStore(&sched[S_WWIN + i], 0u); }
  if (PATCH == 1u) { for (var i = tid; i < AH; i += WG) { atomicStore(&warm[AK + (1u - P.parity) * AH + i], 0u); } }
  for (var i = tid; i < NBP; i += WG) { atomicStore(&wlinkhit[i], 0u); }
  for (var i = tid; i < NBP * NCOLW; i += WG) { wmask[i] = 0u; }
  for (var i = tid; i < NCOL + 2u; i += WG) { atomicStore(&wcount[i], 0u); }
  if (tid == 0u) { atomicStore(&sched[S_META + 3u], 0u); }
  if (SLEEP == 1u) { sleep_islands(tid); }
  storageBarrier(); workgroupBarrier();
  // Baked targets (60 Hz samples), interpolated at every substep so the drives see a smooth path at any substep
  // count instead of a step per frame. Sampled at the substep's midpoint half a frame back, so each frame's
  // substeps average to that frame's sample: the timing of a target held per frame, as Newton applies it.
  // TGT_HELD scenes hold each frame's sample, for paths tuned against that (a ballistic throw).
  if (tid < P.driven) {
    let ramp = (P.phase + (f32(P.substep) + 0.5) * P.dt) * 60.0 - 0.5;
    let frame = clamp(select(ramp, P.phase * 60.0, TGT_HELD == 1u), 0.0, f32(P.path_frames - 1u));
    let a = u32(frame);
    let b = min(a + 1u, P.path_frames - 1u);
    let pa = statF[SF_PATH + (a * P.driven + tid) / 4u][(a * P.driven + tid) % 4u];
    let pb = statF[SF_PATH + (b * P.driven + tid) / 4u][(b * P.driven + tid) % 4u];
    var value = mix(pa, pb, frame - f32(a));
    if (tid < P.integral_count) {
      if (P.substep == 0u) {
        let err = clamp(value - art[A_Q + tid], -0.08, 0.08);
        art[A_INT + tid] = clamp(art[A_INT + tid] + 3.0 * P.frame_dt * err, -0.12, 0.12);
      }
      value += art[A_INT + tid];
    }
    art[A_TGT + tid] = value;
  }
  // Demo controllers (update_control), every substep.
  if (CTRL_KIND == 1u && tid == 0u) {
    let c = statF[SF_CTRL];
    art[A_TGTV + CTRL_B] = c.y * clamp(art[A_Q + CTRL_A] / c.x, 0.0, 1.0);
  }
  storageBarrier(); workgroupBarrier();
  for (var i = tid; i < NLP; i += WG) { atomicStore(&wjsplit[i], 0u); }
  if (tid < NA) {
    // Pre-solve prescale (velocity limits): scale an articulation's scalar dof velocities so the
    // most exceeded limit is met (driven dofs are left to the fused clamp in drive-row mode).
    if (VLIM_ON == 1u) {
      let ai = art_info(tid);
      var ratio = 1.0;
      for (var k = 0u; k < ai.w; k++) {
        let d = ai.z + k; let vl = dof_passive(d).z;
        if (vl < 0.0 || fused_dof(d)) { continue; }
        let s = abs(art[A_QD + d]);
        if (s > vl) { ratio = min(ratio, vl / s); }
      }
      if (ratio < 1.0) {
        for (var k = 0u; k < ai.w; k++) {
          let d = ai.z + k;
          if (scalar_dof(d) && !fused_dof(d)) { art[A_QD + d] *= ratio; }
        }
      }
      // velocity_limit_activation_fraction: a dof's rows exist only near its limit this step.
      var any = false;
      for (var k = 0u; k < ai.w; k++) {
        let d = ai.z + k;
        let on = abs(art[A_QD + d]) >= F_VLIM_FRAC * dof_passive(d).z;
        art[A_VLG + d] = select(0.0, 1.0, on);
        any = any || (on && dof_passive(d).z >= 0.0 && scalar_dof(d));
      }
      art[A_AVL + tid] = select(0.0, 1.0, any);
    }
    // joint_limit_activation_gap: a limit row exists only within gap (+ 2 dt |qd| when speed-aware) of
    // its bound; farther rows are speculative no-ops this step. The row sweeps visit only the dofs
    // listed here (an arm away from its limits sweeps just its gripper's).
    let ai = art_info(tid);
    var n = 0u;
    for (var k = 0u; k < ai.w; k++) {
      let d = ai.z + k; let lim = dof_limit(d);
      var on = false;
      if (lim.z > 0.5) {
        let l = u32(lim.w);
        let q = art[A_Q + link_qs(l) + d - link_dof(l)];
        let g = F_JL_GAP + F_JL_SPEED * P.dt * abs(art[A_QD + d]);
        on = q <= lim.x + g || q >= lim.y - g;
      }
      art[A_LG + d] = select(0.0, 1.0, on);
      let dr = dof_drive(d);
      let row = on || dof_passive(d).y > 0.0 || JFL == 1u || (DRIVE_ROWS == 1u && (dr.y > 0.0 || dr.z > 0.0));
      if (row && scalar_dof(d)) { art[A_RL + ai.z + n] = f32(d); n++; }
    }
    art[A_RLN + tid] = f32(n);
    art_fk(tid); art_factor(tid);
  }
  if (VLIM_FREE == 1u) {
    for (var b = tid; b < NB; b += WG) {
      if (body_kind(i32(b)) != 1u) { continue; }
      let lim = body_limits(i32(b));
      let v = vel[b * 2u].xyz; let w = vel[b * 2u + 1u].xyz;
      for (var k = 0u; k < 3u; k++) {
        art[A_VLG + ND + b * 6u + k] = select(0.0, 1.0, abs(v[k]) >= F_VLIM_FRAC * lim.y);
        art[A_VLG + ND + b * 6u + 3u + k] = select(0.0, 1.0, abs(w[k]) >= F_VLIM_FRAC * lim.z);
      }
    }
  }
  // Phase 1: group contacts by body pair. csort leaves the contacts sorted by pair key, so a unit is a
  // run of one key and takes the run's rank as its slot: the grouping repeats run to run.
  let nc = min(atomicLoad(&counters[1]), MAXC);
  let cch = (nc + WG - 1u) / WG;
  let c_lo = min(tid * cch, nc); let c_hi = min(c_lo + cch, nc);
  // One scan counts both the units (low half) and the same-articulation dense rows (high half).
  // Each contact's class goes to S_CSLOT for the second pass: 0xfffffffe no rows (no awake node),
  // 0xffffffff a same-articulation contact (dense rows, phase 7, when S_CLOCAL is 1), else a unit contact
  // (UNIT_HEAD on the first of its run).
  var heads = 0u; var dn = 0u;
  var prev = select(0xffffffffu, contact_pair(c_lo - 1u), c_lo > 0u && c_lo < c_hi);
  for (var c = c_lo; c < c_hi; c++) {
    let m = contacts[c * 5u + 2u];
    let a = i32(m.x); let b = i32(m.y);
    let pk = u32(a + 1) | (u32(b + 1) << 16u);
    var cls = 0xfffffffeu;
    if (!pair_asleep(a, b)) {
      if (same_art(a, b)) {
        cls = 0xffffffffu;
        let rows = !node_asleep(body_node(a));
        if (rows) { dn++; }
        atomicStore(&sched[S_CLOCAL + c], select(0u, 1u, rows));
      } else {
        cls = select(0u, UNIT_HEAD, c == 0u || prev != pk);
        if (cls != 0u) { heads++; }
      }
    }
    atomicStore(&sched[S_CSLOT + c], cls);
    prev = pk;
  }
  wscan[tid] = heads | (dn << 16u);
  workgroupBarrier();
  scan(tid);
  var unit = (wscan[tid] & 0xffffu) - heads;
  var dslot = (wscan[tid] >> 16u) - dn;
  let ndc = wscan[WG - 1u] >> 16u;
  let nruns = max(wscan[WG - 1u] & 0xffffu, 1u);
  var run0 = c_lo;
  if (c_lo < c_hi && atomicLoad(&sched[S_CSLOT + c_lo]) == 0u) {
    for (var k = 0u; k < MAXC && run0 > 0u && contact_pair(run0 - 1u) == contact_pair(c_lo); k++) { run0--; }
  }
  for (var c = c_lo; c < c_hi; c++) {
    let cls = atomicLoad(&sched[S_CSLOT + c]);
    if (cls >= 0xfffffffeu) { continue; }
    let cmeta = contacts[c * 5u + 2u];
    let a = i32(cmeta.x); let b = i32(cmeta.y);
    if (cls == UNIT_HEAD) { unit++; run0 = c; }
    let h = unit - 1u;
    if (h >= UH) { atomicStore(&sched[S_CSLOT + c], 0xfffffffeu); continue; }
    if (c == run0) { atomicStore(&sched[S_HKEY + h], contact_pair(c)); }
    atomicAdd(&sched[S_HCNT + h], 1u);
    atomicStore(&sched[S_CSLOT + c], h);
    atomicStore(&sched[S_CLOCAL + c], c - run0);
    if (a >= 0 && body_kind(a) == 2u) { atomicStore(&wlinkhit[u32(a)], 1u); }
    if (b >= 0 && body_kind(b) == 2u) { atomicStore(&wlinkhit[u32(b)], 1u); }
  }
  storageBarrier(); workgroupBarrier();
  // Phase 2: compact occupied slots into units.
  // One scan counts the units (low half) and their contacts (high half): each unit's offset in the
  // coloring walk (units in slot order, a unit's contacts together, as they arrive per pair).
  let per = UH / WG;
  var cnt = 0u; var csz = 0u;
  for (var k = 0u; k < per; k++) { if (atomicLoad(&sched[S_HKEY + tid * per + k]) != 0u) { cnt++; csz += atomicLoad(&sched[S_HCNT + tid * per + k]); } }
  wscan[tid] = cnt | (csz << 16u);
  workgroupBarrier();
  scan(tid);
  var u = (wscan[tid] & 0xffffu) - cnt;
  var woff = (wscan[tid] >> 16u) - csz;
  for (var k = 0u; k < per; k++) {
    let h = tid * per + k;
    let key = atomicLoad(&sched[S_HKEY + h]);
    if (key != 0u) {
      if (u < MAXU) {
        wkey[u] = key;
        atomicStore(&sched[S_USIZE_TMP + u], atomicLoad(&sched[S_HCNT + h]));
      }
      atomicStore(&sched[S_SLOT2U + h], u);
      atomicStore(&sched[S_UWOFF + h], woff);
      woff += atomicLoad(&sched[S_HCNT + h]);
      u++;
    }
  }
  if (tid == WG - 1u) { wnu = min(wscan[tid] & 0xffffu, MAXU); wnwalk = wscan[tid] >> 16u; }
  // Steel's joint split: n_j = contact-bearing links whose root path crosses joint j.
  for (var l = tid; l < NL; l += WG) {
    if (atomicLoad(&wlinkhit[u32(link_body(l))]) == 0u) { continue; }
    var j = i32(l);
    loop {
      if (j < 0) { break; }
      atomicAdd(&wjsplit[u32(j)], 1u);
      j = link_parent(u32(j));
    }
  }
  storageBarrier(); workgroupBarrier();
  for (var l = tid; l < NL; l += WG) {
    if (atomicLoad(&wlinkhit[u32(link_body(l))]) == 0u) { continue; }
    var path: array<u32, MAXPATH>;
    let np = link_path(l, &path);
    var cnt: array<u32, MAXPATH>;
    for (var i = 0u; i < np; i++) { cnt[i] = atomicLoad(&wjsplit[path[i]]); }
    link_response(l, &cnt);
  }
  for (var d = tid; d < ND; d += WG) {
    let lim = dof_limit(d);
    let dr = dof_drive(d);
    if (lim.z > 0.5 || dof_passive(d).y > 0.0 || dof_passive(d).z >= 0.0 || statF[SF_DOF + d * 5u + 3u].w > 0.0 || (DRIVE_ROWS == 1u && (dr.y > 0.0 || dr.z > 0.0))) {
      let l = u32(lim.w);
      art[A_HINV + d] = dof_hinv(l, d - link_dof(l));
    }
  }
  storageBarrier(); workgroupBarrier();
  for (var c = tid; c < nc; c += WG) {
    let h = atomicLoad(&sched[S_CSLOT + c]);
    if (h >= UH) { continue; }
    let u0 = atomicLoad(&sched[S_SLOT2U + h]);
    atomicStore(&sched[S_WALK + atomicLoad(&sched[S_UWOFF + h]) + atomicLoad(&sched[S_CLOCAL + c])], select(c, 0xffffffffu, u0 >= MAXU));
  }
  let nu = wnu;
  // Phases 3-4: units keep their slot order (the sweep colors contact points, phase 6c); contact offsets
  // in that order.
  if (tid == 0u) { atomicStore(&sched[S_META + 0u], nu); atomicStore(&sched[S_META + 2u], nc); }
  for (var i = tid; i < nu; i += WG) {
    atomicStore(&sched[S_UKEY + i], wkey[i]);
    atomicStore(&sched[S_USIZE + i], atomicLoad(&sched[S_USIZE_TMP + i]));
    wcol[i] = i;
  }
  storageBarrier(); workgroupBarrier();
  let per2 = (MAXU + WG - 1u) / WG;
  var s2 = 0u;
  for (var k = 0u; k < per2; k++) { let i = tid * per2 + k; if (i < nu) { s2 += atomicLoad(&sched[S_USIZE + i]); } }
  wscan[tid] = s2;
  workgroupBarrier();
  scan(tid);
  var off = wscan[tid] - s2;
  for (var k = 0u; k < per2; k++) {
    let i = tid * per2 + k;
    if (i < nu) { atomicStore(&sched[S_USTART + i], off); off += atomicLoad(&sched[S_USIZE + i]); }
  }
  if (tid == 0u) { atomicStore(&sched[S_USTART + nu], wscan[WG - 1u]); }
  storageBarrier(); workgroupBarrier();
  // Phase 5: list each unit's contacts and reduce them by group (bp_contact, bp_value).
  for (var c = tid; c < nc; c += WG) {
    let slot = atomicLoad(&sched[S_CSLOT + c]);
    if (slot >= 0xfffffffeu) { continue; }
    let u0 = atomicLoad(&sched[S_SLOT2U + slot]);
    if (u0 >= MAXU) { continue; }
    atomicStore(&sched[S_CORDER + atomicLoad(&sched[S_USTART + wcol[u0]]) + atomicLoad(&sched[S_CLOCAL + c])], c);
  }
  storageBarrier(); workgroupBarrier();
  // Each listed contact's group key, then its group's leader (first member in the unit).
  let nl = min(atomicLoad(&sched[S_USTART + nu]), MAXC);
  for (var p = tid; p < nl; p += WG) {
    let g = bp_contact(atomicLoad(&sched[S_CORDER + p]));
    atomicStore(&sched[S_RK0 + p], g.k.x); atomicStore(&sched[S_RK1 + p], g.k.y); atomicStore(&sched[S_RK2 + p], g.k.z);
  }
  for (var sp = tid; sp < nu; sp += WG) { atomicStore(&sched[S_OSTART + sp], atomicLoad(&sched[S_USTART + sp])); }
  storageBarrier(); workgroupBarrier();
  for (var p = tid; p < nl; p += WG) {
    let st = atomicLoad(&sched[S_USTART + unit_of(p, nu)]);
    let k0 = atomicLoad(&sched[S_RK0 + p]); let k1 = atomicLoad(&sched[S_RK1 + p]); let k2 = atomicLoad(&sched[S_RK2 + p]);
    var lead = p;
    for (var m = st; m < p; m++) {
      if (atomicLoad(&sched[S_RK2 + m]) == k2 && atomicLoad(&sched[S_RK0 + m]) == k0 && atomicLoad(&sched[S_RK1 + m]) == k1) { lead = m; break; }
    }
    atomicStore(&sched[S_LEAD + p], lead);
    for (var q = 0u; q < 26u; q++) { atomicStore(&sched[S_SLOT + p * 26u + q], 0u); }
  }
  storageBarrier(); workgroupBarrier();
  // Slot winners by (score, identity): the score's max first, then the identity among its ties.
  for (var p = tid; p < nl; p += WG) {
    let g = bp_contact(atomicLoad(&sched[S_CORDER + p]));
    let sl = S_SLOT + atomicLoad(&sched[S_LEAD + p]) * 26u;
    for (var q = 0u; q < 13u; q++) { let v = bp_value(g, q); if (v.y != 0u) { atomicMax(&sched[sl + q * 2u], v.x); } }
  }
  storageBarrier(); workgroupBarrier();
  for (var p = tid; p < nl; p += WG) {
    let g = bp_contact(atomicLoad(&sched[S_CORDER + p]));
    let sl = S_SLOT + atomicLoad(&sched[S_LEAD + p]) * 26u;
    for (var q = 0u; q < 13u; q++) { let v = bp_value(g, q); if (v.y != 0u && v.x == atomicLoad(&sched[sl + q * 2u])) { atomicMax(&sched[sl + q * 2u + 1u], v.y); } }
  }
  storageBarrier(); workgroupBarrier();
  for (var p = tid; p < nl; p += WG) {
    let g = bp_contact(atomicLoad(&sched[S_CORDER + p]));
    let sl = S_SLOT + atomicLoad(&sched[S_LEAD + p]) * 26u;
    var win = false;
    for (var q = 0u; q < 13u; q++) {
      let v = bp_value(g, q);
      if (v.y != 0u && v.x == atomicLoad(&sched[sl + q * 2u]) && v.y == atomicLoad(&sched[sl + q * 2u + 1u])) { win = true; }
    }
    // Compliant contacts stay whole: Steel does not take reduced ones.
    atomicStore(&sched[S_LEAD + p], select(0u, 1u, win || CCOMPL == 1u));
  }
  storageBarrier(); workgroupBarrier();
  // Compact each unit's survivors in listing order.
  for (var sp = tid; sp < nu; sp += WG) {
    let n = atomicLoad(&sched[S_USIZE + sp]);
    let st = atomicLoad(&sched[S_USTART + sp]);
    var kept = 0u;
    for (var j = 0u; j < n; j++) {
      if (st + j >= MAXC) { break; }
      if (atomicLoad(&sched[S_LEAD + st + j]) != 0u) { atomicStore(&sched[S_KEPT + st + kept], atomicLoad(&sched[S_CORDER + st + j])); kept++; }
    }
    atomicStore(&sched[S_USIZE + sp], kept);
  }
  storageBarrier(); workgroupBarrier();
  s2 = 0u;
  for (var k = 0u; k < per2; k++) { let i = tid * per2 + k; if (i < nu) { s2 += atomicLoad(&sched[S_USIZE + i]); } }
  wscan[tid] = s2;
  workgroupBarrier();
  scan(tid);
  off = wscan[tid] - s2;
  for (var k = 0u; k < per2; k++) {
    let i = tid * per2 + k;
    if (i < nu) { atomicStore(&sched[S_USTART + i], off); off += atomicLoad(&sched[S_USIZE + i]); }
  }
  if (tid == 0u) { atomicStore(&sched[S_USTART + nu], wscan[WG - 1u]); }
  storageBarrier(); workgroupBarrier();
  // Phase 6: build rows.
  let rbase = P.parity * WH;
  let total = min(atomicLoad(&sched[S_USTART + nu]), MAXC);
  for (var idx = tid; idx < total; idx += WG) {
    let sp = unit_of(idx, nu);
    let c = atomicLoad(&sched[S_KEPT + atomicLoad(&sched[S_OSTART + sp]) + idx - atomicLoad(&sched[S_USTART + sp])]);
    let c0 = contacts[c * 5u]; let c1 = contacts[c * 5u + 1u]; let cmeta = contacts[c * 5u + 2u];
    let a = i32(cmeta.x); let b = i32(cmeta.y);
    let key = max(u32(cmeta.z) | (u32(cmeta.w) << 16u), 1u);
    let p = c0.xyz; let phi = c0.w; let n = c1.xyz;
    let mu = select(0.0, c1.w * F_FSCALE, phi <= F_FGAP);
    var t1 = cross(n, vec3f(1.0, 0.0, 0.0));
    if (dot(t1, t1) < 0.1) { t1 = cross(n, vec3f(0.0, 1.0, 0.0)); }
    t1 = normalize(t1);
    let t2 = cross(n, t1);
    var ca = vec3f(0.0); var cb = vec3f(0.0);
    if (a >= 0) { ca = poses[P_BODY + u32(a) * 2u].xyz; }
    if (b >= 0) { cb = poses[P_BODY + u32(b) * 2u].xyz; }
    // Lever arms: the witness points on each surface, or their midpoint with contact_shared_anchor
    // (contact_friction_shared_anchor moves only the friction rows to the midpoint).
    let half = select(0.5 * phi, 0.0, SHARED == 1u);
    let ra = p - n * half - ca; let rb = p + n * half - cb;
    var fa = ra; var fb = rb;
    if (FSHARED == 1u) { fa = p - ca; fb = p - cb; }
    let o = idx * ROWS;
    let dirs = array<vec3f, 3>(n, t1, t2);
    var Ma: array<array<vec3f, 2>, 3>; var Mb: array<array<vec3f, 2>, 3>;
    for (var r = 0u; r < 3u; r++) {
      let d = dirs[r];
      let aa = select(fa, ra, r == 0u); let ab = select(fb, rb, r == 0u);
      Ma[r] = body_response(a, -d, -cross(aa, d));
      Mb[r] = body_response(b, d, cross(ab, d));
      rows[o + 7u + r * 4u] = vec4f(Ma[r][0], 0.0); rows[o + 8u + r * 4u] = vec4f(Ma[r][1], 0.0);
      rows[o + 9u + r * 4u] = vec4f(Mb[r][0], 0.0); rows[o + 10u + r * 4u] = vec4f(Mb[r][1], 0.0);
    }
    // K_ij = J_i M^-1 J_j^T.
    var K: array<f32, 9>;
    for (var r = 0u; r < 3u; r++) {
      for (var s = 0u; s < 3u; s++) {
        let d = dirs[r];
        let aa = select(fa, ra, r == 0u); let ab = select(fb, rb, r == 0u);
        K[r * 3u + s] = dot(-d, Ma[s][0]) + dot(-cross(aa, d), Ma[s][1]) + dot(d, Mb[s][0]) + dot(cross(ab, d), Mb[s][1]);
      }
    }
    if (EXTRA == 1u) {
      rows[o + PO] = vec4f(fa, 1.0); rows[o + PO + 1u] = vec4f(fb, 0.0); rows[o + PO + 2u] = vec4f(p, 0.0);
    }
    if (TORS == 1u) { rows[o + TO + 3u] = vec4f(0.0, 0.0, 0.0, contacts[c * 5u + 3u].w); rows[o + TO + 4u] = vec4f(p, 0.0); }
    if (FMODE > 0u) {
      rows[o + FMO] = vec4f(K[0], 0.5 * (K[1] + K[3]), 0.5 * (K[2] + K[6]), 0.0);
      rows[o + FMO + 1u] = vec4f(K[4], 0.5 * (K[5] + K[7]), K[8], 0.0);
    }
    // Rows with no response (e.g. along a joint axis against the world) are inert.
    let kscale = max(K[0] + K[4] + K[8], 1e-30);
    var effn = 0.0;
    if (K[0] > 1e-6 * kscale && K[0] > 1e-12) { effn = 1.0 / (K[0] + F_CFM); }
    var k00 = K[4] + 1e-6 * kscale + F_CFM; let k01 = 0.5 * (K[5] + K[7]); var k11 = K[8] + 1e-6 * kscale + F_CFM;
    let det = k00 * k11 - k01 * k01;
    var rhs = 0.0;
    if (phi < 0.0) { rhs = max(P.beta * phi / P.dt, -depen_cap(a, b)); } else { rhs = F_SPEC * phi / P.dt; }
    // Restitution from the pre-step closing speed; a firing row targets the rebound and stays rigid.
    let e = contacts[c * 5u + 3u].x;
    var bounce = false;
    if (e > 0.0) {
      let ta0 = pre_twist(a); let tb0 = pre_twist(b);
      let vn0 = dot(n, (tb0[0] + cross(tb0[1], rb)) - (ta0[0] + cross(ta0[1], ra)));
      bounce = restitution_fires(e, phi, vn0);
      if (bounce) { rhs = e * vn0; }
    }
    // Warm start from the previous substep's table.
    var ln = 0.0; var lf = vec3f(0.0);
    var h = key % WH;
    for (var probe = 0u; probe < 32u; probe++) {
      let k = atomicLoad(&warm[rbase + h]);
      if (k == 0u) { break; }
      if (k == key) {
        let vo = 2u * WH * 1u + (rbase + h) * 4u;
        ln = bitcast<f32>(atomicLoad(&warm[vo])) * P.warm_scale;
        lf = vec3f(bitcast<f32>(atomicLoad(&warm[vo + 1u])), bitcast<f32>(atomicLoad(&warm[vo + 2u])), bitcast<f32>(atomicLoad(&warm[vo + 3u]))) * P.warm_scale;
        break;
      }
      h = (h + 1u) % WH;
    }
    var lt = vec2f(dot(lf, t1), dot(lf, t2));
    let lim = mu * ln;
    let lm = length(lt);
    if (lm > lim) { lt *= lim / max(lm, 1e-12); }
    var effc = effn; var rhsc = rhs;
    if (COMPL == 1u) {
      // contact_compliance: a spring-damper normal (Steel's compliant rows).
      // Shape ke and kd are the pair's: split them over the pair's kept points.
      // framefields: a spring row (torsion radius -2) keeps its own ke and kd.
      let kc = contacts[c * 5u + 4u] / select(f32(max(atomicLoad(&sched[S_USIZE + sp]), 1u)), 1.0, contacts[c * 5u + 3u].w < -1.5);
      var gam = 0.0;
      if (kc.x > 0.0) {
        let ce = select(0.0, kc.y, phi <= 0.0);
        let den = P.dt * kc.x + ce;
        gam = 1.0 / (P.dt * den);
        rhsc = kc.x * phi / den;
        if (effn > 0.0) { effc = 1.0 / (1.0 / effn + gam); }
      }
      rows[o + CO] = vec4f(gam, 0.0, 0.0, 0.0);
    }
    rows[o + 0u] = vec4f(n, effc);
    rows[o + 1u] = vec4f(t1, rhsc);
    rows[o + 2u] = vec4f(t2, mu);
    rows[o + 3u] = vec4f(ra, f32(key & 0xffffu));
    rows[o + 4u] = vec4f(rb, f32(key >> 16u));
    // Steel regularizes a split row against its unsplit diagonal, so the split changes the step
    // and not the fixed point: w' = w d / (w d + (1 - w) d_unsplit).
    var wrow = row_weight(phi);
    if (wrow < 1.0 && ((a >= 0 && body_kind(a) == 2u) || (b >= 0 && body_kind(b) == 2u))) {
      let ua = body_response_unsplit(a, -n, -cross(ra, n)); let ub = body_response_unsplit(b, n, cross(rb, n));
      let du = dot(-n, ua[0]) + dot(-cross(ra, n), ua[1]) + dot(n, ub[0]) + dot(cross(rb, n), ub[1]);
      if (du > 0.0 && K[0] != du) { wrow = wrow * K[0] / (wrow * K[0] + (1.0 - wrow) * du); }
    }
    rows[o + 5u] = vec4f(k11 / det, -k01 / det, k00 / det, select(wrow, 1.0, bounce));
    rows[o + 6u] = vec4f(ln, lt, select(phi, 1e30, bounce));  // w: phi for the velocity pass (1e30: restitution)
    if (ANG == 1u) {
      // Torsional (about n) and rolling (about t1, t2) rows: angular-only Jacobians.
      let mat = contacts[c * 5u + 3u];
      var KA: array<f32, 9>;
      var MA: array<array<vec3f, 2>, 3>; var MB: array<array<vec3f, 2>, 3>;
      for (var r = 0u; r < 3u; r++) {
        let d = dirs[r];
        MA[r] = body_response(a, vec3f(0.0), -d);
        MB[r] = body_response(b, vec3f(0.0), d);
        rows[o + 22u + r * 4u] = vec4f(MA[r][0], 0.0); rows[o + 23u + r * 4u] = vec4f(MA[r][1], 0.0);
        rows[o + 24u + r * 4u] = vec4f(MB[r][0], 0.0); rows[o + 25u + r * 4u] = vec4f(MB[r][1], 0.0);
      }
      for (var r = 0u; r < 3u; r++) {
        for (var s3 = 0u; s3 < 3u; s3++) { KA[r * 3u + s3] = dot(-dirs[r], MA[s3][1]) + dot(dirs[r], MB[s3][1]); }
      }
      let ks = max(KA[0], 1e-12);
      let r00 = KA[4] + 1e-9; let r01 = 0.5 * (KA[5] + KA[7]); let r11 = KA[8] + 1e-9;
      let rd = r00 * r11 - r01 * r01;
      rows[o + 19u] = vec4f(mat.y, mat.z, select(0.0, 1.0 / ks, KA[0] > 1e-12), 0.0);
      rows[o + 20u] = vec4f(r11 / rd, -r01 / rd, r00 / rd, 0.0);
      rows[o + 21u] = vec4f(0.0);
      if (ANG_ART == 1u) {
        // Raw 5x5 response H (t1, t2, spin, roll1, roll2), upper triangle, for the elliptic block.
        var JA: array<array<vec3f, 2>, 5>; var JB: array<array<vec3f, 2>, 5>;
        var RA: array<array<vec3f, 2>, 5>; var RB: array<array<vec3f, 2>, 5>;
        for (var q = 0u; q < 2u; q++) {
          let d = dirs[q + 1u];
          JA[q] = array<vec3f, 2>(-d, -cross(fa, d)); JB[q] = array<vec3f, 2>(d, cross(fb, d));
          RA[q] = Ma[q + 1u]; RB[q] = Mb[q + 1u];
        }
        for (var q = 0u; q < 3u; q++) {
          JA[q + 2u] = array<vec3f, 2>(vec3f(0.0), -dirs[q]); JB[q + 2u] = array<vec3f, 2>(vec3f(0.0), dirs[q]);
          RA[q + 2u] = MA[q]; RB[q + 2u] = MB[q];
        }
        var Hu: array<f32, 16>;
        var idx = 0u;
        for (var x = 0u; x < 5u; x++) {
          for (var y = x; y < 5u; y++) {
            Hu[idx] = dot(JA[x][0], RA[y][0]) + dot(JA[x][1], RA[y][1]) + dot(JB[x][0], RB[y][0]) + dot(JB[x][1], RB[y][1]);
            idx++;
          }
        }
        Hu[15] = 0.0;
        for (var q = 0u; q < 4u; q++) { rows[o + EO + q] = vec4f(Hu[q * 4u], Hu[q * 4u + 1u], Hu[q * 4u + 2u], Hu[q * 4u + 3u]); }
      }
    }
  }
  // Phase 6b: friction patches. A unit's points whose normals agree with its deepest point form
  // one region; its friction acts at one or two anchors that share the region's normal load and
  // carry a tangential displacement across steps (Steel's friction anchors).
  if (TORS == 1u) {
    storageBarrier(); workgroupBarrier();
    for (var sp = tid; sp < nu; sp += WG) { build_torsion(sp); }
  }
  if (PATCH == 1u) {
    storageBarrier(); workgroupBarrier();
    for (var sp = tid; sp < nu; sp += WG) { build_patch(sp); }
  }
  storageBarrier(); workgroupBarrier();
  // Phase 6c: Steel's scheduling: each contact point is its own unit, colored greedily in contact
  // order so no two points of a color share a body; a pair's torsion row rides its last color.
  let totp = min(atomicLoad(&sched[S_USTART + nu]), MAXC);
  for (var c = tid; c < nc; c += WG) { atomicStore(&sched[S_ROWOF + c], 0xffffffffu); }
  for (var i = tid; i < NBP * NCOLW; i += WG) { wmask[i] = 0u; }
  for (var i = tid; i < NCOL + 2u; i += WG) { atomicStore(&wcount[i], 0u); }
  // Contact order packs (top color + 1, contact) into S_UTP to recover each unit's last top row.
  for (var sp = tid; sp < nu; sp += WG) { atomicStore(&sched[S_UTC + sp], 0u); atomicStore(&sched[S_UTP + sp], select(0xffffffffu, 0u, LONGEST_FIRST == 0u)); }
  storageBarrier(); workgroupBarrier();
  for (var row = tid; row < totp; row += WG) {
    let sp = unit_of(row, nu);
    let c = atomicLoad(&sched[S_KEPT + atomicLoad(&sched[S_OSTART + sp]) + row - atomicLoad(&sched[S_USTART + sp])]);
    atomicStore(&sched[S_RUNIT + row], sp);
    atomicStore(&sched[S_RCON + row], c);
    if (c < nc) { atomicStore(&sched[S_ROWOF + c], row); }
  }
  storageBarrier(); workgroupBarrier();
  if (LONGEST_FIRST == 0u) {
    // The first-fit walk over units in slot order, each unit's points together, as they arrive per pair.
    if (tid == 0u) { wnc = min(wnwalk, MAXC); }
    let ncu = workgroupUniformLoad(&wnc);
    for (var base = 0u; base < ncu; base += MAXU) {
      let n = min(MAXU, ncu - base);
      for (var i = tid; i < n; i += WG) {
        let wc = atomicLoad(&sched[S_WALK + base + i]);
        let row = select(0xffffffffu, atomicLoad(&sched[S_ROWOF + min(wc, MAXC - 1u)]), wc < MAXC);
        wkey[i] = select(0xffffffffu, atomicLoad(&sched[S_UKEY + atomicLoad(&sched[S_RUNIT + min(row, MAXC - 1u)])]), row < totp);
      }
      color_in_order(tid, n);
      workgroupBarrier();
      for (var i = tid; i < n; i += WG) {
        if (wkey[i] == 0xffffffffu) { continue; }
        let c = atomicLoad(&sched[S_WALK + base + i]);
        let row = atomicLoad(&sched[S_ROWOF + c]);
        let col = wcol[i];
        atomicStore(&sched[S_PCOL + row], col);
        atomicAdd(&wcount[col], 1u);
        atomicMax(&sched[S_UTP + atomicLoad(&sched[S_RUNIT + row])], ((col + 1u) << 16u) | c);
      }
      workgroupBarrier();
    }
    storageBarrier(); workgroupBarrier();
    for (var sp = tid; sp < nu; sp += WG) {
      let packed = atomicLoad(&sched[S_UTP + sp]);
      atomicStore(&sched[S_UTC + sp], packed >> 16u);
      atomicStore(&sched[S_UTP + sp], select(0xffffffffu, atomicLoad(&sched[S_ROWOF + (packed & 0xffffu)]), packed != 0u));
    }
    storageBarrier(); workgroupBarrier();
  }
  if (tid == 0u) {
    // propagation_color_order "longest_first": by row count first, then contact index.
    for (var lp = 0u; lp < select(0u, 8u, LONGEST_FIRST == 1u); lp++) {
    for (var c = 0u; c < nc; c++) {
      let row = atomicLoad(&sched[S_ROWOF + c]);
      if (row >= totp) { continue; }
      if (LONGEST_FIRST == 1u && row_count(row) != 7u - lp) { continue; }
      let sp = atomicLoad(&sched[S_RUNIT + row]);
      let key = atomicLoad(&sched[S_UKEY + sp]);
      let a = i32(key & 0xffffu) - 1; let b = i32(key >> 16u) - 1;
      let col = first_free_color(a, b);
      atomicStore(&sched[S_PCOL + row], col);
      atomicAdd(&wcount[col], 1u);
      if (col + 1u >= atomicLoad(&sched[S_UTC + sp])) { atomicStore(&sched[S_UTC + sp], col + 1u); atomicStore(&sched[S_UTP + sp], row); }
    }
    }
    var acc = 0u; var ncol = 0u;
    for (var c = 0u; c <= NCOL; c++) {
      let n = atomicLoad(&wcount[c]);
      atomicStore(&sched[S_CSTART + c], acc);
      atomicStore(&wcount[c], acc);
      acc += n;
      if (n > 0u) { ncol = c + 1u; }
    }
    atomicStore(&sched[S_CSTART + NCOL + 1u], acc);
    atomicStore(&sched[S_META + 1u], ncol);
  }
  storageBarrier(); workgroupBarrier();
  for (var row = tid; row < totp; row += WG) {
    let slot = atomicAdd(&wcount[atomicLoad(&sched[S_PCOL + row])], 1u);
    if (slot < MAXC) { atomicStore(&sched[S_PORD + slot], row); }
  }
  storageBarrier(); workgroupBarrier();
  sort_overflow_color(tid, nc, totp);
  // Phase 7: dense rows for same-articulation contacts, in contact order, then loop closures and
  // mimics: fixed slots, so the dense sweep order repeats run to run.
  var nloop_rows = 0u;
  for (var k = 0u; k < NLOOP; k++) { nloop_rows += select(1u, 2u, statF[SF_LOOP + k * 5u].w > 0.5); }
  if (tid == 0u) { atomicStore(&sched[S_META + 3u], ndc + nloop_rows + NMIMIC); }
  for (var c = c_lo; c < c_hi; c++) {
    if (atomicLoad(&sched[S_CSLOT + c]) != 0xffffffffu || atomicLoad(&sched[S_CLOCAL + c]) == 0u) { continue; }
    let slot = dslot;
    dslot++;
    if (slot >= MAXDENSE) { continue; }
    let c0 = contacts[c * 5u]; let c1 = contacts[c * 5u + 1u]; let cmeta = contacts[c * 5u + 2u];
    let a = i32(cmeta.x); let b = i32(cmeta.y);
    let key = max(u32(cmeta.z) | (u32(cmeta.w) << 16u), 1u);
    let p = c0.xyz; let phi = c0.w; let n = c1.xyz;
    let mu = select(0.0, c1.w * F_FSCALE, phi <= F_FGAP);
    var t1 = cross(n, vec3f(1.0, 0.0, 0.0));
    if (dot(t1, t1) < 0.1) { t1 = cross(n, vec3f(0.0, 1.0, 0.0)); }
    t1 = normalize(t1);
    let t2 = cross(n, t1);
    let art_id = u32(body_art(a));
    let ai = art_info(art_id);
    var J: array<f32, JDIM>;
    for (var k = 0u; k < JDIM; k++) { J[k] = 0.0; }
    add_gen_jac(u32(body_link(b)), p, 1.0, n, t1, t2, ai.z, &J);
    add_gen_jac(u32(body_link(a)), p, -1.0, n, t1, t2, ai.z, &J);
    let o = A_DENSE + slot * DPS;
    var K: array<f32, 9>;
    for (var r = 0u; r < 3u; r++) {
      var tau: array<f32, NDA>; var y: array<f32, NDA>;
      for (var k = 0u; k < NDA; k++) { tau[k] = select(0.0, J[r * NDA + k], k < ai.w); y[k] = 0.0; }
      art_solve_gen(art_id, &tau, &y);
      for (var k = 0u; k < ai.w; k++) {
        art[o + DHDR + r * NDA + k] = J[r * NDA + k];
        art[o + DHDR + 3u * NDA + r * NDA + k] = y[k];
      }
      for (var s2 = 0u; s2 < 3u; s2++) {
        var acc = 0.0;
        for (var k = 0u; k < ai.w; k++) { acc += J[s2 * NDA + k] * y[k]; }
        K[s2 * 3u + r] = acc;
      }
    }
    let kscale = max(K[0] + K[4] + K[8], 1e-30);
    var effn = 0.0;
    if (K[0] > 1e-6 * kscale && K[0] > 1e-12) { effn = 1.0 / (K[0] + F_CFM); }
    let k00 = K[4] + 1e-6 * kscale + F_CFM; let k01 = 0.5 * (K[5] + K[7]); let k11 = K[8] + 1e-6 * kscale + F_CFM;
    let det = k00 * k11 - k01 * k01;
    var rhs = 0.0;
    if (phi < 0.0) { rhs = max(P.beta * phi / P.dt, -depen_cap(a, b)); } else { rhs = F_SPEC * phi / P.dt; }
    let e = contacts[c * 5u + 3u].x;
    var bounce = false;
    if (e > 0.0) {
      var vn0 = 0.0;
      for (var k = 0u; k < ai.w; k++) { vn0 += J[k] * art[A_QD + ai.z + k]; }
      bounce = restitution_fires(e, phi, vn0);
      if (bounce) { rhs = e * vn0; }
    }
    var ln = 0.0; var lf = vec3f(0.0);
    var h = key % WH;
    for (var probe = 0u; probe < 32u; probe++) {
      let k = atomicLoad(&warm[rbase + h]);
      if (k == 0u) { break; }
      if (k == key) {
        let vo = 2u * WH + (rbase + h) * 4u;
        ln = bitcast<f32>(atomicLoad(&warm[vo])) * P.warm_scale;
        lf = vec3f(bitcast<f32>(atomicLoad(&warm[vo + 1u])), bitcast<f32>(atomicLoad(&warm[vo + 2u])), bitcast<f32>(atomicLoad(&warm[vo + 3u]))) * P.warm_scale;
        break;
      }
      h = (h + 1u) % WH;
    }
    var lt = vec2f(dot(lf, t1), dot(lf, t2));
    if (length(lt) > mu * ln) { lt *= mu * ln / max(length(lt), 1e-12); }
    art[o] = f32(art_id); art[o + 1u] = f32(key & 0xffffu); art[o + 2u] = f32(key >> 16u); art[o + 3u] = mu;
    art[o + 4u] = rhs; art[o + 5u] = effn;
    art[o + 6u] = k11 / det; art[o + 7u] = -k01 / det; art[o + 8u] = k00 / det;
    art[o + 9u] = ln; art[o + 10u] = lt.x; art[o + 11u] = lt.y;
    st3(o + 12u, t1); st3(o + 15u, t2); st3(o + 18u, n);
    art[o + 21u] = 0.0;
    art[o + 24u] = select(row_weight(phi), 1.0, bounce);
    art[o + 22u] = select(phi, 1e30, bounce);
  }
  // Loop closures (Steel's connect rows): three point rows at the anchors' midpoint, plus two
  // hinge-alignment rows for a revolute closure. A world parent contributes no dofs.
  for (var i = tid; i < NLOOP; i += WG) {
    let L0 = statF[SF_LOOP + i * 5u];
    let pl = i32(L0.x); let cl = u32(L0.y); let art_id = u32(L0.z);
    let revolute = L0.w > 0.5;
    var slot = ndc;
    for (var k = 0u; k < i; k++) { slot += select(1u, 2u, statF[SF_LOOP + k * 5u].w > 0.5); }
    if (slot + select(0u, 1u, revolute) >= MAXDENSE) { continue; }
    var pa = statF[SF_LOOP + i * 5u + 1u].xyz;
    var rp = vec4f(0.0, 0.0, 0.0, 1.0);
    if (pl >= 0) { rp = link_rot(u32(pl)); pa = ld3(lo(u32(pl)) + L_POS) + qrot(rp, pa); }
    let rc = link_rot(cl);
    let pc = ld3(lo(cl) + L_POS) + qrot(rc, statF[SF_LOOP + i * 5u + 2u].xyz);
    let pm = 0.5 * (pa + pc);
    let ai = art_info(art_id);
    var J: array<f32, JDIM>;
    for (var k = 0u; k < JDIM; k++) { J[k] = 0.0; }
    let ex = vec3f(1.0, 0.0, 0.0); let ey = vec3f(0.0, 1.0, 0.0); let ez = vec3f(0.0, 0.0, 1.0);
    add_gen_jac(cl, pm, 1.0, ex, ey, ez, ai.z, &J);
    if (pl >= 0) { add_gen_jac(u32(pl), pm, -1.0, ex, ey, ez, ai.z, &J); }
    put_bilateral(A_DENSE + slot * DPS, art_id, &J, 3u, P.beta * (pc - pa) / P.dt);
    if (revolute) {
      let ap = qrot(rp, statF[SF_LOOP + i * 5u + 3u].xyz);
      let ac = qrot(rc, statF[SF_LOOP + i * 5u + 4u].xyz);
      var e1 = cross(ap, vec3f(1.0, 0.0, 0.0));
      if (dot(e1, e1) < 1e-6) { e1 = cross(ap, vec3f(0.0, 1.0, 0.0)); }
      e1 = normalize(e1);
      let e2 = cross(ap, e1);
      var Ja: array<f32, JDIM>;
      for (var k = 0u; k < JDIM; k++) { Ja[k] = 0.0; }
      add_gen_ang(cl, 1.0, e1, e2, ai.z, &Ja);
      if (pl >= 0) { add_gen_ang(u32(pl), -1.0, e1, e2, ai.z, &Ja); }
      let err = cross(ap, ac);
      put_bilateral(A_DENSE + (slot + 1u) * DPS, art_id, &Ja, 2u, P.beta * vec3f(dot(e1, err), dot(e2, err), 0.0) / P.dt);
    }
  }
  // Mimic rows: qd_follower - c1 * qd_leader, Baumgarte on q_follower - c1 * q_leader - c0.
  for (var i = tid; i < NMIMIC; i += WG) {
    let M0 = statF[SF_MIMIC + i * 2u]; let M1 = statF[SF_MIMIC + i * 2u + 1u];
    let slot = ndc + nloop_rows + i;
    if (slot >= MAXDENSE) { continue; }
    var J: array<f32, JDIM>;
    for (var k = 0u; k < JDIM; k++) { J[k] = 0.0; }
    J[u32(M0.y)] = 1.0; J[u32(M0.z)] -= M0.w;
    let phi = art[A_Q + u32(M1.x)] - M0.w * art[A_Q + u32(M1.y)] - M1.z;
    put_bilateral(A_DENSE + slot * DPS, u32(M0.x), &J, 1u, vec3f(P.beta * phi / P.dt, 0.0, 0.0));
  }

}
`;
}

// ---------------------------------------------------------------------------
// Solve: warm start + colored Gauss-Seidel sweeps over body-disjoint units in one
// workgroup, exact articulation propagation after each sweep, then integration.
export function solveWGSL(C) {
  return (C.SG ? 'enable subgroups;\ndiagnostic(off, subgroup_uniformity);\n' : '') + HEADER(C, ['statF', 'statU', 'poses', 'vel', 'counters', 'sched', 'rows', 'warm', 'art', 'stats']) + BODY + ART + /* wgsl */ `
const WG: u32 = 256u;
var<workgroup> tw: array<vec4f, NBP2>;   // (v, w) per body
var<workgroup> imp: array<vec4f, NBP2>;  // accumulated (f, t) per link body
var<workgroup> aqd: array<f32, NDP>;
var<workgroup> wn: vec2u;
var<workgroup> wcs: array<u32, NCOL + 2u>;

fn skew(r: vec3f) -> mat3x3f {
  return mat3x3f(vec3f(0.0, r.z, -r.y), vec3f(-r.z, 0.0, r.x), vec3f(r.y, -r.x, 0.0));
}

// Mouse spring: a damped point spring, applied as the impulse that gives the grab
// point exactly the spring's velocity change (point effective mass, so light
// bodies grabbed far from their COM stay stable).
fn pick_impulse(b: u32, v: vec3f, w: vec3f) -> array<vec3f, 2> {
  let c = poses[P_BODY + b * 2u].xyz; let q = poses[P_BODY + b * 2u + 1u];
  let R = qmat(q);
  let Iinv = R * body_inv_inertia(i32(b)) * transpose(R);
  let im = body_inv_mass(i32(b));
  let r = qrot(q, P.pick_local.xyz);
  let vp = v + cross(w, r);
  let wn = 2.0 * 3.14159265 * 5.0;
  var dv = (wn * wn * (P.pick_target.xyz - (c + r)) - 2.0 * wn * vp) * P.dt;
  let lim = 60.0 * P.dt;  // at most ~6 g of pull
  if (length(dv) > lim) { dv *= lim / length(dv); }
  let S = skew(r);
  let K = mat3x3f(vec3f(im, 0.0, 0.0), vec3f(0.0, im, 0.0), vec3f(0.0, 0.0, im)) - S * Iinv * S;
  let j = inverse3(K) * dv;
  return array<vec3f, 2>(v + j * im, w + Iinv * cross(r, j));
}

fn inverse3(m: mat3x3f) -> mat3x3f {
  let a = m[0]; let b = m[1]; let c = m[2];
  let r0 = cross(b, c); let r1 = cross(c, a); let r2 = cross(a, b);
  let det = dot(a, r0);
  return transpose(mat3x3f(r0, r1, r2)) * (1.0 / det);
}

// Steel's free rigid body gyroscopic update: energy-preserving Cayley microsteps
// (A - S) w = (A + S) u in the body frame; u carries the external torque.
fn gyroscopic_velocity(inertia: mat3x3f, u0: vec3f, dt: f32) -> vec3f {
  let a = inertia * (1.0 / max(inertia[0][0], max(inertia[1][1], inertia[2][2])));
  let inv = inverse3(a);
  let speed = sqrt(max(dot(u0, a * u0) * (inv[0][0] + inv[1][1] + inv[2][2]), 0.0));
  let n = u32(clamp(ceil(2.0 * abs(dt) * speed), 1.0, 32.0));
  let h = dt / f32(n);
  var w = u0;
  for (var m = 0u; m < n; m++) {
    let u = w;
    let energy = dot(u, a * u);
    for (var it = 0u; it < 8u; it++) {
      let S = (0.5 * h) * skew(a * (0.5 * (u + w)));
      let c = inverse3(a - S) * ((a + S) * u);
      let d = c - w;
      w = c;
      if (dot(d, a * d) <= 1e-12 * energy) { break; }
    }
  }
  return w;
}


// Steel's coupled contact solves (friction_mode bisection, bisection_desaxce, coulomb_newton):
// u = live (normal, t1, t2) velocities, G the 3x3 Delassus block (nn, nt1, nt2 | t1t1, t1t2, t2t2).
fn tangent_step(ut: vec2f, g1: vec4f) -> vec2f {
  let det = g1.x * g1.z - g1.y * g1.y;
  if (abs(det) <= 1e-20) { return vec2f(0.0); }
  return vec2f(-ut.x * g1.z + ut.y * g1.y, ut.x * g1.y - ut.y * g1.x) / det;
}
fn clip_cone(t: vec2f, lim: f32) -> vec2f {
  let m = length(t);
  if (m > lim && m > 1e-20) { return t * (lim / m); }
  return t;
}
// A singular block (a link with fewer than two tangential mobilities) keeps the normal impulse and
// takes the fixed_normal pair on its disk. Rounding leaves a locked tangent a tiny response, so the
// singularity test is relative to the tangent trace.
fn fixed_normal_pair(ut0: vec2f, g1: vec4f, mu: f32, lam: vec3f) -> vec3f {
  return vec3f(lam.x, friction_pair_solve(g1.x, g1.y, g1.z, ut0.x, ut0.y, lam.y, lam.z, max(mu * lam.x, 0.0), 1.0));
}
fn contact_block(mode: u32, un: f32, ut0: vec2f, g0: vec4f, g1: vec4f, vtarget0: f32, mu: f32, lam: vec3f) -> vec3f {
  let gnn = g0.x; let gnt = g0.yz;
  let trace = g1.x + g1.z;
  if (g1.x * g1.z - g1.y * g1.y <= 1e-6 * trace * trace) { return fixed_normal_pair(ut0, g1, mu, lam); }
  if (gnn < 1e-20) { return lam; }
  let lt = lam.yz;
  var vt_n = vtarget0;
  if (mode == 2u) { vt_n += mu * length(ut0); }
  if (mode == 3u) {
    let un_f = un - (gnn * lam.x + dot(gnt, lt));
    let ut_f = ut0 - vec2f(gnt.x * lam.x + g1.x * lt.x + g1.y * lt.y, gnt.y * lam.x + g1.y * lt.x + g1.z * lt.y);
    if (un_f >= vt_n) { return vec3f(0.0); }
    let bN = un_f - vt_n;
    let A00 = g1.x - gnt.x * gnt.x / gnn; let A01 = g1.y - gnt.x * gnt.y / gnn; let A11 = g1.z - gnt.y * gnt.y / gnn;
    if (A00 * A11 - A01 * A01 <= 1e-6 * trace * trace) { return fixed_normal_pair(ut0, g1, mu, lam); }
    let c = ut_f - (bN / gnn) * gnt;
    let id0 = 1.0 / (A00 * A11 - A01 * A01);
    var s = vec2f(A11 * c.x - A01 * c.y, A00 * c.y - A01 * c.x) * id0;
    let phi0 = length(s) - mu * (dot(gnt, s) - bN) / gnn;
    if (phi0 > 0.0) {
      var hi = 1.0;
      for (var e = 0u; e < 30u; e++) {
        let a = A00 + hi; let d = A11 + hi; let idt = 1.0 / (a * d - A01 * A01);
        let sh = vec2f(d * c.x - A01 * c.y, a * c.y - A01 * c.x) * idt;
        if (length(sh) - mu * (dot(gnt, sh) - bN) / gnn < 0.0) { break; }
        hi *= 2.0;
      }
      var lo = 0.0; var x = 0.5 * hi;
      let tol = 1e-6 + 1e-6 * phi0;
      for (var k = 0u; k < 50u; k++) {
        let a = A00 + x; let d = A11 + x; let idt = 1.0 / (a * d - A01 * A01);
        let sx = vec2f(d * c.x - A01 * c.y, a * c.y - A01 * c.x) * idt;
        let tx = vec2f(d * sx.x - A01 * sx.y, a * sx.y - A01 * sx.x) * idt;
        let ns = length(sx);
        let fx = ns - mu * (dot(gnt, sx) - bN) / gnn;
        let dfx = -dot(sx, tx) / ns + mu * dot(gnt, tx) / gnn;
        s = sx;
        if (abs(fx) < tol || abs(hi - lo) < 1e-6 * (1.0 + hi)) { break; }
        if (fx > 0.0) { lo = x; } else { hi = x; }
        var xn = 0.5 * (lo + hi);
        if (dfx != 0.0) { let xt = x - fx / dfx; if (xt > lo && xt < hi) { xn = xt; } }
        x = xn;
      }
    }
    let rt = -s;
    // The finite search can end just below zero load; the exact root is non-negative.
    let ln = max(-(dot(gnt, rt) + bN) / gnn, 0.0);
    // The root search stops within a tolerance and leaves a residual tangent at mu = 0.
    let lim = max(mu * ln, 0.0);
    let m = length(rt);
    return vec3f(ln, select(rt, rt * (lim / m), m > lim));
  }
  // Bisection on the normal impulse with the tangent pair re-solved and clipped at each trial.
  let u0 = un - gnn * lam.x - dot(gnt, lt);
  if (u0 >= vt_n) { return vec3f(0.0); }
  var lo = 0.0;
  var hi = max(max(2.0 * lam.x, (vt_n - un) / gnn + lam.x), 1.0);
  var flo = u0 - vt_n; var fhi = -1.0;
  for (var k = 0u; k < 20u; k++) {
    let mid = 0.5 * (lo + hi);
    let dn = mid - lam.x;
    let tr = clip_cone(lt + tangent_step(ut0 + gnt * dn, g1), mu * mid);
    let u = un + gnn * dn + dot(gnt, tr - lt);
    if (u < vt_n) { lo = mid; flo = u - vt_n; } else { hi = mid; fhi = u - vt_n; }
  }
  var ln = 0.5 * (lo + hi);
  if (fhi >= 0.0) { ln = lo - flo * (hi - lo) / (fhi - flo); }
  let tf = clip_cone(lt + tangent_step(ut0 + gnt * (ln - lam.x), g1), mu * ln);
  return vec3f(ln, tf);
}


// Steel's joint torsional/rolling cone for articulated contacts (PropagationAngularFrictionBlock):
// rows (t1, t2, spin, roll1, roll2) minimize their quadratic over the cone in coefficient-normalized
// impulses y = lambda / mu: the elliptic ball by a More-Sorensen trust region (proximal fallback),
// the pyramidal set by an accelerated projected gradient for the face, then weighted trust regions.
// The answer is relaxed by omega and line-searched from the current impulses moved into the cone.
fn cone_norm(y: array<f32, 5>) -> f32 {
  if (PYRAMID == 1u) { return length(vec2f(y[0], y[1])) + abs(y[2]) + length(vec2f(y[3], y[4])); }
  var s = 0.0;
  for (var k = 0u; k < 5u; k++) { s += y[k] * y[k]; }
  return sqrt(s);
}

// Projection onto the cone; for the pyramid sum_g w_g |y_g| <= load over (t1, t2), (spin), (roll1, roll2).
fn cone_project(y: ptr<function, array<f32, 5>>, w: vec3f, load: f32) {
  if (PYRAMID == 0u) {
    let n = cone_norm(*y);
    if (n > load) { for (var k = 0u; k < 5u; k++) { (*y)[k] *= load / n; } }
    return;
  }
  let nm = vec3f(length(vec2f((*y)[0], (*y)[1])), abs((*y)[2]), length(vec2f((*y)[3], (*y)[4])));
  if (dot(w, nm) <= load) { return; }
  var ord = vec3u(0u, 1u, 2u);
  for (var a = 0u; a < 2u; a++) {
    for (var b = a + 1u; b < 3u; b++) {
      if (nm[ord[b]] * w[ord[a]] > nm[ord[a]] * w[ord[b]]) { let t = ord[a]; ord[a] = ord[b]; ord[b] = t; }
    }
  }
  var theta = 0.0; var lin = 0.0; var quad = 0.0;
  for (var a = 0u; a < 3u; a++) {
    let g = ord[a];
    lin += w[g] * nm[g]; quad += w[g] * w[g];
    theta = max(theta, (lin - load) / quad);
  }
  var total = 0.0;
  for (var g = 0u; g < 3u; g++) {
    let sc = select(0.0, max(nm[g] - theta * w[g], 0.0) / nm[g], nm[g] > 0.0);
    if (g == 0u) { (*y)[0] *= sc; (*y)[1] *= sc; } else if (g == 1u) { (*y)[2] *= sc; } else { (*y)[3] *= sc; (*y)[4] *= sc; }
    total += w[g] * nm[g] * sc;
  }
  if (total > load) { for (var k = 0u; k < 5u; k++) { (*y)[k] *= load / total; } }
}

fn live5(H: array<f32, 25>, act: array<bool, 5>, k: u32) -> bool { return act[k] && H[k * 5u + k] > 0.0; }

// Cholesky of H + alpha I over the live rows; fails when a pivot keeps under 1e-6 of its diagonal.
struct Fac { L: array<f32, 25>, ok: bool };
fn factor5(H: array<f32, 25>, act: array<bool, 5>, alpha: f32) -> Fac {
  var f: Fac;
  f.ok = true;
  for (var k = 0u; k < 5u; k++) {
    for (var l = 0u; l <= k; l++) {
      var v = select(0.0, H[k * 5u + l], live5(H, act, k) && live5(H, act, l));
      if (k == l) { v = select(1.0, v + alpha, live5(H, act, k)); }
      for (var m = 0u; m < l; m++) { v -= f.L[k * 5u + m] * f.L[l * 5u + m]; }
      if (k == l) {
        if (!(v > 1e-6 * select(1.0, H[k * 5u + k] + alpha, live5(H, act, k)))) { f.ok = false; return f; }
        f.L[k * 5u + k] = sqrt(v);
      } else {
        f.L[k * 5u + l] = v / f.L[l * 5u + l];
      }
    }
  }
  return f;
}
fn lower5(L: array<f32, 25>, x0: array<f32, 5>) -> array<f32, 5> {
  var x = x0;
  for (var k = 0u; k < 5u; k++) {
    for (var m = 0u; m < k; m++) { x[k] -= L[k * 5u + m] * x[m]; }
    x[k] /= L[k * 5u + k];
  }
  return x;
}
fn upper5(L: array<f32, 25>, x0: array<f32, 5>) -> array<f32, 5> {
  var x = x0;
  for (var kk = 0u; kk < 5u; kk++) {
    let k = 4u - kk;
    for (var m = k + 1u; m < 5u; m++) { x[k] -= L[m * 5u + k] * x[m]; }
    x[k] /= L[k * 5u + k];
  }
  return x;
}
fn cone_norm2(y: array<f32, 5>) -> f32 {
  var s = 0.0;
  for (var k = 0u; k < 5u; k++) { s += y[k] * y[k]; }
  return sqrt(s);
}

// y = -(H + alpha I)^-1 c with alpha by Newton on 1/|y(alpha)| inside a bracket. ok when it met the
// 1e-5 boundary residual or found an interior minimizer.
struct Ball { y: array<f32, 5>, ok: bool, interior: bool };
fn cholesky_ball(H: array<f32, 25>, c: array<f32, 5>, act: array<bool, 5>, load: f32) -> Ball {
  var r: Ball;
  var b: array<f32, 5>;
  var cn = 0.0;
  for (var k = 0u; k < 5u; k++) { b[k] = select(0.0, c[k], live5(H, act, k)); cn += b[k] * b[k]; r.y[k] = 0.0; }
  cn = sqrt(cn);
  r.interior = !(cn > 0.0);
  r.ok = true;
  if (!(load > 0.0 && cn > 0.0)) { return r; }
  r.ok = false;
  var lo = 0.0; var hi = cn / load; var alpha = 0.0;
  for (var it = 0u; it < 40u; it++) {
    var nx = -1.0;
    let f = factor5(H, act, alpha);
    if (f.ok) {
      var nb: array<f32, 5>;
      for (var k = 0u; k < 5u; k++) { nb[k] = -b[k]; }
      r.y = upper5(f.L, lower5(f.L, nb));
      let n = cone_norm2(r.y);
      if (alpha == 0.0 && n <= load) { r.interior = true; r.ok = true; return r; }
      if (abs(n - load) <= 1e-5 * load) { r.ok = true; break; }
      if (n < load) { hi = alpha; } else { lo = alpha; }
      let w = lower5(f.L, r.y);
      var wn = 0.0;
      for (var k = 0u; k < 5u; k++) { wn += w[k] * w[k]; }
      nx = alpha + n * n / wn * (n - load) / load;
    } else {
      lo = alpha;
    }
    if (hi - lo <= 1e-4 * hi) { break; }
    alpha = select(select(1e-3 * hi, sqrt(lo * hi), lo > 0.0), nx, nx > lo && nx < hi);
  }
  let n = cone_norm2(r.y);
  if (n > load) { for (var k = 0u; k < 5u; k++) { r.y[k] *= load / n; } }
  return r;
}

// Minimize 0.5 y'Hy + c'y over |y| <= load (interior set when the minimizer is inside). When dependent
// rows defeat Cholesky, a proximal term 0.5 rho (y - center/scale)' diag(H) (y - center/scale) with rho
// raised tenfold until the ball solve converges.
fn trust_region(H: array<f32, 25>, c: array<f32, 5>, act: array<bool, 5>, load: f32,
                center: array<f32, 5>, scale: array<f32, 5>) -> Ball {
  let first = cholesky_ball(H, c, act, load);
  if (first.ok) { return first; }
  var ce: array<f32, 5>;
  for (var k = 0u; k < 5u; k++) { ce[k] = select(0.0, center[k] / scale[k], act[k] && scale[k] > 0.0); }
  var rho = 1e-5;
  for (var it = 0u; it < 7u; it++) {
    var K = H; var g: array<f32, 5>;
    for (var k = 0u; k < 5u; k++) {
      let wt = select(0.0, rho * H[k * 5u + k], live5(H, act, k));
      K[k * 5u + k] += wt;
      g[k] = c[k] - wt * ce[k];
    }
    rho *= 10.0;
    let t = cholesky_ball(K, g, act, load);
    if (!t.ok) { continue; }
    var fin = true;
    for (var k = 0u; k < 5u; k++) { fin = fin && abs(t.y[k]) < 3.0e38; }
    if (fin) { return t; }
  }
  return first;
}

// Face of the pyramidal minimizer: accelerated projected gradient from y0 in group-scaled coordinates.
fn pyr_descend(H: array<f32, 25>, c: array<f32, 5>, act: array<bool, 5>, load: f32, y0: array<f32, 5>) -> array<f32, 5> {
  var s: array<f32, 5>; var w = vec3f(1.0);
  for (var g = 0u; g < 3u; g++) {
    let f = select(select(3u, 2u, g == 1u), 0u, g == 0u); let n = select(2u, 1u, g == 1u);
    var cv = 0.0;
    for (var k = f; k < f + n; k++) { cv = max(cv, select(0.0, H[k * 5u + k], act[k])); }
    let sc = select(1.0, sqrt(cv), cv > 0.0);
    w[g] = 1.0 / sc;
    for (var k = f; k < f + n; k++) { s[k] = sc; }
  }
  var Hu: array<f32, 25>; var cu: array<f32, 5>; var u: array<f32, 5>; var z: array<f32, 5>;
  var lip = 0.0;
  for (var k = 0u; k < 5u; k++) {
    var rs = 0.0;
    for (var l = 0u; l < 5u; l++) { Hu[k * 5u + l] = H[k * 5u + l] / (s[k] * s[l]); rs += abs(Hu[k * 5u + l]); }
    lip = max(lip, select(0.0, rs, act[k]));
    cu[k] = c[k] / s[k]; u[k] = y0[k] * s[k];
  }
  cone_project(&u, w, load);
  z = u;
  var mom = 1.0;
  for (var it = 0u; it < 64u && lip > 0.0; it++) {
    var nx: array<f32, 5>;
    for (var k = 0u; k < 5u; k++) {
      var gr = cu[k];
      for (var l = 0u; l < 5u; l++) { gr += Hu[k * 5u + l] * z[l]; }
      nx[k] = select(0.0, z[k] - gr / lip, act[k]);
    }
    cone_project(&nx, w, load);
    let r0 = length(vec2f(nx[0] - z[0], nx[1] - z[1])) * w[0];
    let r1 = abs(nx[2] - z[2]) * w[1];
    let r2 = length(vec2f(nx[3] - z[3], nx[4] - z[4])) * w[2];
    let res = max(r0, max(r1, r2));
    var asc = 0.0;
    for (var k = 0u; k < 5u; k++) { asc += (z[k] - nx[k]) * (nx[k] - u[k]); }
    if (asc > 0.0) { mom = 1.0; }
    let nm = 0.5 * (1.0 + sqrt(1.0 + 4.0 * mom * mom));
    let bl = (mom - 1.0) / nm;
    for (var k = 0u; k < 5u; k++) { z[k] = nx[k] + bl * (nx[k] - u[k]); u[k] = nx[k]; }
    mom = nm;
    if (res <= 1e-5 * load) { break; }
  }
  var y: array<f32, 5>;
  for (var k = 0u; k < 5u; k++) { y[k] = u[k] / s[k]; }
  return y;
}

// One block visit: H0, g0 the rows' response and current velocity residual, mu the row coefficients,
// lam the current impulses, load the normal impulse. Returns the new impulses.
fn ell_block(H0: array<f32, 25>, g0: array<f32, 5>, mu_in: array<f32, 5>, lam: array<f32, 5>, load_in: f32) -> array<f32, 5> {
  let load = max(load_in, 0.0);
  var mu: array<f32, 5>;
  var H = H0; var gr = g0;
  var big = 0.0;
  for (var k = 0u; k < 5u; k++) { mu[k] = max(mu_in[k], 0.0); big = max(big, H[k * 5u + k]); }
  var act: array<bool, 5>; var comp: array<f32, 5>;
  for (var k = 0u; k < 5u; k++) {
    act[k] = mu[k] > 0.0 && H[k * 5u + k] > 1e-12 * big;
    comp[k] = select(0.0, F_CREEP / (mu[k] * mu[k] * load), k >= 2u && act[k] && load > 0.0);
    H[k * 5u + k] += comp[k]; gr[k] += comp[k] * lam[k];
  }
  var y0: array<f32, 5>; var c: array<f32, 5>; var y: array<f32, 5>;
  for (var k = 0u; k < 5u; k++) {
    y0[k] = select(0.0, lam[k] / mu[k], act[k]);
    gr[k] = select(0.0, gr[k] * mu[k], act[k]);
    for (var l = 0u; l < 5u; l++) { H[k * 5u + l] *= mu[k] * mu[l]; }
  }
  for (var k = 0u; k < 5u; k++) {
    var v = gr[k];
    for (var l = 0u; l < 5u; l++) { v -= H[k * 5u + l] * y0[l]; }
    c[k] = select(0.0, v, act[k]);
  }
  let tr = trust_region(H, c, act, load, lam, mu_in);
  y = tr.y;
  let stick = tr.interior && cone_norm(y) <= load;
  if (!stick) {
    if (PYRAMID == 1u) {
      // On the face, sum_g |y_g| <= load is sum_g |y_g|^2 / t_g <= load^2 at t_g = |y_g| / sum |y|;
      // alternating the weighted trust region with that t converges to the optimum.
      y = pyr_descend(H, c, act, load, y0);
      for (var it = 0u; it < 8u; it++) {
        let nm = vec3f(length(vec2f(y[0], y[1])), abs(y[2]), length(vec2f(y[3], y[4])));
        let tot = nm.x + nm.y + nm.z;
        if (!(tot > 0.0)) { break; }
        let rg = sqrt(nm / tot);
        let r = array<f32, 5>(rg.x, rg.x, rg.y, rg.z, rg.z);
        var cr: array<f32, 5>; var Hu: array<f32, 25>;
        for (var k = 0u; k < 5u; k++) { cr[k] = r[k] * c[k]; for (var l = 0u; l < 5u; l++) { Hu[k * 5u + l] = r[k] * r[l] * H[k * 5u + l]; } }
        y = trust_region(Hu, cr, act, load, y, r).y;
        for (var k = 0u; k < 5u; k++) { y[k] *= r[k]; }
      }
    }
    cone_project(&y, vec3f(1.0), load);
  }
  // Relax by omega, then line-search from the current impulses moved into the cone.
  var stp: array<f32, 5>; var shift: array<f32, 5>;
  for (var k = 0u; k < 5u; k++) { stp[k] = lam[k] + F_OMEGA * (mu[k] * y[k] - lam[k]); }
  if (F_OMEGA != 1.0) {
    for (var k = 0u; k < 5u; k++) { y[k] = select(0.0, stp[k] / mu_in[k], act[k]); }
    cone_project(&y, vec3f(1.0), load);
    for (var k = 0u; k < 5u; k++) { stp[k] = mu[k] * y[k]; }
  }
  for (var k = 0u; k < 5u; k++) { y[k] = select(0.0, lam[k] / mu_in[k], act[k]); }
  cone_project(&y, vec3f(1.0), load);
  for (var k = 0u; k < 5u; k++) { let b = mu[k] * y[k]; shift[k] = b - lam[k]; stp[k] -= b; }
  var slope = 0.0; var curv = 0.0;
  for (var k = 0u; k < 5u; k++) {
    var hs = 0.0; var hp = 0.0;
    for (var l = 0u; l < 5u; l++) { hs += H0[k * 5u + l] * shift[l]; hp += H0[k * 5u + l] * stp[l]; }
    slope += stp[k] * (g0[k] + hs + comp[k] * (lam[k] + shift[k]));
    curv += stp[k] * (hp + comp[k] * stp[k]);
  }
  let t = select(0.0, select(1.0, -slope / curv, curv > -slope), slope < 0.0);
  var out: array<f32, 5>;
  for (var k = 0u; k < 5u; k++) { out[k] = lam[k] + shift[k] + select(0.0, t * stp[k], t > 0.0); }
  return out;
}

var<private> vpass: bool;  // velocity pass: rows without position bias or regularization

fn snap_tw(b: i32) -> array<vec3f, 2> {
  if (b < 0) { return array<vec3f, 2>(vec3f(0.0), vec3f(0.0)); }
  let o = A_SNAP + u32(b) * 8u;
  return array<vec3f, 2>(ld3(o), ld3(o + 4u));
}

fn load_tw(b: i32) -> array<vec3f, 2> {
  if (b < 0) { return array<vec3f, 2>(vec3f(0.0), vec3f(0.0)); }
  return array<vec3f, 2>(tw[u32(b) * 2u].xyz, tw[u32(b) * 2u + 1u].xyz);
}

fn add_imp(b: i32, f: vec3f, t: vec3f) {
  if (b < 0) { return; }
  if (body_kind(b) != 2u) { return; }
  imp[u32(b) * 2u] += vec4f(f, 0.0);
  imp[u32(b) * 2u + 1u] += vec4f(t, 0.0);
}

// Steel's friction pair update on its 2x2 block [a c; c d] with residuals r and disk radius: the
// sticking step, else the disk-constrained minimizer (trust region in the scaled eigenbasis, not a
// radial clip, so an anisotropic pair keeps maximum dissipation), relaxed by omega and projected
// back onto the disk.
fn friction_pair_solve(a0: f32, c0: f32, d0: f32, r0: f32, r1: f32, old0: f32, old1: f32, radius: f32, omega: f32) -> vec2f {
  if (radius <= 0.0) { return vec2f(0.0); }
  let scale = max(max(a0, d0), 1e-20);
  let a = a0 / scale; let c = c0 / scale; let d = d0 / scale;
  let largest = 0.5 * (a + d + sqrt((a - d) * (a - d) + 4.0 * c * c));
  let smallest = select(0.0, max((a * d - c * c) / largest, 0.0), largest > 0.0);
  var vx = c; var vy = largest - a;
  if (a >= d) { vx = largest - d; vy = c; }
  let vn = sqrt(vx * vx + vy * vy);
  if (vn > 0.0) { vx /= vn; vy /= vn; } else { vx = 1.0; vy = 0.0; }
  let r0r = (vx * r0 + vy * r1) / scale;
  let r1r = (-vy * r0 + vx * r1) / scale;
  var res = vec2f(old0, old1);
  var sticking = false;
  if (largest > 0.0 && (smallest > 0.0 || r1r == 0.0)) {
    let dx = r0r / largest;
    let dy = select(0.0, r1r / smallest, smallest > 0.0);
    res = vec2f(old0 - (vx * dx - vy * dy), old1 - (vy * dx + vx * dy));
    sticking = length(res) <= radius;
  }
  if (!sticking) {
    let on = length(vec2f(old0, old1)); let rn = length(vec2f(r0, r1));
    if (on > 0.0 && on <= radius && radius - on <= 2e-7 * radius && r0 * old0 + r1 * old1 <= 0.0
        && abs(r0 * old1 - r1 * old0) <= 2e-7 * on * rn) {
      return vec2f(old0, old1);
    }
    let ox = vx * old0 + vy * old1; let oy = -vy * old0 + vx * old1;
    let b0 = largest * ox - r0r; let b1 = smallest * oy - r1r;
    var x = 0.0; var y = 0.0;
    var hi = sqrt(b0 * b0 + b1 * b1) / radius;
    if (hi > 0.0) {
      var lo = max(max(hi - largest, abs(b1) / radius - smallest), 0.0);
      var alpha = lo;
      var done = false;
      for (var it = 0u; it < 8u; it++) {
        let i0 = 1.0 / (largest + alpha);
        let i1 = select(0.0, 1.0 / (smallest + alpha), smallest + alpha > 0.0);
        let tx = ox - (r0r + alpha * ox) * i0; let ty = oy - (r1r + alpha * oy) * i1;
        let nrm = sqrt(tx * tx + ty * ty);
        if (abs(nrm - radius) <= 2e-7 * radius || (alpha == 0.0 && nrm <= radius)) { x = tx; y = ty; done = true; break; }
        if (nrm > radius) { lo = alpha; } else { hi = alpha; }
        let slope = tx * tx * i0 + ty * ty * i1;
        var cand = alpha;
        if (slope > 0.0) { cand = alpha + (nrm / radius - 1.0) * nrm * nrm / slope; }
        alpha = select(0.5 * (lo + hi), cand, cand > lo && cand < hi);
      }
      if (!done) {
        for (var it = 0u; it < 24u; it++) {
          alpha = 0.5 * (lo + hi);
          if (length(vec2f(b0 / (largest + alpha), b1 / (smallest + alpha))) > radius) { lo = alpha; } else { hi = alpha; }
        }
        x = b0 / (largest + hi); y = b1 / (smallest + hi);
      }
    }
    res = vec2f(old0 + vx * (x - ox) - vy * (y - oy), old1 + vy * (x - ox) + vx * (y - oy));
  }
  let relaxed = vec2f(old0, old1) + omega * (res - vec2f(old0, old1));
  let m = length(relaxed);
  return select(relaxed, relaxed * (radius / m), m > radius);
}

// mode 0: apply warm impulses only; mode 1: solve.
// One contact point (row) of body-pair unit us.
// Per-unit sum of the patch rows' normal impulses (the friction anchors' pooled load). A unit's rows
// share both bodies, so they never run concurrently and plain updates suffice.
fn unit_load(us: u32) -> f32 { return art[A_ULOAD + us]; }
fn add_unit_load(us: u32, d: f32) { art[A_ULOAD + us] += d; }
fn sum_unit_loads(tid: u32, nu: u32) {
  for (var us = tid; us < nu; us += WG) {
    let s0 = atomicLoad(&sched[S_USTART + us]);
    var load = 0.0;
    for (var m = s0; m < s0 + atomicLoad(&sched[S_USIZE + us]); m++) { if (rows[m * ROWS + PO].w != 1.0) { load += rows[m * ROWS + 6u].x; } }
    art[A_ULOAD + us] = load;
  }
}

fn solve_slot(u: u32, mode: u32, it: u32) {
  let sl = rows[MAXC * ROWS + 2u * u]; let sr = rows[MAXC * ROWS + 2u * u + 1u];
  solve_unit(u32(sl.y), u32(sl.x), i32(sl.z), i32(sl.w), u32(sr.x), u32(sr.y), mode, it);
}

fn solve_unit(us: u32, row: u32, a: i32, b: i32, s0: u32, s1: u32, mode: u32, it: u32) {
  var ta = load_tw(a); var tb = load_tw(b);
  let art_u = (a >= 0 && body_kind(a) >= 2u) || (b >= 0 && body_kind(b) >= 2u);
  for (var i = row; i < row + 1u; i++) {
    let o = i * ROWS;
    let r0 = rows[o]; let r1 = rows[o + 1u]; let r2 = rows[o + 2u];
    let ra = rows[o + 3u].xyz; let rb = rows[o + 4u].xyz;
    let n = r0.xyz; let t1 = r1.xyz; let t2 = r2.xyz;
    var lam = rows[o + 6u];
    var dn = 0.0; var dt1 = 0.0; var dt2 = 0.0;
    if (mode == 0u) {
      dn = lam.x; dt1 = lam.y; dt2 = lam.z;
    } else {
      let vrel = (tb[0] + cross(tb[1], rb)) - (ta[0] + cross(ta[1], ra));
      let jv = dot(n, vrel);
      let w = select(rows[o + 5u].w, 1.0, vpass);
      var res = jv + r1.w;
      if (COMPL == 1u) { res += rows[o + CO].x * lam.x; }
      let nl = max(lam.x + F_OMEGA * (-res * r0.w * w - (1.0 - w) * lam.x), 0.0);
      dn = nl - lam.x;
      lam.x = nl;
      // Apply the normal change before friction.
      ta[0] += rows[o + 7u].xyz * dn; ta[1] += rows[o + 8u].xyz * dn;
      tb[0] += rows[o + 9u].xyz * dn; tb[1] += rows[o + 10u].xyz * dn;
      add_imp(a, -n * dn, -cross(ra, n * dn));
      add_imp(b, n * dn, cross(rb, n * dn));
      lam.x = nl;
      // Friction: at the contact, or at a patch anchor with the region's pooled load and its
      // displacement bias; region members without an anchor carry none.
      var fra = ra; var frb = rb; var lim = r2.w * nl; var bias = vec2f(0.0);
      var role = 1.0;
      var pooled = nl;
      if (EXTRA == 1u) {
        role = rows[o + PO].w;
        if (PATCH == 1u && role != 1.0) { add_unit_load(us, dn); }
        fra = rows[o + PO].xyz; frb = rows[o + PO + 1u].xyz;
        if (PATCH == 1u && role == 2.0) {
          let load = unit_load(us);
          lim = r2.w * load;
          pooled = load;
          let e = rows[o + PO + 2u].xyz;
          bias = select(F_ANCHOR_BETA * vec2f(dot(t1, e), dot(t2, e)) / P.dt, vec2f(0.0), vpass);
          rows[o + PO + 2u].w = lim;
        }
      }
      // contact_friction_position_iterations: friction starts at iteration FSTART.
      if (it < FSTART) { lam.y = 0.0; lam.z = 0.0; }
      let ell = ANG_ART == 1u && ANG == 1u && art_u && (rows[o + 19u].x > 0.0 || rows[o + 19u].y > 0.0);
      if (FMODE > 0u && it >= FSTART) {
        // Coupled (normal, t1, t2) re-solve; overwrites all three impulses.
        let vn = (tb[0] + cross(tb[1], rb)) - (ta[0] + cross(ta[1], ra));
        let vt = (tb[0] + cross(tb[1], frb)) - (ta[0] + cross(ta[1], fra));
        let nlam = contact_block(FMODE, dot(n, vn), vec2f(dot(t1, vt), dot(t2, vt)), rows[o + FMO], rows[o + FMO + 1u], -r1.w, r2.w, lam.xyz);
        let d = nlam - lam.xyz;
        if (PATCH == 1u && role != 1.0) { add_unit_load(us, d.x); }
        ta[0] += rows[o + 7u].xyz * d.x + rows[o + 11u].xyz * d.y + rows[o + 15u].xyz * d.z;
        ta[1] += rows[o + 8u].xyz * d.x + rows[o + 12u].xyz * d.y + rows[o + 16u].xyz * d.z;
        tb[0] += rows[o + 9u].xyz * d.x + rows[o + 13u].xyz * d.y + rows[o + 17u].xyz * d.z;
        tb[1] += rows[o + 10u].xyz * d.x + rows[o + 14u].xyz * d.y + rows[o + 18u].xyz * d.z;
        let fn_ = n * d.x; let ft = t1 * d.y + t2 * d.z;
        add_imp(a, -fn_ - ft, -cross(ra, fn_) - cross(fra, ft));
        add_imp(b, fn_ + ft, cross(rb, fn_) + cross(frb, ft));
        lam = vec4f(nlam, lam.w);
      } else if (role != 0.0 && it >= FSTART) {
        let vr2 = (tb[0] + cross(tb[1], frb)) - (ta[0] + cross(ta[1], fra));
        let ki = rows[o + 5u];
        let v1 = dot(t1, vr2) + bias.x; let v2 = dot(t2, vr2) + bias.y;
        let kd = ki.x * ki.z - ki.y * ki.y;
        let lt = friction_pair_solve(ki.z / kd, -ki.y / kd, ki.x / kd, v1, v2, lam.y, lam.z, lim, F_OMEGA);
        dt1 = lt.x - lam.y; dt2 = lt.y - lam.z;
        lam.y = lt.x; lam.z = lt.y;
        ta[0] += rows[o + 11u].xyz * dt1 + rows[o + 15u].xyz * dt2;
        ta[1] += rows[o + 12u].xyz * dt1 + rows[o + 16u].xyz * dt2;
        tb[0] += rows[o + 13u].xyz * dt1 + rows[o + 17u].xyz * dt2;
        tb[1] += rows[o + 14u].xyz * dt1 + rows[o + 18u].xyz * dt2;
        let f = t1 * dt1 + t2 * dt2;
        add_imp(a, -f, -cross(fra, f));
        add_imp(b, f, cross(frb, f));
      }
      if (ell && it >= FSTART) {
        // Articulated torsional/rolling: after the sliding pair, Steel's block over sliding, spin and rolling.
        var H: array<f32, 25>;
        var idx = 0u;
        for (var x = 0u; x < 5u; x++) {
          for (var y2 = x; y2 < 5u; y2++) {
            let hv_ = rows[o + EO + idx / 4u][idx % 4u];
            H[x * 5u + y2] = hv_; H[y2 * 5u + x] = hv_;
            idx++;
          }
        }
        let vt = (tb[0] + cross(tb[1], frb)) - (ta[0] + cross(ta[1], fra));
        let wr = tb[1] - ta[1];
        let la0 = rows[o + 21u];
        let g = array<f32, 5>(dot(t1, vt), dot(t2, vt), dot(n, wr), dot(t1, wr), dot(t2, wr));
        let mu5 = array<f32, 5>(r2.w, r2.w, rows[o + 19u].x, rows[o + 19u].y, rows[o + 19u].y);
        let l5 = array<f32, 5>(lam.y, lam.z, la0.x, la0.y, la0.z);
        let nl5 = ell_block(H, g, mu5, l5, pooled);
        var d: array<f32, 5>;
        for (var k = 0u; k < 5u; k++) { d[k] = nl5[k] - l5[k]; }
        ta[0] += rows[o + 11u].xyz * d[0] + rows[o + 15u].xyz * d[1] + rows[o + 22u].xyz * d[2] + rows[o + 26u].xyz * d[3] + rows[o + 30u].xyz * d[4];
        ta[1] += rows[o + 12u].xyz * d[0] + rows[o + 16u].xyz * d[1] + rows[o + 23u].xyz * d[2] + rows[o + 27u].xyz * d[3] + rows[o + 31u].xyz * d[4];
        tb[0] += rows[o + 13u].xyz * d[0] + rows[o + 17u].xyz * d[1] + rows[o + 24u].xyz * d[2] + rows[o + 28u].xyz * d[3] + rows[o + 32u].xyz * d[4];
        tb[1] += rows[o + 14u].xyz * d[0] + rows[o + 18u].xyz * d[1] + rows[o + 25u].xyz * d[2] + rows[o + 29u].xyz * d[3] + rows[o + 33u].xyz * d[4];
        let f = t1 * d[0] + t2 * d[1];
        let tq = n * d[2] + t1 * d[3] + t2 * d[4];
        add_imp(a, -f, -cross(fra, f) - tq);
        add_imp(b, f, cross(frb, f) + tq);
        lam.y = nl5[0]; lam.z = nl5[1];
        rows[o + 21u] = vec4f(nl5[2], nl5[3], nl5[4], 0.0);
      }
      rows[o + 6u] = lam;
      if (ANG == 1u) {
        // Spin within mu_t * N, rolling within a disk of mu_r * N; under friction patches only the
        // region's first anchor carries them, with the pooled load.
        let g = rows[o + 19u];
        let aon = !ell && (PATCH == 0u || role == 1.0 || (role == 2.0 && rows[o + PO + 1u].w == 0.0));
        let nl = pooled;
        if (aon && (g.x > 0.0 || g.y > 0.0)) {
          var la = rows[o + 21u];
          let wrel = tb[1] - ta[1];
          let ns = clamp(la.x - dot(n, wrel) * g.z, -g.x * nl, g.x * nl);
          let ds = ns - la.x;
          ta[0] += rows[o + 22u].xyz * ds; ta[1] += rows[o + 23u].xyz * ds;
          tb[0] += rows[o + 24u].xyz * ds; tb[1] += rows[o + 25u].xyz * ds;
          let w2 = tb[1] - ta[1];
          let ri = rows[o + 20u];
          let u1 = dot(t1, w2); let u2 = dot(t2, w2);
          var lr = vec2f(la.y, la.z) - vec2f(ri.x * u1 + ri.y * u2, ri.y * u1 + ri.z * u2);
          let rl = g.y * nl;
          if (length(lr) > rl) { lr *= rl / max(length(lr), 1e-12); }
          let d1 = lr.x - la.y; let d2 = lr.y - la.z;
          ta[0] += rows[o + 26u].xyz * d1 + rows[o + 30u].xyz * d2; ta[1] += rows[o + 27u].xyz * d1 + rows[o + 31u].xyz * d2;
          tb[0] += rows[o + 28u].xyz * d1 + rows[o + 32u].xyz * d2; tb[1] += rows[o + 29u].xyz * d1 + rows[o + 33u].xyz * d2;
          rows[o + 21u] = vec4f(ns, lr, 0.0);
          let tq = n * ds + t1 * d1 + t2 * d2;
          add_imp(a, vec3f(0.0), -tq);
          add_imp(b, vec3f(0.0), tq);
        }
      }
      continue;
    }
    for (var r = 0u; r < 3u; r++) {
      let d = select(select(dt2, dt1, r == 1u), dn, r == 0u);
      ta[0] += rows[o + 7u + r * 4u].xyz * d; ta[1] += rows[o + 8u + r * 4u].xyz * d;
      tb[0] += rows[o + 9u + r * 4u].xyz * d; tb[1] += rows[o + 10u + r * 4u].xyz * d;
    }
    var fra = ra; var frb = rb;
    if (EXTRA == 1u) { fra = rows[o + PO].xyz; frb = rows[o + PO + 1u].xyz; }
    let fn_ = n * dn; let ft = t1 * dt1 + t2 * dt2;
    add_imp(a, -fn_ - ft, -cross(ra, fn_) - cross(fra, ft));
    add_imp(b, fn_ + ft, cross(rb, fn_) + cross(frb, ft));
  }
  if (TORS == 1u && mode == 1u && row == atomicLoad(&sched[S_UTP + us]) && rows[s0 * ROWS + TO].w > 0.0) {
    // Contact torsion: sliding and spin share the group's Coulomb budget mu * N.
    let L = s0 * ROWS;
    let mu = rows[L + TO].w;
    var load = 0.0; var slide = 0.0;
    for (var m = s0; m < s1; m++) {
      let om = m * ROWS;
      if (rows[om + TO + 4u].w < 0.5) { continue; }
      let lm = rows[om + 6u];
      load += max(lm.x, 0.0);
      if (EXTRA == 0u || rows[om + PO].w != 0.0) { slide += length(lm.yz); }
    }
    let budget = mu * load;
    if (slide > budget && slide > 0.0) {
      // Later normals lowered the load: project the members' tangent pairs onto it.
      let scale = budget / slide;
      for (var m = s0; m < s1; m++) {
        let om = m * ROWS;
        if (rows[om + TO + 4u].w < 0.5 || (EXTRA == 1u && rows[om + PO].w == 0.0)) { continue; }
        let lm = rows[om + 6u];
        let d1 = lm.y * (scale - 1.0); let d2 = lm.z * (scale - 1.0);
        ta[0] += rows[om + 11u].xyz * d1 + rows[om + 15u].xyz * d2; ta[1] += rows[om + 12u].xyz * d1 + rows[om + 16u].xyz * d2;
        tb[0] += rows[om + 13u].xyz * d1 + rows[om + 17u].xyz * d2; tb[1] += rows[om + 14u].xyz * d1 + rows[om + 18u].xyz * d2;
        var fa = rows[om + 3u].xyz; var fb = rows[om + 4u].xyz;
        if (EXTRA == 1u) { fa = rows[om + PO].xyz; fb = rows[om + PO + 1u].xyz; }
        let f = rows[om + 1u].xyz * d1 + rows[om + 2u].xyz * d2;
        add_imp(a, -f, -cross(fa, f)); add_imp(b, f, cross(fb, f));
        rows[om + 6u] = vec4f(lm.x, lm.y * scale, lm.z * scale, lm.w);
      }
      slide = budget;
    }
    var bound = rows[L + TO + 3u].w * max(budget - slide, 0.0);
    if (it < FSTART) { bound = 0.0; }
    let ng = rows[L + TO + 4u].xyz;
    let ls = rows[L + TO + 2u].w;
    let nls = clamp(ls - F_OMEGA * dot(ng, tb[1] - ta[1]) * rows[L + TO + 1u].w, -bound, bound);
    let ds = nls - ls;
    if (ds != 0.0) {
      ta[0] += rows[L + TO].xyz * ds; ta[1] += rows[L + TO + 1u].xyz * ds;
      tb[0] += rows[L + TO + 2u].xyz * ds; tb[1] += rows[L + TO + 3u].xyz * ds;
      rows[L + TO + 2u].w = nls;
      add_imp(a, vec3f(0.0), -ng * ds); add_imp(b, vec3f(0.0), ng * ds);
    }
  }
  if (a >= 0) { tw[u32(a) * 2u] = vec4f(ta[0], 0.0); tw[u32(a) * 2u + 1u] = vec4f(ta[1], 0.0); }
  if (b >= 0) { tw[u32(b) * 2u] = vec4f(tb[0], 0.0); tw[u32(b) * 2u + 1u] = vec4f(tb[1], 0.0); }
}

fn set_link_twist(l: u32, v: SV) {
  let b = u32(link_body(l));
  tw[b * 2u] = vec4f(v.l, 0.0);
  tw[b * 2u + 1u] = vec4f(v.a, 0.0);
}

// Link spatial velocities and COM twists from aqd.
fn art_twists(a: u32) {
  let ai = art_info(a);
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k;
    let par = link_parent(l);
    var v = sv0();
    if (par >= 0) { v = mshift(ldsv(lo(u32(par)) + L_V), link_r(l)); }
    for (var r = 0u; r < link_ndof(l); r++) { v = sadd(v, sscale(ldS(l, r), aqd[link_dof(l) + r])); }
    stsv(lo(l) + L_V, v);
    set_link_twist(l, v);
  }
}

// Spatial impulses in L_P and generalized impulses in L_TAU -> aqd and link twists (both cleared).
fn art_apply(a: u32) {
  let ai = art_info(a);
  for (var kk = 0u; kk < ai.y; kk++) {
    let l = ai.x + ai.y - 1u - kk; let L = lo(l);
    let n = link_ndof(l);
    let p = ldsv(L + L_P);
    var u: array<f32, 6>;
    for (var r = 0u; r < n; r++) {
      u[r] = art[L + L_TAU + r] - sdot(ldS(l, r), p);
      art[L + L_UU + r] = u[r];
    }
    let par = link_parent(l);
    if (par >= 0) {
      var pp = p;
      for (var r = 0u; r < n; r++) {
        var du = 0.0;
        for (var c = 0u; c < n; c++) { du += ldDI(l, r, c) * u[c]; }
        pp = sadd(pp, sscale(ldU(l, r), du));
      }
      let P0 = lo(u32(par)) + L_P;
      stsv(P0, sadd(ldsv(P0), fshift(pp, link_r(l))));
    }
  }
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k; let L = lo(l);
    let par = link_parent(l);
    var dv = sv0();
    if (par >= 0) { dv = mshift(ldsv(lo(u32(par)) + L_DV), link_r(l)); }
    let n = link_ndof(l);
    var dq: array<f32, 6>;
    for (var r = 0u; r < n; r++) {
      dq[r] = 0.0;
      for (var c = 0u; c < n; c++) { dq[r] += ldDI(l, r, c) * (art[L + L_UU + c] - sdot(ldU(l, c), dv)); }
    }
    for (var r = 0u; r < n; r++) {
      dv = sadd(dv, sscale(ldS(l, r), dq[r]));
      aqd[link_dof(l) + r] += dq[r];
    }
    stsv(L + L_DV, dv);
    let v = sadd(ldsv(L + L_V), dv);
    stsv(L + L_V, v);
    set_link_twist(l, v);
    stsv(L + L_P, sv0());
    for (var r = 0u; r < JM; r++) { art[L + L_TAU + r] = 0.0; }
  }
}

// Dense same-articulation rows: exact Gauss-Seidel on qd (mode 0 applies warm impulses),
// one 32-lane subgroup per articulation; lane k owns dofs k, k+32, ... so lanes never
// touch each other's aqd entries.
// Without subgroups lane 0 runs the articulation's rows alone (k0 0, stride 1); other lanes return.
fn lane_sum(x: f32) -> f32 { return ${C.SG ? 'subgroupAdd(x)' : 'x'}; }
fn art_dense(a: u32, mode: u32, lane: u32, it: u32, ph: u32) -> bool {
  if (SG == 0u && lane != 0u) { return false; }
  let k0 = select(0u, lane, SG == 1u); let ks = select(1u, 32u, SG == 1u);
  let nd = min(atomicLoad(&sched[S_META + 3u]), MAXDENSE);
  let ai = art_info(a);
  var touched = false;
  for (var i = 0u; i < nd; i++) {
    let o = A_DENSE + i * DPS;
    if (u32(art[o]) != a) { continue; }
    touched = true;
    let jo = o + DHDR; let yo = o + DHDR + 3u * NDA;
    let lam = vec3f(art[o + 9u], art[o + 10u], art[o + 11u]);
    if ((art[o + 21u] > 0.5) == (ph == 1u) && ph != 0u) { continue; }
    if (art[o + 21u] > 0.5) {
      // Bilateral rows (loop closures, mimics): unclamped, one at a time.
      if (mode == 0u) { continue; }
      var nlam = lam;
      for (var r = 0u; r < u32(art[o + 21u]); r++) {
        var part = 0.0;
        for (var k = k0; k < ai.w; k += ks) { part += art[jo + r * NDA + k] * aqd[ai.z + k]; }
        let jv = lane_sum(part);
        let rhs = select(select(select(art[o + 23u], art[o + 22u], r == 1u), art[o + 4u], r == 0u), 0.0, vpass);
        let dl = -F_OMEGA * (jv + rhs) * art[o + 5u + r];
        nlam[r] += dl;
        for (var k = k0; k < ai.w; k += ks) { aqd[ai.z + k] += art[yo + r * NDA + k] * dl; }
      }
      if (lane == 0u) { art[o + 9u] = nlam.x; art[o + 10u] = nlam.y; art[o + 11u] = nlam.z; }
      continue;
    }
    if (mode == 0u) {
      for (var k = k0; k < ai.w; k += ks) {
        aqd[ai.z + k] += art[yo + k] * lam.x + art[yo + NDA + k] * lam.y + art[yo + 2u * NDA + k] * lam.z;
      }
      continue;
    }
    var part = 0.0;
    for (var k = k0; k < ai.w; k += ks) { part += art[jo + k] * aqd[ai.z + k]; }
    let jv = lane_sum(part);
    let w = select(art[o + 24u], 1.0, vpass);
    let nl = max(lam.x + F_OMEGA * (-(jv + art[o + 4u]) * art[o + 5u] * w - (1.0 - w) * lam.x), 0.0);
    let dn = nl - lam.x;
    var p1 = 0.0; var p2 = 0.0;
    for (var k = k0; k < ai.w; k += ks) {
      aqd[ai.z + k] += art[yo + k] * dn;
      p1 += art[jo + NDA + k] * aqd[ai.z + k];
      p2 += art[jo + 2u * NDA + k] * aqd[ai.z + k];
    }
    let v1 = lane_sum(p1); let v2 = lane_sum(p2);
    let lim = select(art[o + 3u] * nl, 0.0, it < FSTART);
    let kd = art[o + 6u] * art[o + 8u] - art[o + 7u] * art[o + 7u];
    let lt = friction_pair_solve(art[o + 8u] / kd, -art[o + 7u] / kd, art[o + 6u] / kd, v1, v2, lam.y, lam.z, lim, F_OMEGA);
    let d1 = lt.x - lam.y; let d2 = lt.y - lam.z;
    for (var k = k0; k < ai.w; k += ks) {
      aqd[ai.z + k] += art[yo + NDA + k] * d1 + art[yo + 2u * NDA + k] * d2;
    }
    if (lane == 0u) { art[o + 9u] = nl; art[o + 10u] = lt.x; art[o + 11u] = lt.y; }
  }
  return touched;
}

// Dense rows for every articulation (one subgroup each), then twists of the articulations they moved.
// Eight 32-lane subgroups take the articulations in rounds.
fn dense_phase(tid: u32, mode: u32, it: u32, ph: u32) {
  for (var base = 0u; base < NA; base += WG / 32u) {
    let a = base + tid / 32u;
    var touched = false;
    if (a < NA) { touched = art_dense(a, mode, tid % 32u, it, ph); }
    workgroupBarrier();
    if (tid % 32u == 0u && a < NA && touched) { art_twists(a); }
    workgroupBarrier();
  }
}

// Exact articulation update from the contact impulses accumulated on its links.
fn art_contact_impulses(a: u32) {
  let ai = art_info(a);
  var hit = false;
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k;
    let b = u32(link_body(l));
    let f = imp[b * 2u].xyz; let t = imp[b * 2u + 1u].xyz;
    if (any(f != vec3f(0.0)) || any(t != vec3f(0.0))) {
      hit = true;
      stsv(lo(l) + L_P, SV(-t, -f));  // bias convention: -f_ext
      imp[b * 2u] = vec4f(0.0); imp[b * 2u + 1u] = vec4f(0.0);
    }
  }
  if (hit) { art_apply(a); }
}

// Joint friction, limit and velocity-limit rows after a sweep (contacts were propagated per color).
fn art_dof_impulse(a: u32, l: u32, r: u32, dl: f32) {
  art[lo(l) + L_TAU + r] = dl;
  art_apply(a);
}

// rows: drive, joint friction and limit rows, over the dofs listed in prepare; vlim: velocity limits
// (Steel solves them last).
fn art_propagate(a: u32, vlim: bool, rows: bool) {
  let ai = art_info(a);
  if (rows) {
    let n = u32(art[A_RLN + a]);
    for (var i = 0u; i < n; i++) {
      let d = u32(art[A_RL + ai.z + i]); let l = u32(dof_limit(d).w);
      art_dof_rows(a, l, d - link_dof(l), d, false, true);
    }
  }
  if (!(vlim && VLIM_ON == 1u && art[A_AVL + a] > 0.5)) { return; }
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k;
    let t = link_type(l);
    if (t != JT_REVOLUTE && t != JT_PRISMATIC && t != JT_D6) { continue; }
    for (var r = 0u; r < link_ndof(l); r++) { art_dof_rows(a, l, r, link_dof(l) + r, true, false); }
  }
}
fn art_dof_rows(a: u32, l: u32, r: u32, d: u32, vlim: bool, rows: bool) {
  let hinv = max(art[A_HINV + d], 1e-12);
  let pv = dof_passive(d);
  let dr = dof_drive(d);
  let driven = rows && DRIVE_ROWS == 1u && (dr.y > 0.0 || dr.z > 0.0);
  // drive_mode="rows": Steel's PhysX-style drive row, cold-started each step, no relaxation.
  if (driven && !(vpass && VEL_DRIVE_ACTIVE == 0u)) {
    let q = art[A_Q + link_qs(l) + r];
    var pd = 0.0;
    if (vpass) { pd = P.dt * art[A_SNAP + NB * 8u + d]; }
    let ca = P.dt * (P.dt * dr.y + dr.z);
    let x = 1.0 / (1.0 + ca * hinv);
    let bias = x * P.dt * dr.z * art[A_TGTV + d] + dr.y * x * P.dt * (art[A_TGT + d] - q - pd);
    let mx = select(1e20, dr.w * P.dt, dr.w > 0.0);
    let lam = art[A_DRV + d];
    let nl = clamp(lam * (1.0 - x) - x * ca * aqd[d] + bias, -mx, mx);
    if (nl != lam) { art[A_DRV + d] = nl; art_dof_impulse(a, l, r, nl - lam); }
  }
  // Joint friction: a velocity row with |impulse| <= friction * dt (plus the load term).
  var fr = pv.y;
  if (JFL == 1u) { fr += art[A_JFL + d]; }
  if (rows && fr > 0.0) {
    let lam = art[A_FRIC + d];
    let nl = clamp(lam - F_OMEGA * aqd[d] / hinv, -fr * P.dt, fr * P.dt);
    if (nl != lam) { art[A_FRIC + d] = nl; art_dof_impulse(a, l, r, nl - lam); }
  }
  let lim = dof_limit(d);
  if (rows && art[A_LG + d] > 0.5) {
    let q = art[A_Q + link_qs(l) + r];
    for (var side = 0u; side < 2u; side++) {
      let sg = select(-1.0, 1.0, side == 0u);       // +1 lower bound, -1 upper bound
      let gap = select(lim.y - q, q - lim.x, side == 0u);
      let lam = art[A_LIM + 2u * d + side];
      var rhs = gap / P.dt;
      if (gap < 0.0) { rhs = select(max(P.beta * gap / P.dt, -P.max_depen), 0.0, vpass); }
      let nl = max(lam - F_OMEGA * (sg * aqd[d] + rhs) / hinv, 0.0);
      if (nl == lam) { continue; }
      art[A_LIM + 2u * d + side] = nl;
      art_dof_impulse(a, l, r, sg * (nl - lam));
    }
  }
  // Velocity limit (Steel's phase 5): a stateless push back onto |qd| <= limit, no bias. A driven
  // dof with the fused clamp gets the same push without dedicated rows.
  if (vlim && pv.z >= 0.0 && art[A_VLG + d] > 0.5) {
    let over = aqd[d] - clamp(aqd[d], -pv.z, pv.z);
    if (over != 0.0) { art_dof_impulse(a, l, r, -over / hinv); }
  }
}

// Displacement of world point x under body b's pose increment this substep: the SE(3) logarithm
// evaluated at x (Steel's _pose_motion; zero at a fixed pivot, no chord error when rolling).
fn body_motion(b: i32, x: vec3f) -> vec3f {
  if (b < 0) { return vec3f(0.0); }
  let p0 = poses[P_PREV + u32(b) * 2u].xyz; let q0 = poses[P_PREV + u32(b) * 2u + 1u];
  let p1 = poses[P_BODY + u32(b) * 2u].xyz; let q1 = poses[P_BODY + u32(b) * 2u + 1u];
  var r = qmul(q1, qconj(q0));
  if (r.w < 0.0) { r = -r; }
  let sn = length(r.xyz);
  var ang = 2.0 * r.xyz;
  let tr = p1 - p0;
  var lin = tr;
  if (sn > 1e-6) {
    let half = atan2(sn, r.w); let axis = r.xyz / sn;
    ang = 2.0 * half * axis;
    let sc = half * r.w / sn;
    lin = sc * tr + (1.0 - sc) * dot(axis, tr) * axis;
  }
  return lin + cross(ang, x - 0.5 * (p0 + p1));
}

// ph (row_schedule): 0 every row, 1 contact rows only, 2 joint-internal rows only.
// Steel's nesterov_momentum (MuJoCo's PGS acceleration), on the contact rows of the colored
// sweep: impulses are extrapolated by beta along the previous sweep's change and each row's
// represented change e = y - lam goes to the velocities through its own response, as a sweep
// update would. rows[o + MO] holds lam at the last extrapolation, rows[o + MO + 1] holds e.
var<workgroup> wred: array<f32, WG>;
var<workgroup> wmom: vec2f;  // (k, beta)

fn momentum_unit(us: u32, row: u32, beta: f32, init: bool) {
  let o = row * ROWS;
  let lam = rows[o + 6u];
  if (init) { rows[o + MO] = vec4f(lam.xyz, 0.0); rows[o + MO + 1u] = vec4f(0.0); return; }
  let y = lam.xyz + beta * (lam.xyz - rows[o + MO].xyz);
  let e = y - lam.xyz;
  rows[o + MO] = vec4f(lam.xyz, 0.0); rows[o + MO + 1u] = vec4f(e, 0.0);
  if (all(e == vec3f(0.0))) { return; }
  rows[o + 6u] = vec4f(y, lam.w);
  let key = atomicLoad(&sched[S_UKEY + us]);
  let a = i32(key & 0xffffu) - 1; let b = i32(key >> 16u) - 1;
  var ta = load_tw(a); var tb = load_tw(b);
  ta[0] += rows[o + 7u].xyz * e.x + rows[o + 11u].xyz * e.y + rows[o + 15u].xyz * e.z;
  ta[1] += rows[o + 8u].xyz * e.x + rows[o + 12u].xyz * e.y + rows[o + 16u].xyz * e.z;
  tb[0] += rows[o + 9u].xyz * e.x + rows[o + 13u].xyz * e.y + rows[o + 17u].xyz * e.z;
  tb[1] += rows[o + 10u].xyz * e.x + rows[o + 14u].xyz * e.y + rows[o + 18u].xyz * e.z;
  let ra = rows[o + 3u].xyz; let rb = rows[o + 4u].xyz;
  var fa = ra; var fb = rb;
  if (EXTRA == 1u) { fa = rows[o + PO].xyz; fb = rows[o + PO + 1u].xyz; }
  let fn_ = rows[o].xyz * e.x; let ft = rows[o + 1u].xyz * e.y + rows[o + 2u].xyz * e.z;
  add_imp(a, -fn_ - ft, -cross(ra, fn_) - cross(fa, ft));
  add_imp(b, fn_ + ft, cross(rb, fn_) + cross(fb, ft));
  if (a >= 0) { tw[u32(a) * 2u] = vec4f(ta[0], 0.0); tw[u32(a) * 2u + 1u] = vec4f(ta[1], 0.0); }
  if (b >= 0) { tw[u32(b) * 2u] = vec4f(tb[0], 0.0); tw[u32(b) * 2u + 1u] = vec4f(tb[1], 0.0); }
}

// One momentum step at the start of a position sweep: O'Donoghue-Candes restart when the last
// sweep's correction opposed its extrapolation, or when friction switches on.
fn momentum_step(tid: u32, ncol: u32, it: u32) {
  let nrows = wcs[NCOL + 1u];
  if (it > 0u) {
    var dot_ = 0.0;
    for (var u = tid; u < nrows; u += WG) {
      let o = atomicLoad(&sched[S_PORD + u]) * ROWS;
      let e = rows[o + MO + 1u].xyz;
      dot_ += dot(rows[o + 6u].xyz - rows[o + MO].xyz - e, e);
    }
    wred[tid] = dot_;
    workgroupBarrier();
    if (tid == 0u) {
      var total = 0.0;
      for (var i = 0u; i < WG; i++) { total += wred[i]; }
      let k = select(wmom.x + 1.0, 0.0, total < 0.0 || it == FSTART);
      wmom = vec2f(k, select(0.0, (k - 1.0) / (k + 2.0), k > 1.0));
    }
  } else if (tid == 0u) { wmom = vec2f(0.0); }
  let beta = workgroupUniformLoad(&wmom).y;
  for (var c = 0u; c < NCOL; c++) {
    if (c >= ncol) { break; }
    for (var u = wcs[c] + tid; u < wcs[c + 1u]; u += WG) { let row = atomicLoad(&sched[S_PORD + u]); momentum_unit(atomicLoad(&sched[S_RUNIT + row]), row, beta, it == 0u); }
    workgroupBarrier();
  }
  if (tid == 0u) {
    for (var u = wcs[NCOL]; u < wcs[NCOL + 1u]; u++) { let row = atomicLoad(&sched[S_PORD + u]); momentum_unit(atomicLoad(&sched[S_RUNIT + row]), row, beta, it == 0u); }
  }
  workgroupBarrier();
  if (tid < NA) { art_contact_impulses(tid); art_propagate(tid, true, false); }
  workgroupBarrier();
}

// framefields: light-body blocks. A free body squeezed between links (a cube in a gripper: the jaw's
// armature and the arm's drives make both sides hundreds of times heavier), or pressed by a link into
// the floor, converges in Gauss-Seidel by about its mass over theirs per sweep: a grip crushes it through
// a finger, and friction cannot carry a tilted finger's push through it. Its rows in touch (normals, and
// friction against links) are solved together instead, exactly, with the articulation's own coupling
// between its links (J H^-1 J^T): a small convex QP per light body, after each position sweep's colors,
// on the links' exact twists. For free bodies touching a link and something else; the workgroup solves it.
var<workgroup> lb_count: u32;
var<workgroup> lb_n: array<u32, LBMAX>;
var<workgroup> lb_x: array<i32, LBMAX>;     // the light body
var<workgroup> lb_row: array<u32, LBMAX * LBR>;   // row index
var<workgroup> lb_unit: array<u32, LBMAX * LBR>;  // its unit
var<workgroup> lb_body: array<vec2i, LBMAX * LBR>; // (the light body's side: 0 = a, 1 = b; the other body)

fn light_free(b: i32) -> bool { return b >= 0 && body_kind(b) == 1u && (body_flags(b) & 1u) == 0u; }

fn build_light_blocks(nu: u32) {
  var n = 0u;
  for (var us = 0u; us < nu && n < LBMAX; us++) {
    let key = atomicLoad(&sched[S_UKEY + us]);
    let a = i32(key & 0xffffu) - 1; let b = i32(key >> 16u) - 1;
    for (var side = 0u; side < 2u; side++) {
      let x = select(a, b, side == 1u); let o = select(b, a, side == 1u);
      if (!light_free(x) || o < 0 || body_kind(o) != 2u || !lb_touch(us)) { continue; }
      var seen = false;
      for (var k = 0u; k < n; k++) { if (lb_x[k] == x) { seen = true; } }
      if (seen || n >= LBMAX) { continue; }
      // Its rows in touch (within F_LB_GAP) in every unit (links, free bodies, the world), and how many
      // units they span: rows further apart stay in the sweep.
      var m = 0u; var units = 0u;
      for (var vs = 0u; vs < nu; vs++) {
        let kv = atomicLoad(&sched[S_UKEY + vs]);
        let va = i32(kv & 0xffffu) - 1; let vb = i32(kv >> 16u) - 1;
        if ((va != x && vb != x) || !lb_touch(vs)) { continue; }
        units++;
        let s0 = atomicLoad(&sched[S_USTART + vs]);
        for (var r = s0; r < s0 + atomicLoad(&sched[S_USIZE + vs]) && m < LBR; r++) {
          if (rows[r * ROWS + 6u].w > F_LB_GAP) { continue; }
          lb_row[n * LBR + m] = r; lb_unit[n * LBR + m] = vs;
          lb_body[n * LBR + m] = vec2i(select(0, 1, vb == x), select(vb, va, vb == x));
          m++;
        }
      }
      if (units < 2u) { continue; }
      lb_x[n] = x;
      lb_n[n] = m;
      n++;
    }
  }
  lb_count = n;
}

// A unit with a row in touch: within F_LB_GAP (the velocity pass's phi; restitution rows carry 1e30).
fn lb_touch(us: u32) -> bool {
  let s0 = atomicLoad(&sched[S_USTART + us]);
  for (var r = s0; r < s0 + atomicLoad(&sched[S_USIZE + us]); r++) { if (rows[r * ROWS + 6u].w <= F_LB_GAP) { return true; } }
  return false;
}

// The block's unknowns: every row's normal, then a tangent pair for each row against a link that
// carries friction (with patches: anchors only, at the anchor). Unknown u's row (in the block) and kind
// (0 normal, 1 t1, 2 t2). Friction against the world or other free bodies stays in the sweep: the light
// body's own mass conditions those rows, and only links make the chain heavy-light-heavy.
fn lb_dir(o: u32, kind: u32) -> vec3f { return rows[o + kind].xyz; }
// Lever arms of an unknown on (the light body's side, the other side): the contact's for normals, the
// friction point's for tangents.
fn lb_arms(o: u32, kind: u32, side: u32) -> array<vec3f, 2> {
  var ra = rows[o + 3u].xyz; var rb = rows[o + 4u].xyz;
  if (kind > 0u && EXTRA == 1u) { ra = rows[o + PO].xyz; rb = rows[o + PO + 1u].xyz; }
  return array<vec3f, 2>(select(ra, rb, side == 1u), select(rb, ra, side == 1u));
}

// A free body's twist change from an impulse (f, t) at its COM: exact, as the rows' responses are.
fn lb_response(b: i32, f: vec3f, t: vec3f) -> array<vec3f, 2> {
  if (b < 0 || body_kind(b) != 1u) { return array<vec3f, 2>(vec3f(0.0), vec3f(0.0)); }
  let R = qmat(poses[P_BODY + u32(b) * 2u + 1u]);
  return array<vec3f, 2>(f * body_inv_mass(b), R * (body_inv_inertia(b) * (transpose(R) * t)));
}

// The block's matrices in art (A_LB): K, the Newton step's system, each unknown's Jacobian over its
// articulation's dofs and Y = H^-1 J^T, and the twist changes of the light body and the other body.
const LBK: u32 = A_LB;
const LBAO: u32 = A_LB + LBU * LBU;
const LBJ: u32 = A_LB + 2u * LBU * LBU;
const LBY: u32 = LBJ + LBU * NDA;
const LBD: u32 = LBY + LBU * NDA;
var<workgroup> lb_nu: u32;
var<workgroup> lb_m: u32;
var<workgroup> lb_go: u32;
var<workgroup> lb_eps: f32;
var<workgroup> lbu_row: array<u32, LBU>;
var<workgroup> lbu_kind: array<u32, LBU>;
var<workgroup> lbu_art: array<i32, LBU>;
var<workgroup> lb_res: array<f32, LBU>;
var<workgroup> lb_lam: array<f32, LBU>;
var<workgroup> lb_z: array<f32, LBU>;
var<workgroup> lb_lo: array<f32, LBU>;
var<workgroup> lb_hi: array<f32, LBU>;
var<workgroup> lb_g: array<f32, LBU>;
var<workgroup> lb_p: array<f32, LBU>;
var<workgroup> lb_at: array<u32, LBU>;  // 0 free, 1 at lo, 2 at hi, 3 fixed (lo = hi)
var<workgroup> lb_idx: array<u32, LBU>;

// Twist change w of unknown u: 0, 1 the light body's (v, w); 2, 3 a free other body's.
fn lb_dx(u: u32, w: u32) -> vec3f { let o = LBD + u * 16u + w * 4u; return vec3f(art[o], art[o + 1u], art[o + 2u]); }
fn lb_set_dx(u: u32, w: u32, v: vec3f) { let o = LBD + u * 16u + w * 4u; art[o] = v.x; art[o + 1u] = v.y; art[o + 2u] = v.z; }

// Unknown u's responses, Jacobian, residual and impulse (one thread each).
fn lb_unknown(k: u32, u: u32, x: i32, tx: array<vec3f, 2>) {
  let i = lbu_row[u]; let kind = lbu_kind[u];
  let o = lb_row[k * LBR + i] * ROWS;
  let si = u32(lb_body[k * LBR + i].x); let oi = lb_body[k * LBR + i].y;
  let dir = lb_dir(o, kind);
  let arm = lb_arms(o, kind, si);
  let sx = select(-1.0, 1.0, si == 1u);
  let rx = lb_response(x, sx * dir, sx * cross(arm[0], dir));
  lb_set_dx(u, 0u, rx[0]); lb_set_dx(u, 1u, rx[1]);
  var ro = array<vec3f, 2>(vec3f(0.0), vec3f(0.0));
  if (oi >= 0 && body_kind(oi) != 2u) { ro = lb_response(oi, -sx * dir, -sx * cross(arm[1], dir)); }
  lb_set_dx(u, 2u, ro[0]); lb_set_dx(u, 3u, ro[1]);
  lbu_art[u] = -1;
  if (oi >= 0 && body_kind(oi) == 2u) {
    let al = u32(body_art(oi));
    let ai = art_info(al);
    let lk = u32(body_link(oi));
    var J3: array<f32, JDIM>;
    // The other body enters the row's relative velocity with the light body's opposite sign.
    add_gen_jac(lk, ld3(lo(lk) + L_COM) + arm[1], -sx, dir, dir, dir, ai.z, &J3);
    var tau: array<f32, NDA>; var y: array<f32, NDA>;
    for (var q = 0u; q < NDA; q++) { tau[q] = select(0.0, J3[q], q < ai.w); }
    art_solve_gen(al, &tau, &y);
    for (var q = 0u; q < NDA; q++) { art[LBJ + u * NDA + q] = tau[q]; art[LBY + u * NDA + q] = select(0.0, y[q], q < ai.w); }
    lbu_art[u] = i32(al);
  }
  let to = load_tw(oi);
  var r = sx * dot(dir, (tx[0] + cross(tx[1], arm[0])) - (to[0] + cross(to[1], arm[1])));
  let lm = rows[o + 6u];
  if (kind == 0u) {
    r += rows[o + 1u].w;
    lb_lam[u] = lm.x;
  } else {
    lb_lam[u] = select(lm.y, lm.z, kind == 2u);
    // A patch anchor's displacement bias, as in the sweep.
    if (PATCH == 1u && rows[o + PO].w == 2.0 && !vpass) { r += F_ANCHOR_BETA * dot(dir, rows[o + PO + 2u].xyz) / P.dt; }
  }
  lb_res[u] = r;
}

// K_uv: the change in unknown u's velocity from a unit impulse of unknown v, through the light body, a
// free other body they share, or the articulation they share (J_u Y_v, exact across its links).
fn lb_kentry(k: u32, u: u32, v: u32) -> f32 {
  let i = lbu_row[u];
  let o = lb_row[k * LBR + i] * ROWS;
  let si = u32(lb_body[k * LBR + i].x); let oi = lb_body[k * LBR + i].y;
  let dir = lb_dir(o, lbu_kind[u]);
  let arm = lb_arms(o, lbu_kind[u], si);
  let sx = select(-1.0, 1.0, si == 1u);
  var kuv = sx * dot(dir, lb_dx(v, 0u) + cross(lb_dx(v, 1u), arm[0]));
  if (lbu_art[u] >= 0 && lbu_art[u] == lbu_art[v]) {
    for (var q = 0u; q < NDA; q++) { kuv += art[LBJ + u * NDA + q] * art[LBY + v * NDA + q]; }
  } else if (lbu_art[u] < 0 && oi >= 0 && lb_body[k * LBR + lbu_row[v]].y == oi) {
    kuv -= sx * dot(dir, lb_dx(v, 2u) + cross(lb_dx(v, 3u), arm[1]));
  }
  if (u == v && COMPL == 1u && lbu_kind[u] == 0u) { kuv += rows[o + CO].x; }
  return kuv;
}

// The QP's gradient at z for unknown u.
fn lb_grad(u: u32, nu: u32) -> f32 {
  var gu = lb_res[u] + lb_eps * lb_z[u];
  for (var v = 0u; v < nu; v++) { gu += art[LBK + u * LBU + v] * (lb_z[v] - lb_lam[v]); }
  return gu;
}

// The friction disk's radius for block row i with the normals at z: mu times the row's own normal, or
// for a patch anchor its unit's pooled load (the unit's rows outside the block keep theirs).
fn lb_limit(k: u32, i: u32, n: u32) -> f32 {
  let o = lb_row[k * LBR + i] * ROWS;
  let mu = rows[o + 2u].w;
  if (PATCH == 0u || rows[o + PO].w != 2.0) { return mu * max(lb_z[i], 0.0); }
  let us = lb_unit[k * LBR + i];
  var load = unit_load(us);
  for (var j = 0u; j < n; j++) {
    if (lb_unit[k * LBR + j] != us || rows[lb_row[k * LBR + j] * ROWS + PO].w == 1.0) { continue; }
    load += lb_z[j] - lb_lam[j];
  }
  return mu * max(load, 0.0);
}

// One light body's block, solved by the whole workgroup.
//
// It is a convex QP over the impulses z: minimize 1/2 (z - lam)^T K (z - lam) + res^T (z - lam) + eps/2 |z|^2,
// each unknown in a box: normals at or above zero (inert rows, r0.w = 0, held as they are) and each
// friction pair in the square inscribed in its disk, whose radius follows the normals (solved again when
// they move it). Regularizing the impulses themselves (not their change) makes the solution unique where
// the rows are dependent (points on one face, two anchors that could pull against each other): the
// least-impulse one. A primal active set: Newton steps on the free unknowns, stopped at the first bound,
// then releasing the bound unknown whose gradient points inward most; it terminates (strictly convex),
// usually in a few steps. K + eps I is positive definite, so its elimination needs no pivoting: one row
// per thread.
fn light_block(k: u32, it: u32, tid: u32) {
  let x = lb_x[k];
  let n = lb_n[k];
  // Friction joins the block in Steel's default friction path (the sliding pair per row); other
  // friction modes keep their rows in the sweep.
  let fric = FMODE == 0u && ANG == 0u && TORS == 0u && it >= FSTART;
  if (tid == 0u) {
    var nu = n;
    for (var i = 0u; i < n; i++) { lbu_row[i] = i; lbu_kind[i] = 0u; }
    if (fric) {
      for (var i = 0u; i < n && nu + 2u <= LBU; i++) {
        let o = lb_row[k * LBR + i] * ROWS;
        let oi = lb_body[k * LBR + i].y;
        if (rows[o].w <= 0.0 || rows[o + 2u].w <= 0.0 || oi < 0 || body_kind(oi) != 2u) { continue; }
        if (EXTRA == 1u && rows[o + PO].w == 0.0) { continue; }
        lbu_row[nu] = i; lbu_kind[nu] = 1u; lbu_row[nu + 1u] = i; lbu_kind[nu + 1u] = 2u;
        nu += 2u;
      }
    }
    lb_nu = nu;
  }
  let nu = workgroupUniformLoad(&lb_nu);
  let tx = load_tw(x);
  if (tid < nu) { lb_unknown(k, tid, x, tx); }
  storageBarrier(); workgroupBarrier();
  for (var e = tid; e < nu * nu; e += WG) { art[LBK + (e / nu) * LBU + e % nu] = lb_kentry(k, e / nu, e % nu); }
  storageBarrier(); workgroupBarrier();
  if (tid == 0u) {
    var dmax = 0.0;
    for (var u = 0u; u < nu; u++) { dmax = max(dmax, art[LBK + u * LBU + u]); }
    lb_eps = 1e-5 * dmax;
    for (var u = 0u; u < n; u++) {
      let inert = rows[lb_row[k * LBR + u] * ROWS].w <= 0.0;
      lb_lo[u] = select(0.0, lb_lam[u], inert); lb_hi[u] = select(1e30, lb_lam[u], inert);
      lb_z[u] = clamp(lb_lam[u], lb_lo[u], lb_hi[u]);
    }
    for (var u = n; u < nu; u++) { lb_z[u] = lb_lam[u]; lb_hi[u] = -1.0; }
  }
  for (var sw = 0u; sw < 3u; sw++) {
    if (tid == 0u) {
      // Friction boxes from the normals so far.
      var moved = false;
      for (var u = n; u < nu; u += 2u) {
        let r = lb_limit(k, lbu_row[u], n) * 0.70710678;
        moved = moved || abs(r - lb_hi[u]) > 1e-3 * r + 1e-12;
        lb_lo[u] = -r; lb_hi[u] = r; lb_lo[u + 1u] = -r; lb_hi[u + 1u] = r;
      }
      lb_go = select(1u, 0u, sw > 0u && !moved);
      for (var u = 0u; u < nu; u++) {
        lb_z[u] = clamp(lb_z[u], lb_lo[u], lb_hi[u]);
        lb_at[u] = select(select(select(0u, 2u, lb_z[u] >= lb_hi[u]), 1u, lb_z[u] <= lb_lo[u]), 3u, lb_lo[u] >= lb_hi[u]);
      }
    }
    if (workgroupUniformLoad(&lb_go) == 0u) { break; }
    for (var step = 0u; step < 3u * LBU; step++) {
      if (tid < nu) { lb_g[tid] = lb_grad(tid, nu); }
      workgroupBarrier();
      if (tid == 0u) {
        var m = 0u;
        for (var u = 0u; u < nu; u++) { if (lb_at[u] == 0u) { lb_idx[m] = u; m++; } }
        lb_m = m;
      }
      // Newton step on the free unknowns: (K_FF + eps I) p = -g_F.
      let m = workgroupUniformLoad(&lb_m);
      for (var e = tid; e < m * m; e += WG) {
        let a2 = e / m; let b2 = e % m;
        art[LBAO + a2 * LBU + b2] = art[LBK + lb_idx[a2] * LBU + lb_idx[b2]] + select(0.0, lb_eps, a2 == b2);
      }
      if (tid < m) { lb_p[tid] = -lb_g[lb_idx[tid]]; }
      storageBarrier(); workgroupBarrier();
      for (var c = 0u; c < m; c++) {
        let piv = art[LBAO + c * LBU + c];
        let r = c + 1u + tid;
        if (r < m && abs(piv) >= 1e-30) {
          let f = art[LBAO + r * LBU + c] / piv;
          for (var q = c; q < m; q++) { art[LBAO + r * LBU + q] -= f * art[LBAO + c * LBU + q]; }
          lb_p[r] -= f * lb_p[c];
        }
        storageBarrier(); workgroupBarrier();
      }
      if (tid == 0u) { lb_step(k, n, nu, m); }
      if (workgroupUniformLoad(&lb_go) == 0u) { break; }
    }
  }
  if (tid == 0u) { lb_apply(k, x, nu); }
}

// Back substitution, the step to the first bound, and at the face's optimum the release (thread 0);
// lb_go = 0 when the QP is solved.
fn lb_step(k: u32, n: u32, nu: u32, m: u32) {
  for (var cc = 0u; cc < m; cc++) {
    let c = m - 1u - cc;
    var s = lb_p[c];
    for (var q = c + 1u; q < m; q++) { s -= art[LBAO + c * LBU + q] * lb_p[q]; }
    let piv = art[LBAO + c * LBU + c];
    lb_p[c] = select(0.0, s / piv, abs(piv) >= 1e-30);
  }
  var alpha = 1.0; var blk = LBU; var side = 0u;
  for (var a2 = 0u; a2 < m; a2++) {
    let u = lb_idx[a2]; let pu = lb_p[a2];
    if (pu < 0.0 && lb_z[u] + pu < lb_lo[u]) { let t = (lb_lo[u] - lb_z[u]) / pu; if (t < alpha) { alpha = t; blk = u; side = 1u; } }
    if (pu > 0.0 && lb_z[u] + pu > lb_hi[u]) { let t = (lb_hi[u] - lb_z[u]) / pu; if (t < alpha) { alpha = t; blk = u; side = 2u; } }
  }
  for (var a2 = 0u; a2 < m; a2++) { lb_z[lb_idx[a2]] += alpha * lb_p[a2]; }
  lb_go = 1u;
  if (blk < LBU) {
    lb_z[blk] = select(lb_hi[blk], lb_lo[blk], side == 1u); lb_at[blk] = side;
    return;
  }
  // At the optimum of this face: release the bound unknown whose gradient points inward most.
  var best = 1e-7; var rel = LBU;
  for (var u = 0u; u < nu; u++) {
    let gu = lb_grad(u, nu);
    let inward = select(select(0.0, gu, lb_at[u] == 2u), -gu, lb_at[u] == 1u);
    if (inward > best) { best = inward; rel = u; }
  }
  if (rel == LBU) { lb_go = 0u; } else { lb_at[rel] = 0u; }
}

// The solution's changes (thread 0): the rows' impulses, the light body's twist (and a free other
// body's), and the links' impulses for propagation.
fn lb_apply(k: u32, x: i32, nu: u32) {
  for (var u = 0u; u < nu; u++) { if (!(abs(lb_z[u] - lb_lam[u]) < 1e30)) { return; } }
  for (var u = 0u; u < nu; u++) {
    let du = lb_z[u] - lb_lam[u];
    if (du == 0.0) { continue; }
    let i = lbu_row[u];
    let o = lb_row[k * LBR + i] * ROWS;
    var lm = rows[o + 6u];
    if (lbu_kind[u] == 0u) { lm.x = max(lm.x + du, 0.0); } else if (lbu_kind[u] == 1u) { lm.y += du; } else { lm.z += du; }
    rows[o + 6u] = lm;
    let oi = lb_body[k * LBR + i].y;
    tw[u32(x) * 2u] += vec4f(lb_dx(u, 0u) * du, 0.0); tw[u32(x) * 2u + 1u] += vec4f(lb_dx(u, 1u) * du, 0.0);
    if (oi >= 0 && body_kind(oi) != 2u) {
      tw[u32(oi) * 2u] += vec4f(lb_dx(u, 2u) * du, 0.0); tw[u32(oi) * 2u + 1u] += vec4f(lb_dx(u, 3u) * du, 0.0);
    }
    // The impulse on b is +dir, at a's and b's arms as the sweep applies them.
    let dir = lb_dir(o, lbu_kind[u]);
    let arm = lb_arms(o, lbu_kind[u], 1u);
    let key = atomicLoad(&sched[S_UKEY + lb_unit[k * LBR + i]]);
    let a = i32(key & 0xffffu) - 1; let b = i32(key >> 16u) - 1;
    add_imp(a, -dir * du, -cross(arm[1], dir * du));
    add_imp(b, dir * du, cross(arm[0], dir * du));
    if (lbu_kind[u] == 0u && PATCH == 1u && rows[o + PO].w != 1.0) { add_unit_load(lb_unit[k * LBR + i], du); }
  }
}

fn sweep(tid: u32, mode: u32, ncol0: u32, it: u32, ph: u32) {
  let ncol = select(ncol0, 0u, ph == 2u);
  // Steel's interleaved schedule: internal rows, dense rows, contacts, then velocity limits.
  if (tid < NA && ph != 1u) { art_propagate(tid, false, true); }
  if (PATCH == 1u && mode == 1u) { sum_unit_loads(tid, workgroupUniformLoad(&wn).x); storageBarrier(); }
  workgroupBarrier();
  dense_phase(tid, 1u, it, ph);
  for (var c = 0u; c < NCOL; c++) {
    if (c >= ncol) { break; }
    let s = wcs[c]; let e = wcs[c + 1u];
    for (var u = s + tid; u < e; u += WG) { solve_slot(u, mode, it); }
    workgroupBarrier();
  }
  // Overflow color: serial, the next slot's record loading while this row solves.
  if (tid == 0u && ph != 2u) {
    let u0 = wcs[NCOL]; let f0 = min(u0, MAXC - 1u);
    var sl = rows[MAXC * ROWS + 2u * f0]; var sr = rows[MAXC * ROWS + 2u * f0 + 1u];
    for (var u = u0; u < wcs[NCOL + 1u]; u++) {
      let un = min(u + 1u, MAXC - 1u);
      let nl = rows[MAXC * ROWS + 2u * un]; let nr = rows[MAXC * ROWS + 2u * un + 1u];
      solve_unit(u32(sl.y), u32(sl.x), i32(sl.z), i32(sl.w), u32(sr.x), u32(sr.y), mode, it);
      sl = nl; sr = nr;
    }
  }
  workgroupBarrier();
  if (LBLOCK == 1u && mode == 1u && ph != 2u) {
    // On the links' exact twists: their sweep impulses propagated first, the block's after it.
    if (tid < NA) { art_contact_impulses(tid); }
    workgroupBarrier();
    let lbn = workgroupUniformLoad(&lb_count);
    for (var k = 0u; k < lbn; k++) { light_block(k, it, tid); }
    workgroupBarrier();
  }
  if (tid < NA) { art_contact_impulses(tid); if (ph != 1u) { art_propagate(tid, true, false); } }
  workgroupBarrier();
  // Free-body velocity limits (Steel's rigid velocity-limit rows): a per-axis box on v and w,
  // pushed back through the body response, stateless.
  for (var b = tid; b < NB; b += WG) {
    if (body_kind(i32(b)) != 1u || (body_flags(i32(b)) & 1u) != 0u) { continue; }
    let lim = body_limits(i32(b));
    let g = A_VLG + ND + b * 6u;
    if (lim.y > 0.0) {
      var v = tw[b * 2u].xyz;
      for (var k = 0u; k < 3u; k++) { if (art[g + k] > 0.5) { v[k] = clamp(v[k], -lim.y, lim.y); } }
      tw[b * 2u] = vec4f(v, 0.0);
    }
    if (lim.z > 0.0) {
      var w = tw[b * 2u + 1u].xyz;
      for (var k = 0u; k < 3u; k++) {
        let over = w[k] - clamp(w[k], -lim.z, lim.z);
        if (over == 0.0 || art[g + 3u + k] < 0.5) { continue; }
        var e = vec3f(0.0); e[k] = 1.0;
        let R = qmat(poses[P_BODY + b * 2u + 1u]);
        let iw = R * (body_inv_inertia(i32(b)) * (transpose(R) * e));
        w -= iw * (over / iw[k]);
      }
      tw[b * 2u + 1u] = vec4f(w, 0.0);
    }
  }
  workgroupBarrier();
}

// Warm-start value of row i: normal impulse, then the tangent impulse as a world vector.
fn warm_row_value(i: u32, nc: u32) -> vec4f {
  if (i < nc) {
    let o = i * ROWS;
    let lam = rows[o + 6u];
    return vec4f(lam.x, rows[o + 1u].xyz * lam.y + rows[o + 2u].xyz * lam.z);
  }
  let o = A_DENSE + (i - nc) * DPS;
  return vec4f(art[o + 9u], ld3(o + 12u) * art[o + 10u] + ld3(o + 15u) * art[o + 11u]);
}
// Order of the rows sharing a key: by the normal impulse's bits (non-negative floats order as u32), + 1.
fn warm_row_rank(i: u32, nc: u32) -> u32 { return min(bitcast<u32>(max(warm_row_value(i, nc).x, 0.0)), 0xfffffffeu) + 1u; }
// Warm-start key of row i: contact rows first, then dense rows (0xffffffff for a row that stores none).
fn warm_row_key(i: u32, nc: u32) -> u32 {
  if (i < nc) { let o = i * ROWS; return u32(rows[o + 3u].w) | (u32(rows[o + 4u].w) << 16u); }
  let o = A_DENSE + (i - nc) * DPS;
  if (art[o + 21u] > 0.5) { return 0xffffffffu; }
  return u32(art[o + 1u]) | (u32(art[o + 2u]) << 16u);
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) tid: u32) {
  if (tid == 0u) {
    wn = vec2u(atomicLoad(&sched[S_META]), min(atomicLoad(&sched[S_META + 1u]), NCOL));
  }
  for (var i = tid; i < NCOL + 2u; i += WG) { wcs[i] = atomicLoad(&sched[S_CSTART + i]); }
  for (var i = tid; i < ND; i += WG) { aqd[i] = art[A_QDH + i]; }
  if (SLEEP == 1u) {
    for (var a = tid; a < NA; a += WG) {
      if (!node_asleep(i32(NB + a))) { continue; }
      let ai = art_info(a);
      for (var d = ai.z; d < ai.z + ai.w; d++) { aqd[d] = 0.0; }
    }
  }
  for (var b = tid; b < NB; b += WG) {
    let kind = body_kind(i32(b));
    imp[b * 2u] = vec4f(0.0); imp[b * 2u + 1u] = vec4f(0.0);
    if (kind == 1u) {
      // Kinematic bodies keep their prescribed twist; gravity skips them and disable_gravity bodies.
      let fl = body_flags(i32(b));
      var v = vel[b * 2u].xyz + select(P.gravity.xyz * P.dt * body_ext(i32(b)).x, vec3f(0.0), node_asleep(i32(b)) || fl != 0u);
      var w = vel[b * 2u + 1u].xyz;
      // Applied wrench (State.body_f): force and torque at the COM, world frame.
      let bfo = A_BF + b * 8u;
      if ((fl & 1u) == 0u && (any(ld3(bfo) != vec3f(0.0)) || any(ld3(bfo + 4u) != vec3f(0.0)))) {
        let R = qmat(poses[P_BODY + b * 2u + 1u]);
        v += ld3(bfo) * body_inv_mass(i32(b)) * P.dt;
        w += R * (body_inv_inertia(i32(b)) * (transpose(R) * ld3(bfo + 4u))) * P.dt;
      }
      let I = body_inertia(i32(b));
      let iso = I[0][0] == I[1][1] && I[1][1] == I[2][2] && I[0][1] == 0.0 && I[0][2] == 0.0 && I[1][2] == 0.0;
      if ((fl & 1u) == 0u && !iso && any(w != vec3f(0.0))) {
        let R = qmat(poses[P_BODY + b * 2u + 1u]);
        w = R * gyroscopic_velocity(I, transpose(R) * w, P.dt);
      }
      if (P.pick_target.w > 0.5 && u32(P.pick_local.w) == b) {
        let pw = pick_impulse(b, v, w);
        v = pw[0]; w = pw[1];
      }
      tw[b * 2u] = vec4f(v, 0.0);
      tw[b * 2u + 1u] = vec4f(w, 0.0);
    }
  }
  for (var i = tid; i < 2u * ND; i += WG) { art[A_LIM + i] = 0.0; }
  for (var i = tid; i < ND; i += WG) { art[A_FRIC + i] = 0.0; art[A_DRV + i] = 0.0; }
  // Slot table: each scheduled row with its unit and bodies, one load per row in the sweeps.
  let nslot = min(atomicLoad(&sched[S_CSTART + NCOL + 1u]), MAXC);
  for (var u = tid; u < nslot; u += WG) {
    let row = atomicLoad(&sched[S_PORD + u]); let us = atomicLoad(&sched[S_RUNIT + row]);
    let key = atomicLoad(&sched[S_UKEY + us]);
    let s0 = atomicLoad(&sched[S_USTART + us]);
    rows[MAXC * ROWS + 2u * u] = vec4f(f32(row), f32(us), f32(i32(key & 0xffffu) - 1), f32(i32(key >> 16u) - 1));
    rows[MAXC * ROWS + 2u * u + 1u] = vec4f(f32(s0), f32(s0 + atomicLoad(&sched[S_USIZE + us])), 0.0, 0.0);
  }
  storageBarrier(); workgroupBarrier();
  if (tid < NA) { art_twists(tid); }
  workgroupBarrier();
  dense_phase(tid, 0u, 0u, 0u);
  let ws = workgroupUniformLoad(&wn);
  if (LBLOCK == 1u) {
    if (tid == 0u) { build_light_blocks(ws.x); }
    workgroupBarrier();
  }
  sweep(tid, 0u, ws.y, 0u, 0u);
  if (CTI == 1u) {
    // row_schedule="contact_then_internal": all contact iterations, then the joint-internal rows.
    for (var it = 0u; it < P.iterations; it++) { if (NEST == 1u) { momentum_step(tid, ws.y, it); } sweep(tid, 1u, ws.y, it, 1u); }
    for (var it = 0u; it < P.iterations; it++) { sweep(tid, 1u, ws.y, it, 2u); }
  } else {
    for (var it = 0u; it < P.iterations; it++) { if (NEST == 1u) { momentum_step(tid, ws.y, it); } sweep(tid, 1u, ws.y, it, 0u); }
  }
  // Velocity pass (velocity_iterations): positions integrate with the velocities reached here;
  // further bias-free sweeps from the accumulated impulses set the output velocities.
  if (VELITERS > 0u) {
    for (var b = tid; b < NB; b += WG) {
      st3(A_SNAP + b * 8u, tw[b * 2u].xyz); st3(A_SNAP + b * 8u + 4u, tw[b * 2u + 1u].xyz);
    }
    for (var i = tid; i < ND; i += WG) { art[A_SNAP + NB * 8u + i] = aqd[i]; }
    // Contact rhs without bias: 0, or a speculative gap still open at the snapshot velocity.
    for (var us = tid; us < ws.x; us += WG) {
      let key = atomicLoad(&sched[S_UKEY + us]);
      let a = i32(key & 0xffffu) - 1; let b = i32(key >> 16u) - 1;
      let ta = load_tw(a); let tb = load_tw(b);
      let s0 = atomicLoad(&sched[S_USTART + us]);
      for (var i = s0; i < s0 + atomicLoad(&sched[S_USIZE + us]); i++) {
        let o = i * ROWS;
        let phi = rows[o + 6u].w;
        if (phi >= 1e29) { continue; }
        let n = rows[o].xyz;
        let jv = dot(n, (tb[0] + cross(tb[1], rows[o + 4u].xyz)) - (ta[0] + cross(ta[1], rows[o + 3u].xyz)));
        rows[o + 1u].w = select(0.0, phi / P.dt, phi > 0.0 && phi + P.dt * jv > 1e-6);
      }
    }
    let nd = min(atomicLoad(&sched[S_META + 3u]), MAXDENSE);
    for (var i = tid; i < nd; i += WG) {
      let o = A_DENSE + i * DPS;
      if (art[o + 21u] > 0.5 || art[o + 22u] >= 1e29) { continue; }
      let ai = art_info(u32(art[o]));
      var jv = 0.0;
      for (var k = 0u; k < ai.w; k++) { jv += art[o + DHDR + k] * aqd[ai.z + k]; }
      let phi = art[o + 22u];
      art[o + 4u] = select(0.0, phi / P.dt, phi > 0.0 && phi + P.dt * jv > 1e-6);
    }
    storageBarrier(); workgroupBarrier();
    vpass = true;
    for (var it = 0u; it < VELITERS; it++) { sweep(tid, 1u, ws.y, P.iterations + it, 0u); }
    vpass = false;
  }
  // Store impulses for the next substep's warm start. Rows sharing a key keep the largest normal impulse
  // (a value, not a row position), so the table repeats run to run.
  let nc = atomicLoad(&sched[S_USTART + ws.x]);
  let ndense = min(atomicLoad(&sched[S_META + 3u]), MAXDENSE);
  let wbase = (1u - P.parity) * WH;
  // S_WWIN was cleared with this table in prepare.
  for (var i = tid; i < nc + ndense; i += WG) {
    let key = warm_row_key(i, nc);
    atomicStore(&sched[S_WSLOT + i], 0xffffffffu);
    if (key == 0xffffffffu) { continue; }
    var h = key % WH;
    for (var probe = 0u; probe < 32u; probe++) {
      let r = atomicCompareExchangeWeak(&warm[wbase + h], 0u, key);
      if (r.exchanged || r.old_value == key) { atomicMax(&sched[S_WWIN + h], warm_row_rank(i, nc)); atomicStore(&sched[S_WSLOT + i], h); break; }
      if (r.old_value == 0u) { continue; }
      h = (h + 1u) % WH;
    }
  }
  storageBarrier(); workgroupBarrier();
  for (var i = tid; i < nc + ndense; i += WG) {
    let key = warm_row_key(i, nc);
    if (key == 0xffffffffu) { continue; }
    let h = atomicLoad(&sched[S_WSLOT + i]);
    if (h >= WH || atomicLoad(&warm[wbase + h]) != key || atomicLoad(&sched[S_WWIN + h]) != warm_row_rank(i, nc)) { continue; }
    let v = warm_row_value(i, nc);
    let vo = 2u * WH + (wbase + h) * 4u;
    atomicStore(&warm[vo], bitcast<u32>(v.x));
    atomicStore(&warm[vo + 1u], bitcast<u32>(v.y));
    atomicStore(&warm[vo + 2u], bitcast<u32>(v.z));
    atomicStore(&warm[vo + 3u], bitcast<u32>(v.w));
  }
  // Integrate (anchors need the start poses afterwards).
  if (PATCH == 1u) {
    for (var b = tid; b < NB * 2u; b += WG) { poses[P_PREV + b] = poses[P_BODY + b]; }
    storageBarrier(); workgroupBarrier();
  }
  for (var b = tid; b < NB; b += WG) {
    if (body_kind(i32(b)) != 1u) { continue; }
    var v = tw[b * 2u].xyz; var w = tw[b * 2u + 1u].xyz;
    let kin = (body_flags(i32(b)) & 1u) != 0u;
    let damp = select(1.0 - body_limits(i32(b)).x * P.dt, 1.0, kin);
    // framefields: linear damping, and the planar lock (no motion along z, no turning about x or y).
    let ext = body_ext(i32(b));
    if (ext.z > 0.5) { v.z = 0.0; w.x = 0.0; w.y = 0.0; }
    let ldamp = select(max(1.0 - ext.y * P.dt, 0.0), 1.0, kin);
    vel[b * 2u] = vec4f(v * ldamp, 0.0); vel[b * 2u + 1u] = vec4f(w * damp, 0.0);
    if (VELITERS > 0u) { let s = snap_tw(i32(b)); v = s[0]; w = s[1]; if (ext.z > 0.5) { v.z = 0.0; w.x = 0.0; w.y = 0.0; } }
    if (node_asleep(i32(b))) { vel[b * 2u] = vec4f(0.0); vel[b * 2u + 1u] = vec4f(0.0); continue; }
    let c = poses[P_BODY + b * 2u].xyz + v * P.dt;
    var q = poses[P_BODY + b * 2u + 1u];
    q = normalize(q + 0.5 * P.dt * qmul(vec4f(w, 0.0), q));
    poses[P_BODY + b * 2u] = vec4f(c, 0.0);
    poses[P_BODY + b * 2u + 1u] = q;
  }
  for (var i = tid; i < ND; i += WG) {
    art[A_QD + i] = aqd[i];
    if (VELITERS > 0u) { aqd[i] = art[A_SNAP + NB * 8u + i]; }
  }
  // Floating-base roots: Steel's angular damping on the stored angular velocity.
  for (var l = tid; l < NL; l += WG) {
    if (link_type(l) != JT_FREE || link_parent(l) >= 0) { continue; }
    let k = 1.0 - body_limits(link_body(l)).x * P.dt;
    let d = link_dof(l);
    art[A_QD + d + 3u] *= k; art[A_QD + d + 4u] *= k; art[A_QD + d + 5u] *= k;
  }
  workgroupBarrier();
  if (tid < NA) {
    let ai = art_info(tid);
    for (var k = 0u; k < ai.y; k++) {
      let l = ai.x + k;
      let qs = link_qs(l); let d = link_dof(l);
      let t = link_type(l);
      if (t == JT_REVOLUTE || t == JT_PRISMATIC || t == JT_D6) {
        for (var r = 0u; r < link_ndof(l); r++) { art[A_Q + qs + r] += aqd[d + r] * P.dt; }
      }
      if (t == JT_BALL) {
        let w = vec3f(aqd[d], aqd[d + 1u], aqd[d + 2u]);
        var q = vec4f(art[A_Q + qs], art[A_Q + qs + 1u], art[A_Q + qs + 2u], art[A_Q + qs + 3u]);
        q = normalize(q + 0.5 * P.dt * qmul(vec4f(w, 0.0), q));
        art[A_Q + qs] = q.x; art[A_Q + qs + 1u] = q.y; art[A_Q + qs + 2u] = q.z; art[A_Q + qs + 3u] = q.w;
      }
      if (t == JT_FREE) {
        for (var c = 0u; c < 3u; c++) { art[A_Q + qs + c] += aqd[d + c] * P.dt; }
        let w = vec3f(aqd[d + 3u], aqd[d + 4u], aqd[d + 5u]);
        var q = vec4f(art[A_Q + qs + 3u], art[A_Q + qs + 4u], art[A_Q + qs + 5u], art[A_Q + qs + 6u]);
        q = normalize(q + 0.5 * P.dt * qmul(vec4f(w, 0.0), q));
        art[A_Q + qs + 3u] = q.x; art[A_Q + qs + 4u] = q.y; art[A_Q + qs + 5u] = q.z; art[A_Q + qs + 6u] = q.w;
      }
    }
    art_fk(tid);
    for (var k = 0u; k < ai.y; k++) {
      let l = ai.x + k;
      let b = u32(link_body(l));
      poses[P_BODY + b * 2u] = vec4f(ld3(lo(l) + L_COM), 0.0);
      poses[P_BODY + b * 2u + 1u] = link_rot(l);
    }
  }
  // Friction anchors: advance each displacement by the pair's relative pose motion at the anchor
  // (Steel's SE(3) screw form, which also sees integration drift) and keep it for the next step,
  // unless the region lost its load or the anchor is sliding at the friction limit.
  if (PATCH == 1u) {
    storageBarrier(); workgroupBarrier();
    let ab = AK + (1u - P.parity) * AH;
    for (var i = tid; i < nc; i += WG) {
      let o = i * ROWS;
      if (rows[o + PO].w != 2.0) { continue; }
      let pair = bitcast<u32>(rows[o + PO + 3u].w);
      let a = i32(pair & 0xffffu) - 1; let b = i32(pair >> 16u) - 1;
      let fra = rows[o + PO].xyz; let frb = rows[o + PO + 1u].xyz;
      let k = u32(rows[o + PO + 1u].w);
      let ex = rows[o + PO + 2u];
      let lim = ex.w;
      if (lim <= 0.0) { continue; }
      let n = rows[o].xyz; let t1 = rows[o + 1u].xyz; let t2 = rows[o + 2u].xyz;
      var ta = load_tw(a); var tb = load_tw(b);
      if (VELITERS > 0u) { ta = snap_tw(a); tb = snap_tw(b); }
      let vrel = (tb[0] + cross(tb[1], frb)) - (ta[0] + cross(ta[1], fra));
      let lam = rows[o + 6u];
      let lt = t1 * lam.y + t2 * lam.z;
      let r = max(min(body_radius(a), body_radius(b)), 1e-4);
      if (length(lt) >= (1.0 - 1e-5) * lim && dot(vrel, lt) < -lim * 1e-5 * r / P.dt) { continue; }
      var qa = vec4f(0.0, 0.0, 0.0, 1.0); var ca = vec3f(0.0);
      if (a >= 0) { qa = poses[P_BODY + u32(a) * 2u + 1u]; ca = poses[P_BODY + u32(a) * 2u].xyz; }
      let ll = rows[o + PO + 3u].xyz;
      let x = ca + qrot(qa, ll);
      var e = ex.xyz + body_motion(b, x) - body_motion(a, x);
      e -= n * dot(n, e);
      let el = qinvrot(qa, e);
      let hk = anchor_hash(pair, k);
      var h = hk % AH;
      for (var probe = 0u; probe < 32u; probe++) {
        let res = atomicCompareExchangeWeak(&warm[ab + h], 0u, hk);
        if (res.exchanged) {
          let vo = AV + ((1u - P.parity) * AH + h) * AVN;
          let il = qinvrot(qa, lt); let nl_ = qinvrot(qa, n);
          atomicStore(&warm[vo + 11u], bitcast<u32>(nl_.x)); atomicStore(&warm[vo + 12u], bitcast<u32>(nl_.y)); atomicStore(&warm[vo + 13u], bitcast<u32>(nl_.z));
          atomicStore(&warm[vo + 8u], bitcast<u32>(il.x)); atomicStore(&warm[vo + 9u], bitcast<u32>(il.y)); atomicStore(&warm[vo + 10u], bitcast<u32>(il.z));
          atomicStore(&warm[vo], pair); atomicStore(&warm[vo + 1u], k);
          atomicStore(&warm[vo + 2u], bitcast<u32>(ll.x)); atomicStore(&warm[vo + 3u], bitcast<u32>(ll.y)); atomicStore(&warm[vo + 4u], bitcast<u32>(ll.z));
          atomicStore(&warm[vo + 5u], bitcast<u32>(el.x)); atomicStore(&warm[vo + 6u], bitcast<u32>(el.y)); atomicStore(&warm[vo + 7u], bitcast<u32>(el.z));
          break;
        }
        if (res.old_value == 0u) { continue; }
        h = (h + 1u) % AH;
      }
    }
  }
  if (tid == 0u) {
    atomicMax(&stats[1], atomicLoad(&counters[1]));
    atomicMax(&stats[2], wn.y);
    atomicMax(&stats[3], wn.x);
    atomicMax(&stats[4], atomicLoad(&counters[0]));
    atomicStore(&stats[5], atomicLoad(&counters[1]));
    atomicStore(&stats[6], wn.y);
    atomicStore(&stats[8], atomicLoad(&sched[S_META + 5u]));
    atomicMax(&stats[7], atomicLoad(&sched[S_META + 3u]));
    atomicStore(&counters[0], 0u);
    atomicStore(&counters[1], 0u);
  }
}
`;
}

// Canonical contact order, independent of which narrowphase workgroup emitted first: the narrowphase
// writes craw, and the contacts land in contacts sorted by (body pair, feature key, point bits), so units,
// colors and sweeps repeat run to run. Two dispatches: SB-key blocks sort in workgroup memory, then each
// key's final slot is its block rank plus its rank in every other block (binary search).
export function csortWGSL(C) {
  return HEADER(C, ['counters', 'contacts', 'scratch', 'craw']) + /* wgsl */ `
const SB: u32 = CSB;
const SMALL: u32 = 512u;
const MERGE_THREADS: u32 = 2048u;
var<workgroup> sk: array<vec4u, CSB>;
var<workgroup> wn: vec2u;
fn ckey(c: u32) -> vec4u {
  let p = craw[c * 5u]; let m = craw[c * 5u + 2u];
  let pair = u32(i32(m.x) + 1) | (u32(i32(m.y) + 1) << 16u);
  let feat = u32(m.z) | (u32(m.w) << 16u);
  let bits = hash_u32(hash_u32(hash_u32(bitcast<u32>(p.x)) ^ bitcast<u32>(p.y)) ^ bitcast<u32>(p.z)) ^ bitcast<u32>(p.w);
  return vec4u(pair, feat, bits, c);
}
fn kgt(a: vec4u, b: vec4u) -> bool {
  if (a.x != b.x) { return a.x > b.x; }
  if (a.y != b.y) { return a.y > b.y; }
  if (a.z != b.z) { return a.z > b.z; }
  return a.w > b.w;
}
// Contact record c of craw (five vec4 and the shape friction pair) to slot i of contacts.
fn place(i: u32, c: u32) {
  for (var q = 0u; q < 5u; q++) { contacts[i * 5u + q] = craw[c * 5u + q]; }
  contacts[MAXC * 5u + i] = craw[MAXC * 5u + c];
}
@compute @workgroup_size(CSB / 2u)
fn keys_block(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) t: u32) {
  if (t == 0u) { wn.x = min(atomicLoad(&counters[1]), MAXC); }
  let nc = workgroupUniformLoad(&wn).x;
  let base = wid.x * SB;
  if (base >= nc) { return; }
  let m = min(SB, nc - base);
  var n2 = 2u;
  for (var r = 0u; r < 12u && n2 < m; r++) { n2 <<= 1u; }
  for (var q = t; q < n2; q += SB / 2u) { sk[q] = select(vec4u(0xffffffffu), ckey(base + q), q < m); }
  workgroupBarrier();
  if (nc <= SMALL) {
    // Few contacts: each key's slot is the count of smaller keys (keys are distinct).
    for (var q = t; q < nc; q += SB / 2u) {
      let key = sk[q];
      var r = 0u;
      for (var j = 0u; j < nc; j++) { if (kgt(key, sk[j])) { r++; } }
      place(r, key.w);
    }
    return;
  }
  for (var k = 2u; k <= n2; k <<= 1u) {
    for (var j = k >> 1u; j > 0u; j >>= 1u) {
      for (var q = t; q < n2 / 2u; q += SB / 2u) {
        let i = 2u * j * (q / j) + q % j; let l = i + j;
        let a = sk[i]; let b = sk[l];
        if (kgt(a, b) == ((i & k) == 0u)) { sk[i] = b; sk[l] = a; }
      }
      workgroupBarrier();
    }
  }
  if (nc <= SB) { for (var q = t; q < m; q += SB / 2u) { place(q, sk[q].w); } return; }
  for (var q = t; q < m; q += SB / 2u) { scratch[base + q] = sk[q]; }
}
// Number of keys of the sorted block at base (n keys) below key.
fn below(base: u32, n: u32, key: vec4u) -> u32 {
  var lo = 0u; var hi = n;
  for (var r = 0u; r < 16u && lo < hi; r++) {
    let mid = (lo + hi) / 2u;
    if (kgt(key, scratch[base + mid])) { lo = mid + 1u; } else { hi = mid; }
  }
  return lo;
}
@compute @workgroup_size(256)
fn rank_merge(@builtin(global_invocation_id) gid: vec3u) {
  let nc = min(atomicLoad(&counters[1]), MAXC);
  if (nc <= SB) { return; }
  for (var i = gid.x; i < nc; i += MERGE_THREADS) {
    let key = scratch[i];
    let own = i / SB;
    var slot = i - own * SB;
    for (var b = 0u; b * SB < nc; b++) {
      if (b != own) { slot += below(b * SB, min(SB, nc - b * SB), key); }
    }
    place(slot, key.w);
  }
}
`;
}

// Indirect dispatch size for the narrowphase.
export function argsWGSL(C) {
  return HEADER(C, ['counters', 'indirect']) + /* wgsl */ `
@compute @workgroup_size(1)
fn main() {
  // framefields: one more workgroup per rope, after the pairs.
  indirect[0] = min(atomicLoad(&counters[0]), MAXP) + NROPE + 2u * NSPRING;
  indirect[1] = 1u; indirect[2] = 1u;
}
`;
}
