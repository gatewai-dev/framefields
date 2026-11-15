// WebGPU port of SolverSteel's colored articulated contact path.
import { BUFFER_NAMES, shapesWGSL, broadWGSL, argsWGSL, narrowWGSL, csortWGSL, prepareWGSL, solveWGSL } from './wgsl.js';

export { SceneBuilder, convexHull, MAX_HULL_VERTICES } from './builder.js';
export { loadURDF, loadMJCF, loadUSDA, parseUSDA, parseSTL, parseOBJ, fetchMesh, quatRpy } from './loaders.js';

const COMBINE = ['average', 'min', 'multiply', 'max'];
const JT = { PRISMATIC: 0, REVOLUTE: 1, BALL: 2, FIXED: 3, FREE: 4, DISTANCE: 5, D6: 6 };
const LB = 268;
const L_V = 147;  // link record: spatial velocity (artwgsl.js)
const MAX_SUBSTEPS = 32;
// framefields: the GPU buffers that hold state from one step to the next.
const SNAPSHOT_BUFFERS = ['poses', 'vel', 'art', 'warm'];
const PIPELINES = new WeakMap();  // device -> compiled kernels by source
// Kernels of one substep, in dispatch order.
export const KERNELS = ['shapes', 'broad', 'args', 'narrow', 'csort', 'prepare', 'solve'];

function quatRotate(q, v) {
  const [x, y, z, w] = q;
  const ux = 2 * (x * v[0] + y * v[1] + z * v[2]);
  const s2 = w * w - (x * x + y * y + z * z);
  const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
  return [ux * x + s2 * v[0] + 2 * w * cx, ux * y + s2 * v[1] + 2 * w * cy, ux * z + s2 * v[2] + 2 * w * cz];
}

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-30) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

// framefields: a BVH over a mesh's triangles (median splits on the widest centroid axis, up to four
// triangles a leaf). tris are the triangles' corners in leaf order; degenerate triangles are dropped.
function meshBVH(v, idx) {
  const tris = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const p = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
    const e1 = p[1].map((x, k) => x - p[0][k]), e2 = p[2].map((x, k) => x - p[0][k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(...n) > 1e-12) tris.push(p);
  }
  if (!tris.length) throw new Error('a triangle mesh needs a triangle with area');
  const order = [...tris.keys()];
  const cen = tris.map((p) => [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3));
  const nodes = [{}];
  const bounds = (a, b) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = a; i < b; i++) for (const p of tris[order[i]]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    return { lo, hi };
  };
  const stack = [[0, 0, tris.length]];
  while (stack.length) {
    const [ni, a, b] = stack.pop();
    const box = bounds(a, b);
    if (b - a <= 4) { nodes[ni] = { ...box, first: a, count: b - a }; continue; }
    const clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity];
    for (let i = a; i < b; i++) for (let k = 0; k < 3; k++) { clo[k] = Math.min(clo[k], cen[order[i]][k]); chi[k] = Math.max(chi[k], cen[order[i]][k]); }
    const ax = [0, 1, 2].reduce((m, k) => (chi[k] - clo[k] > chi[m] - clo[m] ? k : m), 0);
    const part = order.slice(a, b).sort((x, y) => cen[x][ax] - cen[y][ax]);
    order.splice(a, b - a, ...part);
    const mid = (a + b) >> 1, left = nodes.length;
    nodes.push({}, {});
    nodes[ni] = { ...box, first: left, count: 0 };
    stack.push([left, a, mid], [left + 1, mid, b]);
  }
  return { tris: order.map((i) => tris[i]), nodes };
}

// framefields: a triangle as a flat hull: three vertices, its two sides as faces.
function triangleHull(p) {
  const e1 = p[1].map((x, k) => x - p[0][k]), e2 = p[2].map((x, k) => x - p[0][k]);
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n);
  n = n.map((x) => x / l);
  const d = n[0] * p[0][0] + n[1] * p[0][1] + n[2] * p[0][2];
  return { verts: Float32Array.from(p.flat()), face_planes: Float32Array.from([...n, d, -n[0], -n[1], -n[2], -d]),
    face_start: Uint32Array.from([0, 3, 6]), face_verts: Uint32Array.from([0, 1, 2, 0, 2, 1]), nv: 3, nf: 2 };
}

// Shared visual meshes (content-addressed, so never stale) are fetched once per page.
const SHARED = new Map();
const fetchShared = (url) => {
  if (!SHARED.has(url)) SHARED.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); }));
  return SHARED.get(url);
};

export async function loadScene(base) {
  const [json, bin] = await Promise.all([
    fetch(`${base}/scene.json`).then((r) => r.json()),
    fetch(`${base}/scene.bin`).then((r) => r.arrayBuffer()),
  ]);
  const f32 = (r) => new Float32Array(bin, r.off, r.n);
  const u32 = (r) => new Uint32Array(bin, r.off, r.n);
  const files = new Map();
  const urls = [...new Set(json.visuals.map((v) => v.mesh?.file).filter(Boolean))];
  await Promise.all(urls.map(async (u) => files.set(u, await fetchShared(`${base}/${u}`))));
  // A visual mesh's positions, indices and UVs, from scene.bin or a shared file.
  const mesh = (m) => {
    if (!m.file) return { pos: f32(m.v), idx: u32(m.i), uv: m.uv ? f32(m.uv) : null };
    const buf = files.get(m.file);
    const pos = new Float32Array(buf, 0, m.nv * 3);
    const io = m.nv * 12;
    const idx = m.index === 'u16' ? new Uint16Array(buf, io, m.ni) : new Uint32Array(buf, io, m.ni);
    const uo = io + Math.ceil((m.ni * (m.index === 'u16' ? 2 : 4)) / 4) * 4;
    return { pos, idx, uv: m.uv ? new Float32Array(buf, uo, m.nv * 2) : null };
  };
  return { json, bin, f32, u32, mesh, base };
}

export class Sim {
  constructor(device, scene, opts = {}) {
    this.device = device;
    this.scene = scene;
    // contact_regularization: Steel's dimensionless g, w = 1 / (1 + g) on loaded normal rows.
    // Warm start is off by default, as in Steel.
    // contact_regularization from the scene's solver block (Steel's name) overrides the port default.
    // An option passed as undefined keeps the scene's value.
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
    this.opts = { substeps: scene.json.substeps, iterations: scene.json.iterations, regularization: scene.json.solver?.contact_regularization ?? 0.0, ...given };
    if (this.opts.substeps > MAX_SUBSTEPS) throw new Error(`at most ${MAX_SUBSTEPS} substeps`);
    this.build();
  }

  // Like new Sim, but compiles the kernels in parallel off the main thread; resolves when ready.
  static async create(device, scene, opts = {}) {
    const sim = new Sim(device, scene, { ...opts, asyncCompile: true });
    await sim.ready;
    return sim;
  }

  // Frees every GPU resource the Sim created; the device stays with its owner.
  destroy() {
    for (const b of Object.values(this.buffers)) b.destroy();
    for (const p of this.params) p.buf.destroy();
    for (const b of this.posePool ?? []) b.destroy();
    for (const pool of this.readPool?.values() ?? []) for (const b of pool) b.destroy();
    this.posePool = [];
    this.readPool = new Map();
    this.queryBuf?.destroy(); this.querySet?.destroy();
  }

  build() {
    const { json: S } = this.scene;
    // framefields: hulls built here (mesh triangles) hold their arrays, not ranges of the scene blob.
    const f32 = (r) => (ArrayBuffer.isView(r) ? r : this.scene.f32(r));
    const u32 = (r) => (ArrayBuffer.isView(r) ? r : this.scene.u32(r));
    const NB = S.bodies.count;
    const J = S.joints;
    // Body -> joint, articulations.
    const jointOfBody = new Array(NB).fill(-1);
    for (let j = 0; j < J.count; j++) jointOfBody[J.child[j]] = j;
    const artJoints = new Map();
    for (let j = 0; j < J.count; j++) {
      const a = J.articulation[j];
      if (!artJoints.has(a)) artJoints.set(a, []);
      artJoints.get(a).push(j);
    }
    const bodyKind = new Array(NB).fill(1), bodyArt = new Array(NB).fill(-1), bodyLink = new Array(NB).fill(-1);
    const arts = []; const links = []; const dofs = [];
    const SO = { ...S.solver, ...this.opts.solver };
    const limitsOn = SO.enable_joint_limits ?? false;
    const q0 = [], tq0 = [], tqd0 = [];
    const qMap = new Map(), dofMap = new Map();  // Newton coordinate/dof -> port index
    const loops = [];
    for (const [art, js] of artJoints) {
      if (art < 0) { loops.push(...js); continue; }
      if (js.length === 1 && (J.type[js[0]] === JT.FREE || J.type[js[0]] === JT.DISTANCE)) continue;
      const a = arts.length;
      const linkStart = links.length, dofStart = dofs.length;
      const localLink = new Map();
      for (const j of js) {
        // Steel steps DISTANCE joints as FREE ones (their distance limits are not enforced there).
        const t = J.type[j] === JT.DISTANCE ? JT.FREE : J.type[j];
        const b = J.child[j];
        const l = links.length;
        localLink.set(b, l);
        const parentLink = J.parent[j] >= 0 ? localLink.get(J.parent[j]) : -1;
        if (t !== JT.FIXED && t !== JT.REVOLUTE && t !== JT.PRISMATIC && t !== JT.BALL && t !== JT.FREE && t !== JT.D6) throw new Error(`joint type ${t} is not supported yet`);
        const ndof = J.qd_start[j + 1] - J.qd_start[j];
        const nq = J.q_start[j + 1] - J.q_start[j];
        const dof = dofs.length, qs = q0.length;
        for (let k = 0; k < ndof; k++) {
          const qd = J.qd_start[j] + k;
          const scalar = t === JT.REVOLUTE || t === JT.PRISMATIC || t === JT.D6;
          // Steel's enable_joint_limits (off by default); bounds beyond 1e5 are Newton's unlimited.
          const limited = limitsOn && scalar && J.lower[qd] > -1e5 && J.upper[qd] < 1e5;
          const friction = SO.enable_joint_friction ? J.friction[qd] : 0;
          dofs.push({ armature: S.bodies.kinematic?.[J.child[j]] ? 1e9 : J.armature[qd], ke: J.ke[qd], kd: J.kd[qd], effort: J.effort[qd],
            lower: J.lower[qd], upper: J.upper[qd], limited: limited ? 1 : 0, link: links.length,
            damping: J.passive_damping?.[qd] ?? 0, friction, axis: J.axis[qd], scalar,
            springKe: scalar ? J.spring_stiffness?.[qd] ?? 0 : 0, springRef: J.spring_ref?.[qd] ?? 0,
            loadCoef: SO.enable_joint_friction && scalar ? J.friction_load_coefficient?.[qd] ?? 0 : 0,
            velLimit: scalar && SO.enable_joint_velocity_limits && J.vel_limit[qd] < 1e5 ? J.vel_limit[qd] : -1 });
          tqd0.push(J.target_qd ? J.target_qd[qd] : 0);
        }
        for (let k = 0; k < nq; k++) { qMap.set(J.q_start[j] + k, q0.length); q0.push(J.q[J.q_start[j] + k]); }
        for (let k = 0; k < ndof; k++) dofMap.set(J.qd_start[j] + k, dof + k);
        // Position targets live in coordinate layout; scalar joints map one coordinate per dof.
        const scalarJoint = t === JT.REVOLUTE || t === JT.PRISMATIC || t === JT.D6;
        for (let k = 0; k < ndof; k++) tq0.push(scalarJoint ? (J.target_q ?? J.q)[J.q_start[j] + k] : 0);
        const parentMovable = parentLink >= 0 && links[parentLink].movable;
        links.push({ type: t, parent: parentLink, dof, ndof, nlin: J.dof_dim?.[j]?.[0] ?? 0, qs, body: b, joint: j, movable: ndof > 0 || parentMovable });
        bodyKind[b] = 2; bodyArt[b] = a; bodyLink[b] = l;
      }
      const dn = dofs.length - dofStart;
      arts.push({ linkStart, linkCount: links.length - linkStart, dofStart, dofCount: dn });
    }
    const NA = arts.length, NL = links.length, ND = dofs.length;
    if (NA > 256) throw new Error(`${NA} articulations; one solve workgroup handles at most 256`);
    const mimics = [];
    const addMimic = (f, r, c0, c1) => {
      const n = J.qd_start[f + 1] - J.qd_start[f];
      for (let k = 0; k < n; k++) {
        const fd = dofMap.get(J.qd_start[f] + k), ld = dofMap.get(J.qd_start[r] + k);
        const a = bodyArt[J.child[f]];
        if (fd === undefined || ld === undefined || a !== bodyArt[J.child[r]]) throw new Error('mimic joints must share an articulation');
        const d0 = arts[a].dofStart;
        mimics.push({ art: a, f: fd - d0, l: ld - d0, c0, c1, fq: qMap.get(J.q_start[f] + k), lq: qMap.get(J.q_start[r] + k) });
      }
    };
    (J.mimic_joint ?? []).forEach((r, f) => { if (r >= 0) addMimic(f, r, J.mimic_coeffs[f][0], J.mimic_coeffs[f][1]); });
    (S.mimics ?? []).forEach((m) => { if (m.enabled) addMimic(m.follower, m.leader, m.c0, m.c1); });
    this.NB = NB; this.NA = NA; this.NL = NL; this.ND = ND;
    this.bodyKind = bodyKind;
    // Bodies the mouse spring may pull: free bodies and the movable links of articulations without drives
    // (robots follow their targets); never kinematic bodies, and nothing when the scene sets mouse_drag false.
    const driven = arts.map((a) => dofs.slice(a.dofStart, a.dofStart + a.dofCount).some((d) => d.ke > 0 || d.kd > 0));
    this.draggable = bodyKind.map((k, b) => S.mouse_drag !== false && !S.bodies.kinematic?.[b] && (k === 1 || (k === 2 && links[bodyLink[b]].movable && !driven[bodyArt[b]])));

    // Hulls.
    const hullIndex = new Map();
    const hulls = [];
    const shapes = S.shapes.filter((s) => s.hull || s.plane || s.mesh);
    for (const s of shapes) {
      if (!s.hull) continue;
      const key = s.hull.verts.off;
      if (!hullIndex.has(key)) {
        hullIndex.set(key, hulls.length);
        hulls.push(s.hull);
      }
    }
    // framefields: a triangle mesh becomes one flat hull per triangle, in the leaf order of a BVH over them.
    const meshOf = new Map();
    const bvhNodes = [];
    for (const s of shapes) {
      if (!s.mesh) continue;
      const { tris, nodes } = meshBVH(f32(s.mesh.verts), u32(s.mesh.idx));
      const hull0 = hulls.length, root = bvhNodes.length;
      for (const t of tris) hulls.push(triangleHull(t));
      for (const n of nodes) bvhNodes.push({ ...n, first: n.count ? n.first + hull0 : n.first + root });
      meshOf.set(s, { hull0, root });
    }
    const NS = shapes.length, NH = hulls.length;
    let nVerts = 0, nFaces = 0, nFv = 0;
    for (const h of hulls) { nVerts += h.nv; nFaces += h.nf; nFv += h.face_verts.n ?? h.face_verts.length; }
    // Unique hull edges (v0 < v1) with their two faces, for the Gauss-map edge test.
    const hullEdges = hulls.map((h) => {
      const fs = u32(h.face_start), fv = u32(h.face_verts), faces = new Map(), edges = [];
      for (let f = 0; f < h.nf; f++) {
        const n = fs[f + 1] - fs[f];
        for (let i = 0; i < n; i++) {
          const a = fv[fs[f] + i], b = fv[fs[f] + (i + 1) % n], key = Math.min(a, b) * 65536 + Math.max(a, b);
          if (!faces.has(key)) faces.set(key, []);
          faces.get(key).push(f);
          if (a < b) edges.push([a, b, key]);
        }
      }
      return edges.map(([a, b, key]) => { const fe = faces.get(key); return [a, b, fe[0], fe[fe.length - 1]]; });
    });
    const nEdges = hullEdges.reduce((n, e) => n + e.length, 0);
    const pathFloats = S.target_frames * S.driven;

    const SF = {};
    let off = 0;
    SF.SF_BODY = off; off += NB * 8;
    SF.SF_SHAPE = off; off += NS * 7;
    SF.SF_HAABB = off; off += NH * 2;
    SF.SF_VERTS = off; off += nVerts;
    SF.SF_FPLANE = off; off += nFaces;
    SF.SF_LINK = off; off += Math.max(NL, 1) * 6;
    SF.SF_DOF = off; off += Math.max(ND, 1) * 5;
    SF.SF_PATH = off; off += Math.ceil(pathFloats / 4);
    SF.SF_LOOP = off; off += Math.max(loops.length, 1) * 5;
    SF.SF_MIMIC = off; off += Math.max(mimics.length, 1) * 2;
    SF.SF_CTRL = off; off += 1;
    // framefields: per-body extension (gravity scale, linear damping, planar lock, 0), mutable at run time.
    SF.SF_BODYX = off; off += Math.max(NB, 1);
    // framefields: mesh BVH nodes, two vec4 each: (lo, first) and (hi, count); count 0 is an inner node
    // whose children are nodes first and first + 1, else first is the leaf's first triangle hull.
    SF.SF_BVH = off; off += Math.max(bvhNodes.length, 1) * 2;
    // framefields: ropes, three vec4 each: (body a, body b, length, 0), then each anchor from its body's COM.
    const ropes = S.ropes ?? [];
    SF.SF_ROPE = off; off += Math.max(ropes.length, 1) * 3;
    // framefields: springs, four vec4 each: (a, b, rest length, 0), the anchors, (stiffness, damping, 0, 0).
    const springs = S.springs ?? [];
    SF.SF_SPRING = off; off += Math.max(springs.length, 1) * 4;
    const statF = new Float32Array(off * 4);
    bvhNodes.forEach((n, i) => statF.set([...n.lo, n.first, ...n.hi, n.count], (SF.SF_BVH + i * 2) * 4));
    ropes.forEach((r, i) => {
      const arm = (b, p) => (b < 0 ? p : p.map((v, k) => v - S.bodies.com[b][k]));
      statF.set([r.a, r.b, r.length, 0, ...arm(r.a, r.pa), 0, ...arm(r.b, r.pb), 0], (SF.SF_ROPE + i * 3) * 4);
    });
    springs.forEach((r, i) => {
      // Rows inside one articulation take the dense path, which has no soft rows.
      if (r.a >= 0 && r.b >= 0 && bodyArt[r.a] >= 0 && bodyArt[r.a] === bodyArt[r.b]) throw new Error(`spring ${i}: both bodies are in one articulation (jointed together), where a spring would act rigid`);
      const arm = (b, p) => (b < 0 ? p : p.map((v, k) => v - S.bodies.com[b][k]));
      statF.set([r.a, r.b, r.rest, 0, ...arm(r.a, r.pa), 0, ...arm(r.b, r.pb), 0, r.ke, r.kd, 0, 0], (SF.SF_SPRING + i * 4) * 4);
    });
    for (let b = 0; b < NB; b++) {
      const o = (SF.SF_BODYX + b) * 4;
      statF.set([S.bodies.gravity_scale?.[b] ?? 1, S.bodies.linear_damping?.[b] ?? 0, S.bodies.planar?.[b] ? 1 : 0, 0], o);
    }
    const SU = {};
    let uoff = 0;
    SU.SU_HULL = uoff; uoff += NH * 4;
    SU.SU_FACE = uoff; uoff += nFaces * 2;
    SU.SU_FV = uoff; uoff += nFv;
    SU.SU_HEDGE = uoff; uoff += NH * 2;
    SU.SU_EDGE = uoff; uoff += nEdges * 4;
    SU.SU_ART = uoff; uoff += Math.max(NA, 1) * 4;
    SU.SU_ACON = uoff; uoff += Math.max(NA, 1);
    // Collision filter bitset over collision-shape pairs (Newton's filter list).
    SU.SU_FILTER = uoff; uoff += Math.ceil((NS * NS) / 32);
    const statU = new Uint32Array(uoff);
    const index = new Map();
    S.shapes.forEach((sh, i) => { if (sh.hull || sh.plane || sh.mesh) index.set(i, index.size); });
    for (const [a0, b0] of S.filters) {
      const a = index.get(a0), b = index.get(b0);
      if (a === undefined || b === undefined) continue;
      for (const k of [a * NS + b, b * NS + a]) statU[SU.SU_FILTER + (k >> 5)] |= 1 << (k & 31);
    }
    // Newton's world and collision-group rules.
    const cols = S.shapes.filter((sh) => sh.hull || sh.plane || sh.mesh);
    const groupsMeet = (ga, gb) => ga !== 0 && gb !== 0 && (ga > 0 ? ga === gb || gb < 0 : ga !== gb);
    for (let a = 0; a < NS; a++) {
      for (let b = a + 1; b < NS; b++) {
        const A = cols[a], B = cols[b];
        const wa = A.world ?? -1, wb = B.world ?? -1;
        const meet = (wa < 0 || wb < 0 || wa === wb) && groupsMeet(A.group ?? -1, B.group ?? -1);
        if (!meet) for (const k of [a * NS + b, b * NS + a]) statU[SU.SU_FILTER + (k >> 5)] |= 1 << (k & 31);
      }
    }

    // Bodies.
    const bodyPose = new Float32Array(NB * 8);
    for (let b = 0; b < NB; b++) {
      const o = (SF.SF_BODY + b * 8) * 4;
      const m = S.bodies.mass[b];
      const link = bodyLink[b];
      // kind: 1 free body, 2 articulation link, 3 link with no dof on its root path (immovable).
      const kind = bodyKind[b] === 2 && !links[link].movable ? 3 : bodyKind[b];
      this.bodyKind[b] = kind;
      const kinematic = !!S.bodies.kinematic?.[b];
      statF[o] = m > 0 && !kinematic ? 1 / m : 0;
      statF[o + 1] = kind; statF[o + 2] = bodyArt[b]; statF[o + 3] = link;
      const com = S.bodies.com[b];
      statF.set([com[0], com[1], com[2], Math.max(m, 0)], o + 4);
      const I = S.bodies.inertia[b];
      const Ii = inv3(I);
      for (let r = 0; r < 3; r++) {
        statF.set([I[r * 3], I[r * 3 + 1], I[r * 3 + 2], 0], o + 8 + r * 4);
        statF.set(kinematic ? [0, 0, 0, 0] : [Ii[r * 3], Ii[r * 3 + 1], Ii[r * 3 + 2], 0], o + 20 + r * 4);
      }
      const bq = S.bodies.q[b];
      const q = [bq[3], bq[4], bq[5], bq[6]];
      const c = quatRotate(q, com);
      bodyPose.set([bq[0] + c[0], bq[1] + c[1], bq[2] + c[2], 0, ...q], b * 8);
    }
    // Body bounding radius about the COM (friction-anchor matching scale).
    const radius = new Float32Array(NB);
    for (const s of shapes) {
      if (s.body < 0 || s.plane) continue;
      const com = S.bodies.com[s.body];
      let sr = s.prim?.kind === 1 ? s.prim.r : s.prim?.kind === 2 ? s.prim.r + s.prim.h : 0;
      if (s.hull && !s.prim?.kind) {
        const v = f32(s.hull.verts);
        for (let i = 0; i < s.hull.nv; i++) sr = Math.max(sr, Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]));
      }
      const d = Math.hypot(s.xf[0] - com[0], s.xf[1] - com[1], s.xf[2] - com[2]);
      radius[s.body] = Math.max(radius[s.body], d + sr + (s.round ?? 0));
    }
    radius.forEach((r, b) => { statF[(SF.SF_BODY + b * 8) * 4 + 11] = r; });
    // Body flags (Newton): 1 kinematic (prescribed twist, infinite mass), 2 gravity disabled.
    for (let b = 0; b < NB; b++) statF[(SF.SF_BODY + b * 8) * 4 + 31] = (S.bodies.kinematic?.[b] ? 1 : 0) | (S.bodies.no_gravity?.[b] ? 2 : 0);
    // Steel's per-body limits: angular damping (default 0.05), max linear/angular velocity and
    // max depenetration velocity (default unbounded, stored as -1).
    for (let b = 0; b < NB; b++) {
      const o = (SF.SF_BODY + b * 8) * 4;
      const lim = (k) => S.bodies[k]?.[b] ?? -1;
      statF[o + 15] = S.bodies.angular_damping?.[b] ?? 0.05;
      statF[o + 19] = lim('max_linear_velocity'); statF[o + 23] = lim('max_angular_velocity'); statF[o + 27] = lim('max_depenetration_velocity');
    }
    // Reduction groups (Newton's body-pair contact reduction): each static shape its own, dynamic
    // shapes per body and exact material signature.
    const rkeys = new Map();
    const rgroup = shapes.map((s, i) => {
      const k = s.body < 0 ? `s${i}` : [s.body, s.mu, s.restitution, s.mu_torsional, s.mu_rolling, s.ke, s.kd, s.condim, s.torsion_radius].join();
      if (!rkeys.has(k)) rkeys.set(k, rkeys.size);
      return rkeys.get(k);
    });
    // Newton geometry (type, scale) for the generic convex manifold. Box and cylinder sizes come
    // from their hulls, which the exporter builds centered on the shape frame.
    const GT = S.geo_type_names;
    const geoScale = (s) => {
      if (s.type === GT.SPHERE || s.type === GT.CAPSULE) return [s.prim.r, s.prim.h, 0];
      if (s.type !== GT.BOX && s.type !== GT.CYLINDER) return [1, 1, 1];
      const v = f32(s.hull.verts), m = [0, 0, 0];
      for (let i = 0; i < v.length; i++) m[i % 3] = Math.max(m[i % 3], Math.abs(v[i]));
      return s.type === GT.BOX ? m : [m[0], m[2], 0];
    };
    // Shapes.
    shapes.forEach((s, i) => {
      const o = (SF.SF_SHAPE + i * 7) * 4;
      statF.set([s.body, s.hull ? hullIndex.get(s.hull.verts.off) : meshOf.get(s)?.hull0 ?? 0, s.mu, s.gap ?? 0.001], o);
      // framefields: .w is the shape's border radius (a rounded hull: the core swept by a sphere).
      statF.set([s.xf[0], s.xf[1], s.xf[2], s.round ?? 0, s.xf[3], s.xf[4], s.xf[5], s.xf[6]], o + 4);
      // framefields: .w is a mesh's BVH root node + 1 (0: not a mesh).
      statF.set([s.ke ?? 0, s.kd ?? 0, rgroup[i], meshOf.has(s) ? meshOf.get(s).root + 1 : 0], o + 20);
      statF.set([s.plane ? 4 : s.prim?.kind ?? 0, s.prim?.r ?? 0, s.prim?.h ?? 0, s.torsion_radius ?? 0], o + 12);
      statF.set([s.restitution ?? 0, s.mu_torsional ?? 0, s.mu_rolling ?? 0, s.condim ?? 3], o + 16);
      statF.set([s.plane ? GT.PLANE : s.type, ...geoScale(s)], o + 24);
    });
    // Hull geometry.
    let vOff = 0, fOff = 0, fvOff = 0, eOff = 0;
    hulls.forEach((h, hi) => {
      statU.set([eOff, hullEdges[hi].length], SU.SU_HEDGE + hi * 2);
      hullEdges[hi].forEach((e, k) => statU.set(e, SU.SU_EDGE + (eOff + k) * 4));
      eOff += hullEdges[hi].length;
      const v = f32(h.verts), planes = f32(h.face_planes), fs = u32(h.face_start), fv = u32(h.face_verts);
      const lo = [1e30, 1e30, 1e30], hiB = [-1e30, -1e30, -1e30];
      for (let i = 0; i < h.nv; i++) {
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i * 3 + k]); hiB[k] = Math.max(hiB[k], v[i * 3 + k]); }
        statF.set([v[i * 3], v[i * 3 + 1], v[i * 3 + 2], 0], (SF.SF_VERTS + vOff + i) * 4);
      }
      statF.set([(lo[0] + hiB[0]) / 2, (lo[1] + hiB[1]) / 2, (lo[2] + hiB[2]) / 2, 0,
        (hiB[0] - lo[0]) / 2, (hiB[1] - lo[1]) / 2, (hiB[2] - lo[2]) / 2, 0], (SF.SF_HAABB + hi * 2) * 4);
      statU.set([vOff, h.nv, fOff, h.nf], SU.SU_HULL + hi * 4);
      for (let f = 0; f < h.nf; f++) {
        statF.set(planes.subarray(f * 4, f * 4 + 4), (SF.SF_FPLANE + fOff + f) * 4);
        statU.set([fvOff + fs[f], fs[f + 1] - fs[f]], SU.SU_FACE + (fOff + f) * 2);
      }
      statU.set(fv, SU.SU_FV + fvOff);
      vOff += h.nv; fOff += h.nf; fvOff += fv.length;
    });
    // Articulations.
    links.forEach((l, i) => {
      const o = (SF.SF_LINK + i * 6) * 4;
      const xp = J.X_p[l.joint], xc = J.X_c[l.joint];
      const ax = l.ndof === 1 ? J.axis[J.qd_start[l.joint]] : [0, 0, 1];
      statF.set([l.type, l.parent, l.dof, l.body], o);
      statF.set([xp[0], xp[1], xp[2], l.ndof, xp[3], xp[4], xp[5], xp[6]], o + 4);
      statF.set([xc[0], xc[1], xc[2], l.qs, xc[3], xc[4], xc[5], xc[6]], o + 12);
      statF.set([ax[0], ax[1], ax[2], l.type === JT.D6 ? l.nlin : 0], o + 20);
    });
    dofs.forEach((d, i) => statF.set([d.armature, d.ke, d.kd, d.effort, d.lower, d.upper, d.limited, d.link,
      d.damping, d.friction, d.velLimit, d.scalar ? 1 : 0, d.axis[0], d.axis[1], d.axis[2], d.loadCoef, d.springKe, d.springRef, 0, 0], (SF.SF_DOF + i * 5) * 4));
    arts.forEach((a, i) => statU.set([a.linkStart, a.linkCount, a.dofStart, a.dofCount], SU.SU_ART + i * 4));
    // Articulations owning a loop closure or mimic never sleep.
    for (const m of mimics) statU[SU.SU_ACON + m.art] = 1;
    loops.forEach((j) => { statU[SU.SU_ACON + bodyArt[J.child[j]]] = 1; });
    statF.set(f32(S.targets), SF.SF_PATH * 4);
    // Loop closures (ball or revolute) inside one articulation or to the world.
    loops.forEach((j, i) => {
      const t = J.type[j];
      if (t !== JT.BALL && t !== JT.REVOLUTE) throw new Error(`loop joint type ${t} is not supported yet`);
      const world = J.parent[j] < 0;
      const pl = world ? -1 : bodyLink[J.parent[j]], cl = bodyLink[J.child[j]];
      if (cl < 0 || (!world && (pl < 0 || bodyArt[J.parent[j]] !== bodyArt[J.child[j]]))) throw new Error('loop joints must close inside one articulation or to the world');
      const xp = J.X_p[j], xc = J.X_c[j];
      const ax = J.axis[J.qd_start[j]] ?? [0, 0, 1];
      const ap = quatRotate([xp[3], xp[4], xp[5], xp[6]], ax), ac = quatRotate([xc[3], xc[4], xc[5], xc[6]], ax);
      statF.set([pl, cl, bodyArt[J.child[j]], t === JT.REVOLUTE ? 1 : 0, xp[0], xp[1], xp[2], 0, xc[0], xc[1], xc[2], 0,
        ...ap, 0, ...ac, 0], (SF.SF_LOOP + i * 5) * 4);
    });
    // Mimic joints: one row per coordinate, follower and leader in one articulation.
    mimics.forEach((m, i) => statF.set([m.art, m.f, m.l, m.c1, m.fq, m.lq, m.c0, 0], (SF.SF_MIMIC + i * 2) * 4));
    const ctrl = S.control;
    let ctrlKind = 0, ctrlA = 0, ctrlB = 0;
    if (ctrl?.type === 'fader') {
      ctrlKind = 1; ctrlA = qMap.get(ctrl.fader_q); ctrlB = dofMap.get(ctrl.wheel_v);
      statF.set([ctrl.travel, ctrl.max_speed, 0, 0], SF.SF_CTRL * 4);
    }

    // Capacities.
    const MAXP = 16384, MAXC = 8192, MAXU = 2048, UH = 4096, WH = 16384;
    // Contact colors before the serial tail (Steel: 512); workgroup memory bounds the per-body mask.
    const ncolw = this.opts.colorWords ?? 2;
    // Contact row record in vec4s; torsional/rolling rows add 15.
    // Steel solver options (Steel's defaults), overridable per Sim through opts.solver.
    const SV = this.solver = { body_pair_cell_size: 0.06, cfm: 1e-6, relaxation: 1, baumgarte: 0.2, contact_speculative_scale: 1, contact_gap_gate: null,
      velocity_limit_activation_fraction: 0, contact_friction_gap_max: null, contact_friction_scale: 1, contact_shared_anchor: false, contact_friction_shared_anchor: false,
      contact_warmstart_decay: 1, restitution_velocity_threshold: 0.5, enable_restitution: true,
      contact_friction_position_iterations: -1, velocity_iterations: 0, joint_limit_activation_gap: null, ...S.solver, ...this.opts.solver };
    // Warm start: opts.warmStart (a scale), else Steel's contact_warmstart (off by default).
    this.opts.warmStart ??= SV.contact_warmstart ? 1 : 0;
    const iters = this.opts.iterations, fpi = SV.contact_friction_position_iterations;
    // Friction patches (Steel's friction anchors) are on unless friction_anchor_beta is 0.
    // Steel turns the anchors off for the coupled friction modes.
    const FMODES = ['fixed_normal', 'bisection', 'bisection_desaxce', 'coulomb_newton'];
    const fmode = FMODES.indexOf(SV.friction_mode ?? 'fixed_normal');
    if (fmode < 0) throw new Error(`friction_mode ${SV.friction_mode} is not supported`);
    if (!['contact', 'longest_first'].includes(SV.propagation_color_order ?? 'contact')) throw new Error(`propagation_color_order ${SV.propagation_color_order} is not supported`);
    // Steel options the port does not take, at anything but their defaults.
    for (const [k, def] of [['enable_bilateral_preelimination', false], ['propagation_same_articulation_rows', false],
      ['update_mass_matrix_interval', 1]]) {
      if (SV[k] !== undefined && SV[k] !== def) throw new Error(`${k}=${SV[k]} is not supported`);
    }
    // Steel turns anchors off for the coupled friction modes; articulated angular rows need point friction.
    if (SV.enable_torsional_rolling_friction && (SV.friction_anchor_beta ?? 0) > 0) throw new Error('enable_torsional_rolling_friction needs friction_anchor_beta=0');
    // contact_compliance turns anchors off (as Steel) and needs no regularization or restitution.
    const anchorBeta = fmode > 0 || SV.enable_torsional_rolling_friction || SV.contact_compliance ? 0 : SV.friction_anchor_beta ?? 0.2;
    // Angular friction rows: articulated contacts under enable_torsional_rolling_friction, free-body
    // contacts of shapes with steel:condim >= 4 (or the free_rigid_* overrides).
    const angArt = !!SV.enable_torsional_rolling_friction;
    const frMut = SV.free_rigid_torsional_friction ?? -1, frMur = SV.free_rigid_rolling_friction ?? -1;
    const angOn = angArt || frMut > 0 || frMur > 0 || S.shapes.some((s) => (s.condim ?? 3) >= 4);
    const torsOn = S.shapes.some((s) => (s.torsion_radius ?? 0) > 0);
    const PO = angOn ? 34 : 19;
    const FMO = PO + (anchorBeta > 0 || SV.contact_friction_shared_anchor ? 4 : 0);
    const TO = FMO + (fmode > 0 ? 2 : 0);
    const EO = TO + (torsOn ? 5 : 0);
    const CO = EO + (angArt ? 4 : 0);
    const compliance = !!SV.contact_compliance;
    // framefields: compliant rows are compiled for contact compliance or for springs (whose rows are
    // soft); contacts stay rigid unless contact compliance is on.
    const softRows = compliance || (S.springs ?? []).length > 0;
    const nest = !!SV.nesterov_momentum;
    const MO = CO + (softRows ? 1 : 0);
    const ROWS = MO + (nest ? 2 : 0);
    const P = { P_BODY: 0, P_SHAPE: NB * 2, P_AABB: NB * 2 + NS * 2, P_PREV: NB * 2 + NS * 4 };
    const MAXDENSE = 512;
    const Sd = {};
    let so = 0;
    for (const [k, n] of [['S_HKEY', UH], ['S_HCNT', UH], ['S_SLOT2U', UH], ['S_CSLOT', MAXC], ['S_CLOCAL', MAXC],
      ['S_USIZE_TMP', MAXU], ['S_UKEY', MAXU], ['S_USIZE', MAXU], ['S_USTART', MAXU + 1], ['S_CSTART', ncolw * 32 + 2], ['S_META', 8], ['S_CORDER', MAXC], ['S_RK0', MAXC], ['S_RK1', MAXC], ['S_RK2', MAXC], ['S_KEPT', MAXC], ['S_OSTART', MAXU], ['S_LEAD', MAXC], ['S_SLOT', MAXC * 26], ['S_ROWOF', MAXC], ['S_RUNIT', MAXC], ['S_PCOL', MAXC], ['S_PORD', MAXC], ['S_UTC', MAXU], ['S_UTP', MAXU], ['S_UF', NB + NA], ['S_UFF', NB + NA],
      ['S_RCON', MAXC], ['S_WWIN', WH], ['S_UWOFF', UH], ['S_WALK', MAXC], ['S_WSLOT', MAXC + MAXDENSE]]) {
      Sd[k] = so; so += n;
    }
    const A = {};
    let ao = 0;
    const NQ = q0.length;
    const NDA = Math.max(1, ...arts.map((a) => a.dofCount));
    const DHDR = 25, DPS = DHDR + 6 * NDA;
    for (const [k, n] of [['A_Q', NQ], ['A_QD', ND], ['A_QDH', ND], ['A_INT', ND], ['A_TGT', ND], ['A_TGTV', ND],
      ['A_LIM', 2 * ND], ['A_DRV', ND], ['A_JFL', ND], ['A_JF', ND], ['A_BF', NB * 8], ['A_SLP', (NB + NA) * 4], ['A_FRIC', ND], ['A_HINV', ND], ['A_LINK', Math.max(NL, 1) * LB], ['A_SNAP', NB * 8 + ND], ['A_VLG', ND + NB * 6], ['A_AVL', NA], ['A_LG', ND], ['A_RL', ND], ['A_RLN', NA], ['A_ULOAD', anchorBeta > 0 ? MAXU : 0], ['A_DENSE', MAXDENSE * DPS]]) {
      A[k] = ao; ao += Math.max(n, 1);
    }
    this.C = {
      TGT_HELD: S.targets_held ? 1 : 0, NEST: nest ? 1 : 0, MO, NB, NBP: Math.max(NB, 1), NBP2: Math.max(NB, 1) * 2, NCOLW: ncolw, NCOL: ncolw * 32, NS, NA, NAP: Math.max(NA, 1), NL, ND, NDP: Math.max(ND, 1),
      NLOOP: loops.length, NROPE: (S.ropes ?? []).length, NSPRING: (S.springs ?? []).length, ROPE_G0: rkeys.size, NMIMIC: mimics.length, CTRL_KIND: ctrlKind, CTRL_A: ctrlA, CTRL_B: ctrlB,
      NLP: Math.max(NL, 1), NDA, JDIM: 3 * NDA, MAXDENSE, DHDR, DPS, MAXP, MAXC, MAXU, UH, WH, ROWS, PO, FMO, FMODE: fmode, PATCH: anchorBeta > 0 ? 1 : 0, F_ANCHOR_BETA: anchorBeta,
      EXTRA: anchorBeta > 0 || SV.contact_friction_shared_anchor ? 1 : 0, SHARED: SV.contact_shared_anchor ? 1 : 0, FSHARED: SV.contact_friction_shared_anchor ? 1 : 0,
      F_CFM: SV.cfm, F_OMEGA: SV.relaxation, F_SPEC: SV.contact_speculative_scale, F_GAP_GATE: SV.contact_gap_gate ?? 1e30,
      F_FGAP: SV.contact_friction_gap_max ?? 1e30, F_FSCALE: SV.contact_friction_scale, F_REST_SPEED: SV.restitution_velocity_threshold,
      REST: SV.enable_restitution && !SV.contact_compliance ? 1 : 0,
      PWG: Math.min(1024, this.device.limits.maxComputeInvocationsPerWorkgroup),  // prepare workgroup
      // Contact sort block: keys sorted in workgroup memory (vec4 per key).
      CSB: this.device.limits.maxComputeWorkgroupStorageSize >= 32768 ? 1024 : 512,
      CTI: SV.row_schedule === 'contact_then_internal' ? 1 : 0,
      SLEEP: SV.enable_sleeping ? 1 : 0, F_SLEEP_LIN: SV.sleep_linear_threshold ?? 0.05, F_SLEEP_ANG: SV.sleep_angular_threshold ?? 0.15,
      F_SLEEP_TIME: SV.sleep_quiet_time ?? 0.5,
      DRIVE_ROWS: SV.drive_mode === 'rows' ? 1 : 0, VEL_DRIVE_ACTIVE: SV.velocity_drive_mode === 'active' ? 1 : 0,
      FUSE_VLIM: SV.fuse_joint_velocity_limits === false ? 0 : 1, VLIM_ON: SO.enable_joint_velocity_limits ? 1 : 0, FSTART: fpi < 0 ? 0 : iters - Math.min(fpi, iters), VELITERS: SV.velocity_iterations, AH: 4096, ANG: angOn ? 1 : 0, ANG_ART: angArt ? 1 : 0, F_FR_MUT: frMut, F_FR_MUR: frMur, JFL: dofs.some((d) => d.loadCoef > 0) ? 1 : 0, TORS: torsOn ? 1 : 0, TO, EO, PYRAMID: SV.torsional_rolling_friction_cone === 'pyramidal' ? 1 : 0, CO, COMPL: softRows ? 1 : 0, CCOMPL: compliance ? 1 : 0, F_CREEP: SV.torsional_rolling_friction_creep_speed ?? 0, F_BP_CELL: SV.body_pair_cell_size, LONGEST_FIRST: SV.propagation_color_order === 'longest_first' ? 1 : 0, SG: this.device.features.has('subgroups') ? 1 : 0, SG32: this.device.features.has('subgroups') && this.device.adapterInfo?.subgroupMinSize === 32 && this.device.adapterInfo?.subgroupMaxSize === 32 && this.device.limits.maxComputeInvocationsPerWorkgroup >= 32 ? 1 : 0, F_VLIM_FRAC: SV.velocity_limit_activation_fraction, F_JL_GAP: Math.min(SV.joint_limit_activation_gap ?? 0.05, 1e30), F_JL_SPEED: SV.joint_limit_activation_gap == null ? 2 : 0, VLIM_FREE: S.bodies.max_linear_velocity || S.bodies.max_angular_velocity ? 1 : 0, JT_REVOLUTE: JT.REVOLUTE, JT_PRISMATIC: JT.PRISMATIC, JT_BALL: JT.BALL, JT_FREE: JT.FREE, JT_D6: JT.D6,
      FRICTION_COMBINE: COMBINE.indexOf(SO.friction_combine ?? 'average'), RESTITUTION_COMBINE: COMBINE.indexOf(SO.restitution_combine ?? 'average'),
      JM: links.some((l) => l.ndof > 3) ? 6 : 3,  // widest joint; sizes per-thread path buffers
      MAXPATH: Math.max(1, ...links.reduce((d, l) => (d.push(l.parent >= 0 ? d[l.parent] + 1 : 1), d), [])),  // deepest root path
      MAXLP: Math.max(1, ...arts.map((a) => a.linkCount)),
      ...SF, ...SU, ...P, ...Sd, ...A,
    };
    this.layout = { SF, SU, P, Sd, A };

    // framefields: CPU copies of the per-body records and the collision filter, changed at run time
    // (mass, enabling, collisions, extensions) and kept by snapshots.
    this.statF = statF; this.statU = statU;
    this.bodyBase = statF.slice(SF.SF_BODY * 4, (SF.SF_BODY + NB * 8) * 4);
    this.filterBase = statU.slice(SU.SU_FILTER, SU.SU_FILTER + Math.ceil((NS * NS) / 32));
    this.disabled = new Uint8Array(NB);
    this.noCollide = new Uint8Array(NB);
    this.gravity = [...S.gravity];
    this.shapeBodies = shapes.map((sh) => sh.body);

    const dev = this.device;
    const mk = (name, size, data) => {
      const b = dev.createBuffer({ label: name, size: Math.max(16, Math.ceil(size / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      if (data) dev.queue.writeBuffer(b, 0, data);
      return b;
    };
    const artInit = new Float32Array(ao);
    artInit.set(q0, A.A_Q);
    artInit.set(tq0, A.A_TGT);
    artInit.set(tqd0, A.A_TGTV);
    const bodyVel = new Float32Array(NB * 8);
    S.bodies.twist?.forEach((t, b) => { if (bodyKind[b] === 1) bodyVel.set([t[0], t[1], t[2], 0, t[3], t[4], t[5], 0], b * 8); });
    // Floating-base roots: twist -> free-joint qd (joint origin velocity, angular velocity; identity joint frames).
    for (const l of links) {
      const t = S.bodies.twist?.[l.body];
      if (l.type !== JT.FREE || l.parent >= 0 || !t) continue;
      const bq = S.bodies.q[l.body];
      const rc = quatRotate([bq[3], bq[4], bq[5], bq[6]], S.bodies.com[l.body]);
      const w = [t[3], t[4], t[5]];
      const v = [t[0] - (w[1] * rc[2] - w[2] * rc[1]), t[1] - (w[2] * rc[0] - w[0] * rc[2]), t[2] - (w[0] * rc[1] - w[1] * rc[0])];
      artInit.set([...v, ...w], A.A_QD + l.dof);
    }
    this.initial = { bodyPose: bodyPose.slice(), bodyVel, art: artInit.slice() };
    this.buffers = {
      statF: mk('statF', statF.byteLength, statF),
      statU: mk('statU', statU.byteLength, statU),
      poses: mk('poses', (NB * 4 + NS * 4) * 16),
      vel: mk('vel', NB * 2 * 16),
      counters: mk('counters', 64),
      pairs: mk('pairs', MAXP * 8),
      contacts: mk('contacts', MAXC * 6 * 16),  // contact records, then shape friction pairs
      sched: mk('sched', so * 4),
      rows: mk('rows', MAXC * (ROWS + 2) * 16),
      warm: mk('warm', (WH * 10 + 4096 * 30) * 4),  // contact impulses, then friction anchors
      art: mk('art', ao * 4),
      stats: mk('stats', 64),
      indirect: dev.createBuffer({ label: 'indirect', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT }),
      scratch: mk('scratch', MAXC * 16),  // contact sort keys
      craw: mk('craw', MAXC * 6 * 16),  // narrowphase contacts before the sort
    };
    this.statsSize = 64;
    this.reset();

    // Pipelines.
    const kernels = {
      shapes: [shapesWGSL, ['statF', 'statU', 'poses']],
      broad: [broadWGSL, ['statF', 'statU', 'poses', 'counters', 'pairs']],
      args: [argsWGSL, ['counters', 'indirect']],
      narrow: [narrowWGSL, ['statF', 'statU', 'poses', 'counters', 'pairs', 'contacts']],
      csort: [csortWGSL, ['counters', 'contacts', 'scratch', 'craw']],
      prepare: [prepareWGSL, ['statF', 'statU', 'poses', 'vel', 'counters', 'contacts', 'sched', 'rows', 'warm', 'art']],
      solve: [solveWGSL, ['statF', 'statU', 'poses', 'vel', 'counters', 'sched', 'rows', 'warm', 'art', 'stats']],
    };
    // Pipelines with identical source are compiled once per device and shared by later Sims.
    const cache = PIPELINES.get(dev) ?? PIPELINES.set(dev, new Map()).get(dev);
    this.paramLayout = cache.get('params') ?? cache.set('params', dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] })).get('params');
    this.pipes = {};
    const pending = [];
    for (const [name, [gen, uses]] of Object.entries(kernels)) {
      const code = gen(this.C);
      const key = `${name}\n${code}`;
      let entry = cache.get(key);
      if (!entry) {
        const shaderModule = dev.createShaderModule({ label: name, code });
        const layout = dev.createBindGroupLayout({
        entries: uses.map((u) => ({
          binding: BUFFER_NAMES.indexOf(u),
          visibility: GPUShaderStage.COMPUTE,
            buffer: { type: u === 'statF' || u === 'statU' ? 'read-only-storage' : 'storage' },
          })),
        });
        const desc = {
          label: name,
          layout: dev.createPipelineLayout({ bindGroupLayouts: [layout, this.paramLayout] }),
          compute: { module: shaderModule, entryPoint: 'main' },
        };
        entry = { module: shaderModule, layout, desc, pipeline: null, compiling: null };
        if (name === 'csort') {
          // One pipeline per sort stage; stage pipelines compile with the rest below.
          entry.stages = this.sortStages().map((st) => {
            const sd = { ...desc, compute: { module: shaderModule, entryPoint: st.entry, constants: st.constants } };
            return { ...st, pipeline: this.opts.asyncCompile ? null : dev.createComputePipeline(sd), desc: sd };
          });
          entry.pipeline = true;
        }
        cache.set(key, entry);
      }
      if (entry.stages) {
        this.pipes[name] = { pipeline: true, stages: entry.stages, group: dev.createBindGroup({
          layout: entry.layout,
          entries: uses.map((u) => ({ binding: BUFFER_NAMES.indexOf(u), resource: { buffer: this.buffers[u] } })),
        }) };
        for (const st of entry.stages) {
          if (!st.pipeline) { st.compiling ??= dev.createComputePipelineAsync(st.desc).then((pl) => { st.pipeline = pl; }); pending.push(st.compiling); }
        }
        continue;
      }
      // The narrowphase writes its contacts to craw; the sort lays them out in contacts.
      const bufferFor = (u) => (name === 'narrow' && u === 'contacts' ? this.buffers.craw : this.buffers[u]);
      const group = dev.createBindGroup({
        layout: entry.layout,
        entries: uses.map((u) => ({ binding: BUFFER_NAMES.indexOf(u), resource: { buffer: bufferFor(u) } })),
      });
      this.pipes[name] = { pipeline: entry.pipeline, group, module: entry.module };
      if (entry.pipeline) continue;
      if (this.opts.asyncCompile) {
        const e = entry;
        e.compiling ??= dev.createComputePipelineAsync(e.desc).then((p) => { e.pipeline = p; return p; });
        pending.push(e.compiling.then((p) => { this.pipes[name].pipeline = p; }));
      } else {
        entry.pipeline = dev.createComputePipeline(entry.desc);
        this.pipes[name].pipeline = entry.pipeline;
      }
    }
    this.ready = Promise.all(pending).then(() => this);
    // Two frames of substeps in flight: a frame never reuses a uniform before the GPU reads it.
    this.params = [];
    for (let s = 0; s < 2 * MAX_SUBSTEPS; s++) {
      const buf = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.params.push({ buf, group: dev.createBindGroup({ layout: this.paramLayout, entries: [{ binding: 0, resource: { buffer: buf } }] }) });
    }
    this.NS = NS;
    this.shapes = shapes;
    this.links = links;
    this.dofMap = dofMap;
    this.qMap = qMap;
    this.hasTimestamps = dev.features.has('timestamp-query');
    if (this.hasTimestamps) {
      this.querySet = dev.createQuerySet({ type: 'timestamp', count: 2 });
      this.queryBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    }
  }

  reset() {
    const q = this.device.queue;
    q.writeBuffer(this.buffers.poses, 0, this.initial.bodyPose);
    q.writeBuffer(this.buffers.vel, 0, this.initial.bodyVel);
    q.writeBuffer(this.buffers.art, 0, this.initial.art);
    q.writeBuffer(this.buffers.warm, 0, new Uint32Array(this.buffers.warm.size / 4));
    q.writeBuffer(this.buffers.counters, 0, new Uint32Array(16));
    q.writeBuffer(this.buffers.stats, 0, new Uint32Array(16));
    this.phase = 0; this.time = 0; this.frame = 0; this.substepCount = 0;
    this.pick = null;
  }

  writeParams(slot, substep) {
    const S = this.scene.json;
    const ab = new ArrayBuffer(112);
    const f = new Float32Array(ab), u = new Uint32Array(ab);
    const dt = 1 / S.fps / this.opts.substeps;
    f[0] = dt; u[1] = substep; u[2] = this.substepCount % 2; u[3] = this.opts.iterations;
    f[4] = this.phase; f[5] = 1 / S.fps; f[6] = this.solver.baumgarte; f[7] = 2.0;
    f.set([...this.gravity, 0], 8);
    f[13] = this.opts.warmStart * this.solver.contact_warmstart_decay; u[14] = S.target_frames; u[15] = this.userTargets ? 0 : S.driven;
    u[16] = S.integral_count;
    f[17] = this.solver.contact_compliance ? 0 : this.opts.regularization;
    const pk = this.pick;
    if (pk) f.set([pk.local[0], pk.local[1], pk.local[2], pk.body, pk.target[0], pk.target[1], pk.target[2], 1], 20);
    this.device.queue.writeBuffer(this.params[slot].buf, 0, ab);
  }

  // The contact sort's dispatches: block sorts, then the rank merge across blocks.
  sortStages() {
    const { CSB, MAXC } = this.C;
    return [{ entry: 'keys_block', constants: {}, groups: MAXC / CSB }, { entry: 'rank_merge', constants: {}, groups: 8 }];
  }

  // Bind and dispatch one kernel of a substep.
  dispatch(pass, name, paramGroup) {
    const p = this.pipes[name];
    if (p.stages) {
      pass.setBindGroup(0, p.group);
      pass.setBindGroup(1, paramGroup);
      for (const st of p.stages) { pass.setPipeline(st.pipeline); pass.dispatchWorkgroups(st.groups); }
      return;
    }
    pass.setPipeline(p.pipeline);
    pass.setBindGroup(0, p.group);
    pass.setBindGroup(1, paramGroup);
    const C = this.C;
    if (name === 'shapes') pass.dispatchWorkgroups(Math.ceil(C.NS / 64));
    else if (name === 'broad') pass.dispatchWorkgroups(Math.ceil(C.NS / 16), Math.ceil(C.NS / 16));
    else if (name === 'narrow') pass.dispatchWorkgroupsIndirect(this.buffers.indirect, 0);
    else pass.dispatchWorkgroups(1);
  }

  // Write the parameters of the next substep; returns its uniform bind group.
  nextSubstep(s) {
    const slot = (this.frameSlot * this.opts.substeps + s) % this.params.length;
    this.writeParams(slot, s);
    this.substepCount++;
    return this.params[slot].group;
  }

  advanceClock() {
    this.frame++;
    this.time += 1 / this.scene.json.fps;
    this.phase += 1 / this.scene.json.fps;
  }

  // Encode one 60 Hz frame (all substeps) into the encoder.
  encodeFrame(enc, timestamps = false) {
    const pass = enc.beginComputePass(timestamps && this.hasTimestamps
      ? { timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    for (let s = 0; s < this.opts.substeps; s++) {
      const pg = this.nextSubstep(s);
      for (const name of KERNELS) this.dispatch(pass, name, pg);
    }
    pass.end();
    this.advanceClock();
  }

  step(frames = 1, timestamps = false) {
    for (let i = 0; i < frames; i++) {
      // Params buffers are rewritten per frame, so submit each frame on its own.
      const enc = this.device.createCommandEncoder();
      this.frameSlot = this.frame % 2;
      this.encodeFrame(enc, timestamps && i === frames - 1);
      if (timestamps && i === frames - 1 && this.hasTimestamps) enc.resolveQuerySet(this.querySet, 0, 2, this.queryBuf, 0);
      this.device.queue.submit([enc.finish()]);
    }
  }

  // Advance `frames` 60 Hz frames, at most four in flight. onFrame(sim, frame) runs before each
  // frame and may be async (read state, run a policy, set targets or forces).
  async run(frames, onFrame) {
    for (let i = 0; i < frames; i++) {
      if (onFrame) await onFrame(this, this.frame);
      this.step(1);
      if (i % 4 === 3) await this.device.queue.onSubmittedWorkDone();
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  // Position and velocity target of a Newton joint dof (Control.joint_target_pos / joint_target_vel),
  // held until changed. Replaces the scene's recorded target trajectory from then on.
  setJointTarget(newtonDof, pos, vel = 0) {
    const d = this.dofMap.get(newtonDof);
    if (d === undefined) throw new Error(`dof ${newtonDof} is not simulated as an articulation dof`);
    const A = this.layout.A;
    this.userTargets = true;
    this.device.queue.writeBuffer(this.buffers.art, (A.A_TGT + d) * 4, new Float32Array([pos]));
    this.device.queue.writeBuffer(this.buffers.art, (A.A_TGTV + d) * 4, new Float32Array([vel]));
  }

  // Targets for consecutive Newton dofs from `first` (a policy's action vector).
  setJointTargets(pos, vel = null, first = 0) {
    for (let k = 0; k < pos.length; k++) this.setJointTarget(first + k, pos[k], vel ? vel[k] : 0);
  }

  // Newton State: bodyQ (body origin position, quaternion x y z w; 7 per body), bodyQd (COM linear
  // and angular velocity, world frame; 6 per body), jointQ and jointQd in Newton's joint layout.
  // framefields: { contacts: true } adds the last substep's contacts, read in the same copy (one
  // round trip while they fit the room the previous read found them needing).
  async state({ contacts = false } = {}) {
    const S = this.scene.json, J = S.joints, NB = this.NB, A = this.layout.A;
    const parts = [
      ['poses', NB * 32, 0],
      ['vel', NB * 32, 0],
      ['art', (this.ND + A.A_QD - A.A_Q) * 4, A.A_Q * 4],
      ['art', Math.max(this.NL, 1) * LB * 4, A.A_LINK * 4],
    ];
    this.contactRoom ??= 64;
    if (contacts) parts.push(['stats', 64, 0], ['contacts', Math.min(this.contactRoom, this.C.MAXC) * 80, 0]);
    const got = await this.readAll(parts);
    const [pose, vel, art, link] = got.map((b) => new Float32Array(b));
    // Articulated links keep their COM twist in the link record (angular, then linear).
    for (let l = 0; l < this.NL; l++) {
      const b = this.links[l].body, o = l * LB + L_V;
      vel.set([link[o + 3], link[o + 4], link[o + 5], 0, link[o], link[o + 1], link[o + 2], 0], b * 8);
    }
    const bodyQ = new Float32Array(NB * 7), bodyQd = new Float32Array(NB * 6);
    for (let b = 0; b < NB; b++) {
      const q = pose.subarray(b * 8 + 4, b * 8 + 8);
      const r = quatRotate(q, S.bodies.com[b]);
      bodyQ.set([pose[b * 8] - r[0], pose[b * 8 + 1] - r[1], pose[b * 8 + 2] - r[2], q[0], q[1], q[2], q[3]], b * 7);
      bodyQd.set([vel[b * 8], vel[b * 8 + 1], vel[b * 8 + 2], vel[b * 8 + 4], vel[b * 8 + 5], vel[b * 8 + 6]], b * 6);
    }
    const jointQ = Float32Array.from(J.q), jointQd = new Float32Array(J.qd_start[J.qd_start.length - 1]);
    for (const [nq, q] of this.qMap) jointQ[nq] = art[q];
    for (const [nd, d] of this.dofMap) jointQd[nd] = art[A.A_QD - A.A_Q + d];
    // Free bodies outside articulations: their free joint mirrors the body.
    J.type.forEach((t, j) => {
      if ((t !== JT.FREE && t !== JT.DISTANCE) || this.qMap.has(J.q_start[j])) return;
      const b = J.child[j];
      jointQ.set(bodyQ.subarray(b * 7, b * 7 + 7), J.q_start[j]);
      jointQd.set(bodyQd.subarray(b * 6, b * 6 + 6), J.qd_start[j]);
    });
    if (!contacts) return { bodyQ, bodyQd, jointQ, jointQd };
    return { bodyQ, bodyQd, jointQ, jointQd, contacts: await this.contactsFrom(got[4], got[5]) };
  }

  // Generalized force on a Newton joint dof (Control.joint_f), held until changed.
  setJointForce(newtonDof, value) {
    const d = this.dofMap.get(newtonDof);
    if (d === undefined) throw new Error(`dof ${newtonDof} is not simulated as an articulation dof`);
    this.device.queue.writeBuffer(this.buffers.art, (this.layout.A.A_JF + d) * 4, new Float32Array([value]));
  }

  // Applied wrench at a body's COM, world frame (State.body_f), held until changed.
  setBodyWrench(body, force, torque) {
    this.device.queue.writeBuffer(this.buffers.art, (this.layout.A.A_BF + body * 8) * 4, new Float32Array([...force, 0, ...torque, 0]));
  }

  // Place a free (e.g. kinematic) body: COM position and orientation quaternion (x, y, z, w), world frame.
  setBodyPose(body, com, quat) {
    this.device.queue.writeBuffer(this.buffers.poses, (this.layout.P.P_BODY + body * 2) * 16, new Float32Array([...com, 0, ...quat]));
  }

  // Prescribe a free (e.g. kinematic) body's twist: COM linear velocity and angular velocity, world frame.
  setBodyTwist(body, twist) {
    this.device.queue.writeBuffer(this.buffers.vel, body * 32, new Float32Array([twist[0], twist[1], twist[2], 0, twist[3], twist[4], twist[5], 0]));
  }

  // framefields: run-time changes. Each one writes the solver's own tables, so the next step sees it,
  // and snapshots keep it.

  // Gravity (m/s², world frame) from the next step on.
  setGravity(g) {
    this.gravity = [g[0], g[1], g[2]];
  }

  // A body's mass (kg) as the solver has it now.
  bodyMass(body) {
    return this.bodyBase[body * 32 + 7];
  }

  // A free body's mass (kg); its inertia scales with it, as the same shapes at another density.
  setBodyMass(body, mass) {
    this.assertFree(body, 'setBodyMass');
    const o = body * 32, rec = this.bodyBase;
    const m0 = rec[o + 7];
    if (!(m0 > 0) || !(mass > 0)) throw new Error('setBodyMass: the body\'s mass and the new one must be positive');
    const k = mass / m0, kinematic = (rec[o + 31] & 1) !== 0;
    rec[o + 7] = mass;
    if (!kinematic) rec[o] = 1 / mass;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        rec[o + 8 + r * 4 + c] *= k;
        if (!kinematic) rec[o + 20 + r * 4 + c] /= k;
      }
    }
    this.writeBody(body);
  }

  // A body's gravity scale (links too), and a free body's linear damping (1/s) and planar lock (moves
  // in its world xy plane only, turning about z). Fields left out keep their value.
  setBodyExtension(body, { gravityScale, linearDamping, planar } = {}) {
    const o = (this.layout.SF.SF_BODYX + body) * 4, ext = this.statF.subarray(o, o + 4);
    if (gravityScale !== undefined) ext[0] = gravityScale;
    if (linearDamping !== undefined || planar !== undefined) this.assertFree(body, 'setBodyExtension');
    if (linearDamping !== undefined) ext[1] = linearDamping;
    if (planar !== undefined) ext[2] = planar ? 1 : 0;
    this.device.queue.writeBuffer(this.buffers.statF, o * 4, ext);
  }

  // Locks a free body's turning about its own x, y and/or z axes (no inverse inertia there). Exact for
  // a full lock, and for turning about one axis that stays put (a planar body about z).
  lockBodyRotation(body, axes) {
    this.assertFree(body, 'lockBodyRotation');
    const o = body * 32, rec = this.bodyBase;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (axes[r] || axes[c]) rec[o + 20 + r * 4 + c] = 0;
    this.writeBody(body);
  }

  // Takes a free body out of the world (it neither moves nor touches anything) or puts it back where it is.
  setBodyEnabled(body, on) {
    this.assertFree(body, 'setBodyEnabled');
    this.disabled[body] = on ? 0 : 1;
    this.writeBody(body);
    this.writeFilter();
    if (!on) this.setBodyTwist(body, [0, 0, 0, 0, 0, 0]);
  }

  // Whether a body's shapes touch anything (off: it passes through everything).
  setBodyCollisions(body, on) {
    this.noCollide[body] = on ? 0 : 1;
    this.writeFilter();
  }

  assertFree(body, what) {
    if (this.bodyKind[body] !== 1) throw new Error(`${what}: body ${body} is part of an articulation; this takes free bodies`);
  }

  // A body's record as the solver reads it: its base record, made immovable while disabled.
  writeBody(b) {
    const rec = this.bodyBase.slice(b * 32, b * 32 + 32);
    if (this.disabled[b]) {
      rec[0] = 0;
      for (let r = 0; r < 3; r++) rec.fill(0, 20 + r * 4, 23 + r * 4);
      rec[31] = rec[31] | 1;
    }
    const o = this.layout.SF.SF_BODY + b * 8;
    this.statF.set(rec, o * 4);
    this.device.queue.writeBuffer(this.buffers.statF, o * 16, rec);
  }

  // The collision filter: the scene's, plus every pair with a shape of a disabled or non-colliding body.
  writeFilter() {
    const NS = this.NS, out = this.filterBase.slice();
    const off = this.shapeBodies.map((b) => b >= 0 && (this.disabled[b] || this.noCollide[b]));
    for (let a = 0; a < NS; a++) {
      if (!off[a]) continue;
      for (let b = 0; b < NS; b++) for (const k of [a * NS + b, b * NS + a]) out[k >> 5] |= 1 << (k & 31);
    }
    const o = this.layout.SU.SU_FILTER;
    this.statU.set(out, o);
    this.device.queue.writeBuffer(this.buffers.statU, o * 4, out);
  }

  // The whole simulation state as bytes: the GPU state (poses, velocities, articulations, warm starts and
  // friction anchors), the clock, targets and every run-time change. restore() on a Sim of the same scene
  // continues bit for bit.
  async snapshot() {
    const gpu = await Promise.all(SNAPSHOT_BUFFERS.map((n) => this.read(n, this.buffers[n].size)));
    const SF = this.layout.SF;
    const ext = this.statF.slice(SF.SF_BODYX * 4, (SF.SF_BODYX + this.NB) * 4);
    const parts = [...gpu.map((b) => new Uint8Array(b)), ...[this.bodyBase, ext, this.disabled, this.noCollide].map((a) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)))];
    const header = new TextEncoder().encode(JSON.stringify({
      version: 1, NB: this.NB, NS: this.NS, sizes: parts.map((p) => p.byteLength),
      clock: [this.phase, this.time, this.frame, this.substepCount], userTargets: !!this.userTargets, gravity: this.gravity,
    }));
    const pad = (n) => Math.ceil(n / 4) * 4;
    const out = new Uint8Array(4 + pad(header.byteLength) + parts.reduce((n, p) => n + pad(p.byteLength), 0));
    new DataView(out.buffer).setUint32(0, header.byteLength, true);
    out.set(header, 4);
    let o = 4 + pad(header.byteLength);
    for (const p of parts) { out.set(p, o); o += pad(p.byteLength); }
    return out;
  }

  // Puts the state of a snapshot() of a Sim of the same scene back.
  restore(bytes) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)));
    if (h.version !== 1 || h.NB !== this.NB || h.NS !== this.NS) throw new Error('restore: the snapshot is of another scene');
    const pad = (k) => Math.ceil(k / 4) * 4;
    let o = 4 + pad(n);
    const part = () => { const k = h.sizes.shift(); const p = bytes.slice(o, o + k); o += pad(k); return p; };
    for (const name of SNAPSHOT_BUFFERS) {
      const p = part();
      if (p.byteLength !== this.buffers[name].size) throw new Error('restore: the snapshot is of another scene');
      this.device.queue.writeBuffer(this.buffers[name], 0, p);
    }
    this.bodyBase.set(new Float32Array(part().buffer));
    const SF = this.layout.SF;
    const ext = new Float32Array(part().buffer);
    this.statF.set(ext, SF.SF_BODYX * 4);
    this.device.queue.writeBuffer(this.buffers.statF, SF.SF_BODYX * 16, ext);
    this.disabled.set(part());
    this.noCollide.set(part());
    for (let b = 0; b < this.NB; b++) this.writeBody(b);
    this.writeFilter();
    [this.phase, this.time, this.frame, this.substepCount] = h.clock;
    this.userTargets = h.userTargets;
    this.gravity = h.gravity;
    this.pick = null;
  }

  // The contacts of the last substep: bodies a < b (-1 is the world), the contact point and the normal from
  // a toward b (world frame), and the signed gap phi (m; below 0 the shapes overlap). Steel also keeps contacts up to the
  // shapes' gap apart, so a touch is phi near 0 or below.
  async contacts() {
    const [stats, room] = await this.readAll([['stats', 64, 0], ['contacts', Math.min(this.contactRoom ?? 64, this.C.MAXC) * 80, 0]]);
    return this.contactsFrom(stats, room);
  }

  // framefields: contacts from a stats read and a read of the first contact records; reads the rest
  // when there were more than that (and leaves room for as many next time).
  async contactsFrom(stats, first) {
    const n = Math.min(new Uint32Array(stats)[5], this.C.MAXC);
    this.contactRoom = Math.max(this.contactRoom ?? 64, Math.min(2 * n, this.C.MAXC));
    if (!n) return [];
    const f = n * 80 <= first.byteLength ? new Float32Array(first, 0, n * 20) : new Float32Array(await this.read('contacts', n * 5 * 16));
    const out = [];
    for (let c = 0; c < n; c++) {
      const o = c * 20;
      if (f[o + 15] < 0) continue;  // a rope's row (negative torsion radius), not a contact
      out.push({ a: f[o + 8], b: f[o + 9], point: [f[o], f[o + 1], f[o + 2]], normal: [f[o + 4], f[o + 5], f[o + 6]], phi: f[o + 3] });
    }
    return out;
  }

  // framefields: several buffer ranges ([name, bytes, offset]) in one copy and one map.
  async readAll(parts) {
    const dev = this.device;
    let size = 0;
    const at = parts.map(([, bytes]) => { const o = size; size += bytes; return o; });
    this.readPool ??= new Map();
    const pool = this.readPool.get(size) ?? [];
    this.readPool.set(size, pool);
    const st = pool.pop() ?? dev.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder();
    parts.forEach(([name, bytes, offset], i) => enc.copyBufferToBuffer(this.buffers[name], offset, st, at[i], bytes));
    dev.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const all = st.getMappedRange();
    const out = parts.map(([, bytes], i) => all.slice(at[i], at[i] + bytes));
    st.unmap();
    pool.push(st);
    return out;
  }

  // Staging buffers are pooled by size: stats and state are read several times a second.
  async read(name, bytes, offset = 0) {
    const dev = this.device;
    this.readPool ??= new Map();
    const pool = this.readPool.get(bytes) ?? [];
    this.readPool.set(bytes, pool);
    const st = pool.pop() ?? dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(name === 'query' ? this.queryBuf : this.buffers[name], offset, st, 0, bytes);
    dev.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const out = st.getMappedRange().slice(0);
    st.unmap();
    pool.push(st);
    return out;
  }

  async poses() { return new Float32Array(await this.read('poses', this.NB * 32)); }

  // Queue a pose readback from a small buffer pool; resolves with a copy.
  readPosesPooled() {
    const bytes = this.NB * 32;
    this.posePool ??= [];
    const st = this.posePool.pop() ?? this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buffers.poses, 0, st, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    return st.mapAsync(GPUMapMode.READ).then(() => {
      const out = new Float32Array(st.getMappedRange().slice(0));
      st.unmap();
      this.posePool.push(st);
      return out;
    });
  }

  async stats() {
    const s = new Uint32Array(await this.read('stats', 64));
    const C = this.C;
    const out = { maxContacts: s[1], maxColors: s[2], maxUnits: s[3], maxPairs: s[4], contacts: s[5], colors: s[6], maxDense: s[7], asleep: s[8] };
    // Buffers that filled up at some point; their excess pairs, contacts, units or dense rows were dropped.
    out.overflow = [['pairs', s[4], C.MAXP], ['contacts', s[1], C.MAXC], ['units', s[3], C.MAXU], ['dense rows', s[7], C.MAXDENSE]]
      .filter(([, n, cap]) => n >= cap).map(([name]) => name);
    if (this.hasTimestamps) {
      const t = new BigUint64Array(await this.read('query', 16));
      out.gpuFrameMs = Number(t[1] - t[0]) / 1e6;
    }
    return out;
  }
}
