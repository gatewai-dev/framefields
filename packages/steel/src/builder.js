// Build a scene in JavaScript, the way Newton's ModelBuilder does, without a Newton export.
// finalize() returns the same object as loadScene(), ready for new Sim(device, scene).
//
//   const b = new SceneBuilder();
//   b.addGroundPlane();
//   const box = b.addBody({ xform: [0, 0, 1, 0, 0, 0, 1] });
//   b.addShapeBox(box, { hx: 0.1, hy: 0.1, hz: 0.1 });
//   const sim = new Sim(device, b.finalize());
//
// Transforms are [px, py, pz, qx, qy, qz, qw]. Joints follow Newton: the child's pose comes from the
// parent's, parentXform, the joint coordinate and childXform; a body without a parent joint is free.

const JT = { PRISMATIC: 0, REVOLUTE: 1, BALL: 2, FIXED: 3, FREE: 4, DISTANCE: 5, D6: 6 };
const GT = { NONE: 0, PLANE: 1, HFIELD: 2, SPHERE: 3, CAPSULE: 4, ELLIPSOID: 5, CYLINDER: 6, BOX: 7, MESH: 8, CONE: 9, CONVEX_MESH: 10, GAUSSIAN: 11 };
const UNLIMITED = 1e10;
const IDENTITY = [0, 0, 0, 0, 0, 0, 1];

// Newton's ShapeConfig defaults; gap is ModelBuilder.rigid_gap.
// framefields: the vertex cap of a mesh's convex hull unless a shape asks otherwise (Newton's
// MESH_MAXHULLVERT). A hull's cost in the narrowphase grows with its vertices and the product of
// both shapes' edges.
export const MAX_HULL_VERTICES = 64;

const SHAPE_DEFAULTS = { density: 1000, mu: 1.0, restitution: 0, muTorsional: 0.005, muRolling: 0.0001, gap: 0.1,
  ke: 2.5e3, kd: 100, collisionGroup: 1, world: -1, color: [0.7, 0.7, 0.7] };
// Newton's JointDofConfig defaults.
const DOF_DEFAULTS = { limitLower: -UNLIMITED, limitUpper: UNLIMITED, targetPos: 0, targetVel: 0, targetKe: 0, targetKd: 0,
  damping: 0, armature: 0, effortLimit: 1e6, velocityLimit: 1e6, friction: 0 };

// --- small rigid-transform math -------------------------------------------------------------
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
function qrot(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}
function qaxis(axis, angle) {
  const n = norm(axis), s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
const tmul = (a, b) => [...add(a.slice(0, 3), qrot(a.slice(3), b.slice(0, 3))), ...qmul(a.slice(3), b.slice(3))];
function tinv(t) {
  const qi = qconj(t.slice(3));
  return [...scale(qrot(qi, t.slice(0, 3)), -1), ...qi];
}
function qmat(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

// --- convex hulls ------------------------------------------------------------------------------
// Convex hull of a point cloud: vertices and outward polygon faces (coplanar triangles merged,
// vertices counter-clockwise about the normal, plane n . x = d), the layout the solver expects.
// framefields: maxVertices caps the hull (MuJoCo's and Newton's maxhullvert): it grows by the point
// farthest outside it until it has that many vertices, so it is the hull of the points that stand out
// most, inside the full hull by at most the farthest point left out.
export function convexHull(points, maxVertices = Infinity) {
  if (!(maxVertices >= 4)) throw new Error(`convexHull: maxVertices ${maxVertices} must be at least 4`);
  const seen = new Map();
  for (const p of points) { const k = `${p[0]},${p[1]},${p[2]}`; if (!seen.has(k)) seen.set(k, [p[0], p[1], p[2]]); }
  const P = [...seen.values()];
  if (P.length < 4) throw new Error('a convex hull needs at least 4 distinct points');
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of P) { lo = lo.map((v, k) => Math.min(v, p[k])); hi = hi.map((v, k) => Math.max(v, p[k])); }
  const eps = 1e-7 * Math.max(norm(sub(hi, lo)), 1e-12);
  // Initial tetrahedron from extreme points.
  let i0 = 0;
  for (let i = 1; i < P.length; i++) if (P[i][0] < P[i0][0]) i0 = i;
  const far = (f) => { let best = -1, bd = -1; P.forEach((p, i) => { const d = f(p); if (d > bd) { bd = d; best = i; } }); return [best, bd]; };
  const [i1] = far((p) => norm(sub(p, P[i0])));
  const e = sub(P[i1], P[i0]);
  const [i2, d2] = far((p) => norm(cross(e, sub(p, P[i0]))) / norm(e));
  if (d2 <= eps) throw new Error('convex hull points are collinear');
  const n0 = cross(e, sub(P[i2], P[i0]));
  const [i3, d3] = far((p) => Math.abs(dot(n0, sub(p, P[i0]))) / norm(n0));
  if (d3 <= eps) throw new Error('convex hull points are coplanar');
  const center = scale(add(add(P[i0], P[i1]), add(P[i2], P[i3])), 0.25);
  const face = (a, b, c) => {
    let n = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    n = scale(n, 1 / norm(n));
    return { v: [a, b, c], n, d: dot(n, P[a]) };
  };
  const oriented = (a, b, c) => { const f = face(a, b, c); return dot(f.n, center) - f.d > 0 ? face(a, c, b) : f; };
  // Quickhull: each point waits on the face it is farthest outside; a face's farthest point grows the
  // hull through the connected set of faces it sees.
  const K = 1048576;
  const edges = new Map();  // directed edge a*K+b -> face
  // framefields: faces per vertex, so the hull's vertex count is known as it grows.
  const uses = new Uint32Array(P.length);
  let nv = 0;
  const use = (v, d) => { if (d > 0 ? uses[v]++ === 0 : --uses[v] === 0) nv += d; };
  const make = (a, b, c) => {
    const f = face(a, b, c);
    f.alive = true; f.out = []; f.far = -1; f.farD = -Infinity;
    for (let k = 0; k < 3; k++) { edges.set(f.v[k] * K + f.v[(k + 1) % 3], f); use(f.v[k], 1); }
    return f;
  };
  let faces = [oriented(i0, i1, i2), oriented(i0, i1, i3), oriented(i0, i2, i3), oriented(i1, i2, i3)].map((f) => make(...f.v));
  const assign = (pts, cands) => {
    for (const i of pts) {
      let best = null, bd = eps;
      for (const f of cands) { const d = dot(f.n, P[i]) - f.d; if (d > bd) { bd = d; best = f; } }
      if (best) { best.out.push(i); if (bd > best.farD) { best.farD = bd; best.far = i; } }
    }
  };
  assign([...P.keys()].filter((i) => i !== i0 && i !== i1 && i !== i2 && i !== i3), faces);
  for (let guard = 0; guard < 4 * P.length + 16; guard++) {
    // framefields: the point farthest outside any face grows the hull next (a capped hull keeps the
    // points that stand out most). Its vertex count rises by one at most per point.
    let f0 = null;
    for (const f of faces) if (f.alive && f.out.length && (!f0 || f.farD > f0.farD)) f0 = f;
    if (!f0 || nv >= maxVertices) break;
    const p = f0.far;
    f0.vis = true;
    const visible = [f0], seen = new Set([f0]);
    const horizon = [];
    for (let k = 0; k < visible.length; k++) {
      const f = visible[k];
      for (let e = 0; e < 3; e++) {
        const a = f.v[e], b = f.v[(e + 1) % 3];
        const nb = edges.get(b * K + a);
        if (!nb || seen.has(nb)) { if (nb && !nb.vis) horizon.push([a, b]); continue; }
        if (dot(nb.n, P[p]) - nb.d > eps) { nb.vis = true; seen.add(nb); visible.push(nb); } else horizon.push([a, b]);
      }
    }
    const orphans = [];
    for (const f of visible) {
      f.alive = false;
      for (let k = 0; k < 3; k++) { const key = f.v[k] * K + f.v[(k + 1) % 3]; if (edges.get(key) === f) edges.delete(key); use(f.v[k], -1); }
      for (const i of f.out) if (i !== p) orphans.push(i);
    }
    const fresh = horizon.filter(([a, b]) => !edges.has(a * K + b)).map(([a, b]) => make(a, b, p));
    assign(orphans, fresh);
    faces = faces.filter((f) => f.alive).concat(fresh);
  }
  // Merge connected coplanar triangles into polygons (flood fill across shared edges).
  const planes = [];
  for (const f of faces) {
    if (f.group) continue;
    const p = { n: f.n, d: f.d, ids: new Set() };
    f.group = p;
    const stack = [f];
    while (stack.length) {
      const g = stack.pop();
      g.v.forEach((v) => p.ids.add(v));
      for (let k = 0; k < 3; k++) {
        const nb = edges.get(g.v[(k + 1) % 3] * K + g.v[k]);
        if (nb && !nb.group && dot(nb.n, p.n) > 0 && nb.v.every((v) => Math.abs(dot(p.n, P[v]) - p.d) <= 10 * eps)) { nb.group = p; stack.push(nb); }
      }
    }
    planes.push(p);
  }
  // Each face's boundary: the 2D convex hull of its points (interior and collinear points dropped),
  // counter-clockwise about the normal.
  const loops = planes.map((p) => {
    const ids = [...p.ids];
    const c = scale(ids.reduce((s, i) => add(s, P[i]), [0, 0, 0]), 1 / ids.length);
    const ref = Math.abs(p.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let u = cross(p.n, ref); u = scale(u, 1 / norm(u));
    const w = cross(p.n, u);
    const pts = ids.map((i) => ({ i, x: dot(sub(P[i], c), u), y: dot(sub(P[i], c), w) })).sort((a, b) => a.x - b.x || a.y - b.y);
    const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (list) => {
      const h = [];
      for (const q of list) { while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= eps * eps) h.pop(); h.push(q); }
      h.pop();
      return h;
    };
    return { n: p.n, d: p.d, ids: [...half(pts), ...half([...pts].reverse())].map((q) => q.i) };
  }).filter((l) => l.ids.length >= 3);
  const used = [...new Set(loops.flatMap((l) => l.ids))].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  const verts = used.map((v) => P[v]);
  const out = loops.map((l) => ({ n: l.n, d: l.d, v: l.ids.map((v) => remap.get(v)) }));
  return { verts, faces: out };
}

// Hull sample points of the analytic shapes (the Newton exporter's).
function shapePoints(type, s) {
  const pts = [];
  if (type === GT.BOX) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push([x * s[0], y * s[1], z * s[2]]);
  } else if (type === GT.CYLINDER) {
    for (const z of [-s[1], s[1]]) for (let i = 0; i < 24; i++) { const a = (i * 2 * Math.PI) / 24; pts.push([s[0] * Math.cos(a), s[0] * Math.sin(a), z]); }
  } else if (type === GT.CAPSULE) {
    for (const [z0, sg] of [[s[1], 1], [-s[1], -1]]) {
      for (let e = 0; e < 4; e++) {
        const el = (e * Math.PI) / 6;
        for (let k = 0; k < 12; k++) { const az = (k * 2 * Math.PI) / 12; pts.push([s[0] * Math.cos(el) * Math.cos(az), s[0] * Math.cos(el) * Math.sin(az), z0 + sg * s[0] * Math.sin(el)]); }
      }
    }
  } else if (type === GT.SPHERE) {
    for (let e = 0; e < 7; e++) {
      const el = -Math.PI / 2 + (e * Math.PI) / 6;
      for (let k = 0; k < 12; k++) { const az = (k * 2 * Math.PI) / 12; pts.push([s[0] * Math.cos(el) * Math.cos(az), s[0] * Math.cos(el) * Math.sin(az), s[0] * Math.sin(el)]); }
    }
  }
  return pts.map((p) => p.map((v) => Math.round(v * 1e9) / 1e9));
}

// Mass, center of mass and inertia about it (shape frame) of a solid shape of unit density.
// framefields: r is a box's border radius (s is then its core).
function massProps(type, s, hull, r = 0) {
  const diag = (m, a, b, c) => ({ m, c: [0, 0, 0], I: [a, 0, 0, 0, b, 0, 0, 0, c] });
  if (type === GT.BOX && r > 0) {
    const { m, S } = roundedBoxMoments(s, r);
    return diag(m, S[1] + S[2], S[0] + S[2], S[0] + S[1]);
  }
  if (type === GT.BOX) {
    const m = 8 * s[0] * s[1] * s[2];
    return diag(m, (m / 3) * (s[1] ** 2 + s[2] ** 2), (m / 3) * (s[0] ** 2 + s[2] ** 2), (m / 3) * (s[0] ** 2 + s[1] ** 2));
  }
  if (type === GT.SPHERE) { const m = (4 / 3) * Math.PI * s[0] ** 3; const i = 0.4 * m * s[0] ** 2; return diag(m, i, i, i); }
  if (type === GT.CYLINDER) {
    const m = Math.PI * s[0] ** 2 * 2 * s[1];
    const t = m * (3 * s[0] ** 2 + 4 * s[1] ** 2) / 12;
    return diag(m, t, t, 0.5 * m * s[0] ** 2);
  }
  if (type === GT.CAPSULE) {
    const r = s[0], L = 2 * s[1];
    const mc = Math.PI * r * r * L, ms = (4 / 3) * Math.PI * r ** 3;
    const t = mc * (L * L / 12 + r * r / 4) + ms * (0.4 * r * r + L * L / 4 + 3 * L * r / 8);
    return diag(mc + ms, t, t, 0.5 * mc * r * r + 0.4 * ms * r * r);
  }
  // Convex hull: tetrahedra from an interior point over each face fan.
  const o = scale(hull.verts.reduce((a, v) => add(a, v), [0, 0, 0]), 1 / hull.verts.length);
  let m = 0, c = [0, 0, 0];
  const C = new Array(9).fill(0);  // second moment about o
  for (const f of hull.faces) {
    for (let k = 1; k + 1 < f.v.length; k++) {
      const a = sub(hull.verts[f.v[0]], o), b = sub(hull.verts[f.v[k]], o), d = sub(hull.verts[f.v[k + 1]], o);
      const vol = dot(a, cross(b, d)) / 6;
      m += vol;
      c = add(c, scale(add(add(a, b), d), vol / 4));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        C[i * 3 + j] += (vol / 20) * (2 * (a[i] * a[j] + b[i] * b[j] + d[i] * d[j]) + a[i] * b[j] + a[j] * b[i] + a[i] * d[j] + a[j] * d[i] + b[i] * d[j] + b[j] * d[i]);
      }
    }
  }
  c = scale(c, 1 / m);
  const tr = C[0] + C[4] + C[8];
  const I = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => (i === j ? tr : 0) - C[i * 3 + j]));
  // Shift from o to the COM.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i * 3 + j] -= m * ((i === j ? dot(c, c) : 0) - c[i] * c[j]);
  return { m, c: add(c, o), I };
}

// framefields: volume and second moments [∫x², ∫y², ∫z²] of a box of core half sizes h swept by a
// sphere of radius r: three slabs over the core (counted once), twelve quarter cylinders along the
// edges and eight sphere octants at the corners.
function roundedBoxMoments(h, r) {
  let m = 0;
  const S = [0, 0, 0];
  const box = (e, k) => {
    const v = 8 * e[0] * e[1] * e[2];
    m += k * v;
    for (let i = 0; i < 3; i++) S[i] += (k * v * e[i] ** 2) / 3;
  };
  for (let i = 0; i < 3; i++) box(h.map((v, j) => (j === i ? v + r : v)), 1);
  box(h, -2);
  // Quarter disc of radius r: area q, first and second moments along one of its sides.
  const q = (Math.PI * r * r) / 4, q1 = (r ** 3) / 3, q2 = (Math.PI * r ** 4) / 16;
  for (let i = 0; i < 3; i++) {
    const [j, k] = [(i + 1) % 3, (i + 2) % 3];
    const L = 2 * h[i];
    m += 4 * q * L;
    S[i] += (4 * q * L * h[i] ** 2) / 3;
    S[j] += 4 * L * (h[j] ** 2 * q + 2 * h[j] * q1 + q2);
    S[k] += 4 * L * (h[k] ** 2 * q + 2 * h[k] * q1 + q2);
  }
  // Sphere octant: volume, first and second moments along an axis.
  const o = (Math.PI * r ** 3) / 6, o1 = (Math.PI * r ** 4) / 16, o2 = (Math.PI * r ** 5) / 30;
  m += 8 * o;
  for (let i = 0; i < 3; i++) S[i] += 8 * (h[i] ** 2 * o + 2 * h[i] * o1 + o2);
  return { m, S };
}

// --- builder ---------------------------------------------------------------------------------
export class SceneBuilder {
  constructor({ gravity = [0, 0, -9.81], fps = 60 } = {}) {
    this.gravity = gravity;
    this.fps = fps;
    this.bodies = [];
    this.shapes = [];
    this.joints = [];
    this.filters = [];
    this.visuals = [];
  }

  // A rigid body. mass/com/inertia (3x3 row-major, about the COM) override the shapes' densities.
  // A body that never becomes a joint child is free and starts at xform with twist [v, w].
  // framefields: gravityScale, linearDamping (1/s) and planar (world xy only, turning about z).
  addBody({ xform = IDENTITY, mass, com, inertia, label, kinematic = false, gravity = true, twist = [0, 0, 0, 0, 0, 0], gravityScale = 1, linearDamping = 0, angularDamping, planar = false } = {}) {
    this.bodies.push({ xform: [...xform], mass, com, inertia, label: label ?? `body_${this.bodies.length}`, kinematic, gravity, twist, gravityScale, linearDamping, angularDamping, planar });
    return this.bodies.length - 1;
  }

  // framefields: a body's mass (kg) as finalize() will give it: its own, or its shapes' densities.
  massOf(body) {
    const b = this.bodies[body];
    if (b.mass !== undefined) return b.mass;
    let m = 0;
    for (const s of this.shapes) if (s.body === body && s.type !== GT.PLANE && s.type !== GT.MESH) m += s.o.density * massProps(s.type, s.size, s.hull, s.round).m;
    return m;
  }

  // Set a body's mass, COM (body frame) and inertia about it (3x3 row-major, body frame).
  setBodyInertia(body, { mass, com, inertia }) { Object.assign(this.bodies[body], { mass, com, inertia }); }

  addShape(body, type, size, opts = {}, hullPoints = null, maxVertices = Infinity) {
    const o = { ...SHAPE_DEFAULTS, ...opts };
    const hull = type === GT.PLANE ? null : convexHull(hullPoints ?? shapePoints(type, size), maxVertices);
    this.shapes.push({ body, type, size, xform: [...(o.xform ?? IDENTITY)], hull, o });
    return this.shapes.length - 1;
  }

  // framefields: radius rounds the box's edges and corners (half sizes stay the outer ones).
  addShapeBox(body, { hx = 0.5, hy = 0.5, hz = 0.5, radius = 0, ...o } = {}) {
    if (!(radius >= 0 && radius < Math.min(hx, hy, hz))) throw new Error(`addShapeBox: radius ${radius} must be under the smallest half size`);
    const s = this.addShape(body, GT.BOX, [hx - radius, hy - radius, hz - radius], o);
    this.shapes[s].round = radius;
    return s;
  }
  addShapeSphere(body, { radius = 0.5, ...o } = {}) { return this.addShape(body, GT.SPHERE, [radius, 0, 0], o); }
  // Capsule and cylinder axes are the shape's z.
  addShapeCapsule(body, { radius = 0.05, halfHeight = 0.5, ...o } = {}) { return this.addShape(body, GT.CAPSULE, [radius, halfHeight, 0], o); }
  addShapeCylinder(body, { radius = 0.05, halfHeight = 0.5, ...o } = {}) { return this.addShape(body, GT.CYLINDER, [radius, halfHeight, 0], o); }
  // Convex hull of `vertices` ([[x, y, z], ...] or a flat array), in the shape frame.
  // framefields: at most maxVertices of them (Infinity keeps every hull vertex).
  addShapeConvexHull(body, { vertices, maxVertices = MAX_HULL_VERTICES, ...o }) {
    const pts = Array.isArray(vertices[0]) ? vertices : Array.from({ length: vertices.length / 3 }, (_, i) => [vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]]);
    return this.addShape(body, GT.CONVEX_MESH, [1, 1, 1], o, pts, maxVertices);
  }
  // framefields: a triangle mesh collider (terrain, sculptures): vertices ([[x, y, z], ...] or flat) and
  // indices (three per triangle) in the shape frame. It collides as its triangles, from both sides, and
  // only on a static or kinematic body (a mesh has no volume to weigh).
  addShapeMesh(body, { vertices, indices, ...opts }) {
    const verts = Float32Array.from(Array.isArray(vertices[0]) ? vertices.flat() : vertices);
    const idx = Uint32Array.from(indices);
    if (idx.length === 0 || idx.length % 3) throw new Error('addShapeMesh: indices come three per triangle');
    for (const i of idx) if (i >= verts.length / 3) throw new Error(`addShapeMesh: index ${i} past the ${verts.length / 3} vertices`);
    const o = { ...SHAPE_DEFAULTS, ...opts };
    this.shapes.push({ body, type: GT.MESH, size: [1, 1, 1], xform: [...(o.xform ?? IDENTITY)], hull: null, mesh: { verts, idx }, o });
    return this.shapes.length - 1;
  }
  // Static infinite plane, normal along the shape's z.
  addGroundPlane({ height = 0, ...o } = {}) { return this.addShape(-1, GT.PLANE, [0, 0, 0], { xform: [0, 0, height, 0, 0, 0, 1], ...o }); }
  // Render-only triangle mesh (no collision).
  addVisualMesh(body, { vertices, indices, xform = IDENTITY, color = [0.7, 0.7, 0.7] }) {
    this.visuals.push({ body, vertices: Float32Array.from(vertices.flat?.() ?? vertices), indices: Uint32Array.from(indices), xform, color });
  }
  // framefields: a rope from anchorA on bodyA to anchorB on bodyB (body frames; body -1 is the world):
  // never longer than length, slack when shorter. The solver keeps it as a one-sided distance row.
  addRope(bodyA, bodyB, { anchorA = [0, 0, 0], anchorB = [0, 0, 0], length }) {
    if (!(length >= 0)) throw new Error('addRope: length must be 0 or more');
    if (bodyA === bodyB) throw new Error('addRope: a rope joins two bodies');
    this.ropes ??= [];
    this.ropes.push({ a: bodyA, b: bodyB, pa: [...anchorA], pb: [...anchorB], length });
    return this.ropes.length - 1;
  }
  // framefields: a spring from anchorA on bodyA to anchorB on bodyB (body frames; -1 the world) with rest
  // length, stiffness (N/m) and damping (N s/m) along its line, solved implicitly (soft rows).
  addSpring(bodyA, bodyB, { anchorA = [0, 0, 0], anchorB = [0, 0, 0], restLength, stiffness, damping = 0 }) {
    if (!(restLength >= 0 && stiffness > 0 && damping >= 0)) throw new Error('addSpring: needs restLength >= 0, stiffness > 0, damping >= 0');
    if (bodyA === bodyB) throw new Error('addSpring: a spring joins two bodies');
    this.springs ??= [];
    this.springs.push({ a: bodyA, b: bodyB, pa: [...anchorA], pb: [...anchorB], rest: restLength, ke: stiffness, kd: damping });
    return this.springs.length - 1;
  }
  // Keep two shapes from colliding.
  addCollisionFilter(shapeA, shapeB) { this.filters.push([shapeA, shapeB]); }

  addJoint(type, parent, child, { parentXform = IDENTITY, childXform = IDENTITY, axes = [], linear = 0, q, label, collisionFilterParent = true, dofs, ...dof } = {}) {
    this.joints.push({ type, parent, child, Xp: [...parentXform], Xc: [...childXform], axes, linear, q, label, filter: collisionFilterParent,
      dofs: dofs ?? axes.map(() => ({ ...DOF_DEFAULTS, ...dof })), mimic: null });
    return this.joints.length - 1;
  }
  // Scalar joints take Newton's dof settings: limitLower/Upper, targetPos/Vel, targetKe/Kd, damping,
  // armature, effortLimit, velocityLimit, friction, and the initial coordinate q.
  addJointRevolute(parent, child, { axis = [1, 0, 0], ...o } = {}) { return this.addJoint(JT.REVOLUTE, parent, child, { axes: [axis], ...o }); }
  addJointPrismatic(parent, child, { axis = [1, 0, 0], ...o } = {}) { return this.addJoint(JT.PRISMATIC, parent, child, { axes: [axis], linear: 1, ...o }); }
  addJointBall(parent, child, o = {}) { return this.addJoint(JT.BALL, parent, child, { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ...o }); }
  addJointFixed(parent, child, o = {}) { return this.addJoint(JT.FIXED, parent, child, o); }
  // D6 joint: linearAxes then angularAxes (up to three each), each an axis [x, y, z] or
  // { axis, ...dof settings }; q is the initial coordinate per axis.
  addJointD6(parent, child, { linearAxes = [], angularAxes = [], ...o } = {}) {
    const { parentXform, childXform, q, label, collisionFilterParent, ...shared } = o;
    const entries = [...linearAxes, ...angularAxes].map((e) => (Array.isArray(e) ? { axis: e } : e));
    return this.addJoint(JT.D6, parent, child, { parentXform, childXform, q, label, collisionFilterParent,
      axes: entries.map((e) => e.axis), linear: linearAxes.length,
      dofs: entries.map(({ axis, ...cfg }) => ({ ...DOF_DEFAULTS, ...shared, ...cfg })) });
  }
  // Change dof settings of an existing joint (e.g. drive gains from an actuator).
  setJointDofConfig(joint, axisIndex, cfg) { Object.assign(this.joints[joint].dofs[axisIndex], cfg); }
  // Newton's set_joint_mimic: joint's coordinates follow coeffs[0] + coeffs[1] * reference's.
  setJointMimic(joint, reference, coeffs = [0, 1]) {
    this.joints[joint].mimic = reference === null ? null : { reference, coeffs: [...coeffs] };
  }
  // Free joint (a floating base); bodies without a parent joint get one automatically.
  addJointFree(child, o = {}) { return this.addJoint(JT.FREE, -1, child, { axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]], linear: 3, ...o }); }

  // Newton dof index of a joint's first dof, valid after finalize().
  jointDof(joint) { return this.dofOf[joint]; }

  finalize({ solver = {} } = {}) {
    const NB = this.bodies.length;
    const parentJoint = new Array(NB).fill(-1);
    const loop = new Set();
    this.joints.forEach((j, i) => {
      if (j.child < 0 || j.child >= NB) throw new Error(`joint ${i}: bad child body ${j.child}`);
      if (parentJoint[j.child] >= 0) loop.add(i); else parentJoint[j.child] = i;
    });
    // Final joint order: per root body, its (possibly implicit free) joint, then the user's tree joints
    // in insertion order; loop closures last. Parents must be added before their children.
    const order = [];
    const art = [];
    const implicit = [];
    const placed = new Set();
    const rootOf = (b) => { let r = b, n = 0; while (parentJoint[r] >= 0 && this.joints[parentJoint[r]].parent >= 0 && n++ < NB) r = this.joints[parentJoint[r]].parent; return r; };
    const roots = [...new Set([...Array(NB).keys()].map(rootOf))].sort((a, b) => a - b);
    roots.forEach((r, a) => {
      if (parentJoint[r] < 0) {
        implicit.push({ type: JT.FREE, parent: -1, child: r, Xp: IDENTITY, Xc: IDENTITY, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]], linear: 3, label: `${this.bodies[r].label}_free`, dofs: new Array(6).fill(DOF_DEFAULTS), mimic: null });
        order.push(-implicit.length);
        art.push(a);
      }
      this.joints.forEach((j, i) => {
        if (loop.has(i) || rootOf(j.child) !== r) return;
        if (j.parent >= 0 && !placed.has(j.parent) && rootOf(j.parent) === r && parentJoint[j.parent] >= 0 && !order.includes(parentJoint[j.parent])) {
          throw new Error(`joint ${i}: add the joint of parent body ${j.parent} before its children`);
        }
        order.push(i); art.push(a); placed.add(j.child);
      });
      placed.add(r);
    });
    for (const i of loop) { order.push(i); art.push(-1); }
    const jointAt = (k) => (k < 0 ? implicit[-k - 1] : this.joints[k]);

    // Joint arrays and initial coordinates.
    const J = { type: [], parent: [], child: [], X_p: [], X_c: [], axis: [], dof_dim: [], q_start: [0], qd_start: [0], articulation: art,
      q: [], qd: [], armature: [], ke: [], kd: [], effort: [], lower: [], upper: [], vel_limit: [], friction: [], passive_damping: [],
      target_q: [], target_qd: [], mimic_joint: [], mimic_coeffs: [], friction_load_coefficient: [], label: [] };
    this.dofOf = [];
    order.forEach((k, idx) => {
      const j = jointAt(k);
      if (k >= 0) this.dofOf[k] = J.qd_start[idx];
      const ndof = j.axes.length;
      const scalar = j.type === JT.REVOLUTE || j.type === JT.PRISMATIC || j.type === JT.D6;
      let q = [];
      if (j.type === JT.FREE) q = [...this.bodies[j.child].xform];
      else if (j.type === JT.BALL) q = j.q ?? [0, 0, 0, 1];
      else if (scalar) q = [j.q ?? 0].flat().concat(new Array(ndof).fill(0)).slice(0, ndof);
      J.type.push(j.type); J.parent.push(j.parent); J.child.push(j.child);
      J.X_p.push(j.Xp); J.X_c.push(j.Xc);
      J.dof_dim.push([j.linear, ndof - j.linear]);
      J.q.push(...q); J.target_q.push(...(scalar ? j.dofs.map((d) => d.targetPos) : q.map(() => 0)));
      J.q_start.push(J.q.length);
      J.qd.push(...(j.type === JT.FREE ? this.bodies[j.child].twist : new Array(ndof).fill(0)));
      j.axes.forEach((ax, a) => {
        const d = j.dofs[a];
        J.axis.push(ax); J.armature.push(d.armature); J.ke.push(d.targetKe); J.kd.push(d.targetKd);
        J.effort.push(d.effortLimit); J.lower.push(d.limitLower); J.upper.push(d.limitUpper);
        J.vel_limit.push(d.velocityLimit); J.friction.push(d.friction); J.passive_damping.push(d.damping);
        J.target_qd.push(d.targetVel);
      });
      J.qd_start.push(J.axis.length);
      J.mimic_joint.push(-1); J.mimic_coeffs.push(j.mimic ? j.mimic.coeffs : [0, 1]);
      J.label.push(j.label ?? `joint_${idx}`);
    });
    J.count = order.length;
    const finalIndex = new Map(order.map((k, idx) => [k, idx]));
    order.forEach((k, idx) => { const m = jointAt(k).mimic; if (m) J.mimic_joint[idx] = finalIndex.get(m.reference); });

    // Forward kinematics for the initial body poses.
    const pose = this.bodies.map((b) => [...b.xform]);
    order.forEach((k, idx) => {
      if (art[idx] < 0) return;
      const j = jointAt(k);
      if (j.type === JT.FREE) return;
      const qs = J.q_start[idx];
      let T = IDENTITY;
      if (j.type === JT.REVOLUTE) T = [0, 0, 0, ...qaxis(j.axes[0], J.q[qs])];
      else if (j.type === JT.PRISMATIC) T = [...scale(j.axes[0], J.q[qs] / norm(j.axes[0])), 0, 0, 0, 1];
      else if (j.type === JT.BALL) T = [0, 0, 0, ...J.q.slice(qs, qs + 4)];
      else if (j.type === JT.D6) {
        // Newton: translations along the linear axes, then rotations q2 q1 q0 about axes carried
        // through the rotations before them.
        let p = [0, 0, 0], r = [0, 0, 0, 1];
        for (let a = 0; a < j.linear; a++) p = add(p, scale(j.axes[a], J.q[qs + a]));
        for (let a = j.linear; a < j.axes.length; a++) {
          const ax = qrot(r, scale(j.axes[a], 1 / norm(j.axes[a])));
          r = qmul(qaxis(ax, J.q[qs + a]), r);
        }
        T = [...p, ...r];
      }
      const Xwp = j.parent >= 0 ? pose[j.parent] : IDENTITY;
      pose[j.child] = tmul(tmul(tmul(Xwp, j.Xp), T), tinv(j.Xc));
    });

    // Mass properties from the shapes unless given.
    const bodies = { count: NB, mass: [], inertia: [], com: [], q: pose, twist: [], label: [], kinematic: [], no_gravity: [], gravity_scale: [], linear_damping: [], angular_damping: [], planar: [] };
    this.bodies.forEach((b, i) => {
      let m = 0, c = [0, 0, 0];
      const parts = [];
      for (const s of this.shapes) {
        if (s.body !== i || s.type === GT.PLANE || s.type === GT.MESH || !(s.o.mass > 0 || s.o.density > 0)) continue;
        const p = massProps(s.type, s.size, s.hull, s.round);
        const rho = s.o.mass > 0 ? s.o.mass / p.m : s.o.density;
        const pm = p.m * rho;
        const pc = add(s.xform.slice(0, 3), qrot(s.xform.slice(3), p.c));
        parts.push({ m: pm, c: pc, I: p.I.map((v) => v * rho), R: qmat(s.xform.slice(3)) });
        m += pm; c = add(c, scale(pc, pm));
      }
      c = m > 0 ? scale(c, 1 / m) : [0, 0, 0];
      const I = new Array(9).fill(0);
      for (const p of parts) {
        const d = sub(p.c, c);
        for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) {
          let v = 0;
          for (let a = 0; a < 3; a++) for (let e = 0; e < 3; e++) v += p.R[r * 3 + a] * p.I[a * 3 + e] * p.R[s * 3 + e];
          I[r * 3 + s] += v + p.m * ((r === s ? dot(d, d) : 0) - d[r] * d[s]);
        }
      }
      bodies.mass.push(b.mass ?? m);
      bodies.com.push(b.com ?? c);
      bodies.inertia.push(b.inertia ?? (b.mass !== undefined && m > 0 ? I.map((v) => (v * b.mass) / m) : I));
      bodies.twist.push(b.twist); bodies.label.push(b.label);
      bodies.kinematic.push(b.kinematic); bodies.no_gravity.push(!b.gravity);
      bodies.gravity_scale.push(b.gravityScale); bodies.linear_damping.push(b.linearDamping); bodies.angular_damping.push(b.angularDamping ?? 0.05); bodies.planar.push(b.planar);
    });

    // Binary blob: hull geometry and visual meshes.
    const chunks = [];
    let size = 0;
    const put = (arr) => { const off = size; chunks.push(arr); size += arr.byteLength; return { off, n: arr.length }; };
    const shapes = [];
    const index = new Map();
    this.shapes.forEach((s, sid) => {
      const o = s.o;
      const entry = { sid, body: s.body, xf: s.xform, type: s.type, color: o.color, mu: o.mu, gap: o.gap, restitution: o.restitution,
        mu_torsional: o.muTorsional, mu_rolling: o.muRolling, group: o.collisionGroup, condim: 3, ke: o.ke, kd: o.kd,
        torsion_radius: 0, world: o.world, round: s.round ?? 0 };
      if (s.type === GT.PLANE) entry.plane = true;
      else if (s.type === GT.MESH) {
        // framefields: the solver builds a hull per triangle and a BVH over them.
        if (s.body >= 0 && !this.bodies[s.body].kinematic) throw new Error(`shape ${sid}: a triangle mesh needs a static or kinematic body`);
        entry.mesh = { verts: put(s.mesh.verts), idx: put(s.mesh.idx) };
      } else {
        const fv = [], fstart = [], fn = [];
        for (const f of s.hull.faces) { fstart.push(fv.length); fv.push(...f.v); fn.push(...f.n, f.d); }
        entry.hull = { verts: put(Float32Array.from(s.hull.verts.flat())), face_planes: put(Float32Array.from(fn)),
          face_start: put(Uint32Array.from([...fstart, fv.length])), face_verts: put(Uint32Array.from(fv)), nv: s.hull.verts.length, nf: s.hull.faces.length };
        if (s.type === GT.SPHERE) entry.prim = { kind: 1, r: s.size[0], h: 0 };
        if (s.type === GT.CAPSULE) entry.prim = { kind: 2, r: s.size[0], h: s.size[1] };
      }
      index.set(sid, shapes.length);
      shapes.push(entry);
    });
    const visuals = this.visuals.map((v) => ({ body: v.body, xf: v.xform, color: v.color, mesh: { v: put(v.vertices), i: put(v.indices) } }));
    // Newton's collision_filter_parent: a joint's two bodies do not collide.
    const pairs = new Set(this.filters.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join()));
    for (const j of this.joints) {
      if (!j.filter || j.parent < 0) continue;
      this.shapes.forEach((sa, a) => this.shapes.forEach((sb, b) => {
        if (a < b && ((sa.body === j.parent && sb.body === j.child) || (sa.body === j.child && sb.body === j.parent))) pairs.add(`${a},${b}`);
      }));
    }
    const targets = put(new Float32Array(0));
    const bin = new ArrayBuffer(size);
    let at = 0;
    for (const c of chunks) { new Uint8Array(bin, at, c.byteLength).set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength)); at += c.byteLength; }
    const s = { substeps: 4, iterations: 12, enable_joint_limits: true, ...solver };
    const json = {
      gravity: this.gravity, fps: this.fps, substeps: s.substeps, iterations: s.iterations, bodies, joints: J, shapes, visuals, ropes: this.ropes ?? [], springs: this.springs ?? [],
      filters: [...pairs].map((p) => p.split(',').map(Number)).map(([a, b]) => [index.get(a), index.get(b)]),
      mimics: [], targets, target_frames: 0, driven: 0, integral_count: 0, demo: 'built', control: null, solver: s, info: {},
      joint_type_names: { ...JT }, geo_type_names: { ...GT },
    };
    return { json, bin, f32: (r) => new Float32Array(bin, r.off, r.n), u32: (r) => new Uint32Array(bin, r.off, r.n) };
  }
}
