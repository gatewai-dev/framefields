// Asset loaders that fill a SceneBuilder: URDF, MJCF and USDA (UsdPhysics), plus STL and OBJ meshes.
// They follow Newton's importers where those define the meaning (frames, damping, inertia overrides).
// Collision meshes become convex hulls of their vertices: the solver has no triangle-mesh collision.

const IDENTITY = [0, 0, 0, 0, 0, 0, 1];

// --- math --------------------------------------------------------------------------------------
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qaxis = (axis, angle) => {
  const n = Math.hypot(...axis) || 1, s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
function qrot(q, v) {
  const u = [q[0], q[1], q[2]];
  const c = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const t = c(u, v).map((x) => 2 * x);
  const ut = c(u, t);
  return [v[0] + q[3] * t[0] + ut[0], v[1] + q[3] * t[1] + ut[1], v[2] + q[3] * t[2] + ut[2]];
}
const tmul = (a, b) => { const p = qrot(a.slice(3), b.slice(0, 3)); return [a[0] + p[0], a[1] + p[1], a[2] + p[2], ...qmul(a.slice(3), b.slice(3))]; };
// Newton's quat_rpy: roll about x, then pitch about y, then yaw about z (fixed axes).
export const quatRpy = (r, p, y) => qmul(qaxis([0, 0, 1], y), qmul(qaxis([0, 1, 0], p), qaxis([1, 0, 0], r)));
function matToQuat(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const tr = a + e + i;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(h - f) / s, (c - g) / s, (d - b) / s, 0.25 * s]; }
  else if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; q = [0.25 * s, (b + d) / s, (c + g) / s, (h - f) / s]; }
  else if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / s, 0.25 * s, (f + h) / s, (c - g) / s]; }
  else { const s = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / s, (f + h) / s, 0.25 * s, (d - b) / s]; }
  const n = Math.hypot(...q);
  return q.map((x) => x / n);
}
const nums = (s, d) => (s == null || s === '' ? d : s.trim().split(/[\s,]+/).map(Number));

// --- meshes ------------------------------------------------------------------------------------
// STL (binary or ASCII) to { vertices: Float32Array, indices: Uint32Array }.
export function parseSTL(data) {
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (buf.byteLength === 84 + n * 50) {
    const vertices = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) vertices[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
    return { vertices, indices: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
  }
  const text = new TextDecoder().decode(buf);
  const v = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  return { vertices: Float32Array.from(v), indices: Uint32Array.from({ length: v.length / 3 }, (_, i) => i) };
}

// OBJ (vertices and polygon faces, fan-triangulated) to { vertices, indices }.
export function parseOBJ(text) {
  const v = [], idx = [];
  for (const line of (typeof text === 'string' ? text : new TextDecoder().decode(text)).split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'f') {
      const f = p.slice(1).map((t) => { const i = parseInt(t.split('/')[0], 10); return i < 0 ? v.length / 3 + i : i - 1; });
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
    }
  }
  return { vertices: Float32Array.from(v), indices: Uint32Array.from(idx) };
}

// Fetch a mesh file and parse it by extension.
export async function fetchMesh(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`mesh ${url}: HTTP ${r.status}`);
  const ext = meshKind(url);
  if (ext === 'stl') return parseSTL(await r.arrayBuffer());
  if (ext === 'obj') return parseOBJ(await r.text());
  throw new Error(`mesh ${url}: only STL and OBJ are supported`);
}

const scaled = (mesh, s) => {
  const v = Float32Array.from(mesh.vertices);
  for (let i = 0; i < v.length; i++) v[i] *= s[i % 3];
  return { vertices: v, indices: mesh.indices };
};
// package://name/rest resolves to packages[name] + rest, else to the package root one level above
// the file (the usual ROS layout, e.g. name/urdf/robot.urdf).
const resolveUrl = (path, base, packages = {}) => {
  const m = /^package:\/\/([^/]+)\/(.*)$/.exec(path);
  if (m) return packages[m[1]] ? new URL(m[2], packages[m[1]]).href : new URL(`../${m[2]}`, base).href;
  return base ? new URL(path, base).href : path;
};
const meshKind = (url) => url.split('?')[0].split('.').pop().toLowerCase();
const xml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`XML: ${err.textContent.slice(0, 200)}`);
  return doc.documentElement;
};
const kids = (el, tag) => [...el.children].filter((c) => c.tagName === tag);

// --- URDF --------------------------------------------------------------------------------------
// Add a URDF robot. baseUrl resolves mesh files (package:// prefixes are stripped). The root is
// fixed to the world at xform unless floating. Returns { bodies, joints } keyed by link and joint name.
export async function loadURDF(builder, text, { baseUrl, packages, xform = IDENTITY, floating = false, density = 1000, material = {}, loadMesh = fetchMesh } = {}) {
  const doc = xml(text);
  const origin = (el) => {
    const o = el && kids(el, 'origin')[0];
    if (!o) return [...IDENTITY];
    return [...nums(o.getAttribute('xyz'), [0, 0, 0]), ...quatRpy(...nums(o.getAttribute('rpy'), [0, 0, 0]))];
  };
  const links = kids(doc, 'link'), joints = kids(doc, 'joint');
  const childOf = new Map(joints.map((j) => [kids(j, 'child')[0].getAttribute('link'), j]));
  const rootLink = links.find((l) => !childOf.has(l.getAttribute('name')));
  const byParent = new Map();
  for (const j of joints) {
    const p = kids(j, 'parent')[0].getAttribute('link');
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(j);
  }
  const linkEl = new Map(links.map((l) => [l.getAttribute('name'), l]));
  const bodies = new Map(), jointIds = new Map();

  const createLink = async (name, linkXform = IDENTITY) => {
    const el = linkEl.get(name);
    const body = builder.addBody({ label: name, xform: linkXform });
    bodies.set(name, body);
    for (const c of kids(el, 'collision')) {
      const g = kids(c, 'geometry')[0];
      if (!g) continue;
      const opts = { xform: origin(c), density, ...material };
      for (const s of g.children) {
        if (s.tagName === 'box') { const [x, y, z] = nums(s.getAttribute('size'), [1, 1, 1]); builder.addShapeBox(body, { hx: x / 2, hy: y / 2, hz: z / 2, ...opts }); }
        else if (s.tagName === 'sphere') builder.addShapeSphere(body, { radius: +(s.getAttribute('radius') ?? 1), ...opts });
        else if (s.tagName === 'cylinder') builder.addShapeCylinder(body, { radius: +(s.getAttribute('radius') ?? 1), halfHeight: +(s.getAttribute('length') ?? 1) / 2, ...opts });
        else if (s.tagName === 'capsule') builder.addShapeCapsule(body, { radius: +(s.getAttribute('radius') ?? 1), halfHeight: +(s.getAttribute('height') ?? 1) / 2, ...opts });
        else if (s.tagName === 'mesh') {
          const mesh = scaled(await loadMesh(resolveUrl(s.getAttribute('filename'), baseUrl, packages)), nums(s.getAttribute('scale'), [1, 1, 1]));
          builder.addShapeConvexHull(body, { vertices: mesh.vertices, ...opts });
        }
      }
    }
    for (const v of kids(el, 'visual')) {
      const m = kids(kids(v, 'geometry')[0] ?? v, 'mesh')[0];
      if (!m) continue;
      const url = resolveUrl(m.getAttribute('filename'), baseUrl, packages);
      if (loadMesh === fetchMesh && !['stl', 'obj'].includes(meshKind(url))) { console.warn(`visual mesh ${url} skipped: only STL and OBJ load`); continue; }
      const mesh = scaled(await loadMesh(url), nums(m.getAttribute('scale'), [1, 1, 1]));
      builder.addVisualMesh(body, { ...mesh, xform: origin(v) });
    }
    // An <inertial> overrides the shapes' mass properties, as in Newton.
    const inertial = kids(el, 'inertial')[0];
    if (inertial) {
      const f = origin(inertial);
      const mass = +(kids(inertial, 'mass')[0]?.getAttribute('value') ?? 0);
      const ie = kids(inertial, 'inertia')[0];
      const g = (k) => +(ie?.getAttribute(k) ?? 0);
      const I = [g('ixx'), g('ixy'), g('ixz'), g('ixy'), g('iyy'), g('iyz'), g('ixz'), g('iyz'), g('izz')];
      builder.setBodyInertia(body, { mass, com: f.slice(0, 3), inertia: rotateInertia(I, f.slice(3)) });
    }
    return body;
  };
  // Depth first: a link, the joint to it, then its subtree, so parents come before children.
  const walk = async (name) => {
    for (const j of byParent.get(name) ?? []) {
      const child = kids(j, 'child')[0].getAttribute('link');
      await createLink(child);
      jointIds.set(j.getAttribute('name'), addURDFJoint(builder, j, bodies.get(name), bodies.get(child), origin(j)));
      await walk(child);
    }
  };
  const rootName = rootLink.getAttribute('name');
  const root = await createLink(rootName, xform);
  if (!floating) builder.addJointFixed(-1, root, { parentXform: xform, label: 'fixed_base' });
  await walk(rootName);
  return { bodies, joints: jointIds, root };
}

function rotateInertia(I, q) {
  const [x, y, z, w] = q;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += R[r * 3 + a] * I[a * 3 + b] * R[c * 3 + b];
    out[r * 3 + c] = v;
  }
  return out;
}

function addURDFJoint(builder, j, parent, child, parentXform) {
  const type = j.getAttribute('type');
  const axis = nums(kids(j, 'axis')[0]?.getAttribute('xyz'), [1, 0, 0]);
  const lim = kids(j, 'limit')[0], dyn = kids(j, 'dynamics')[0];
  const dof = { label: j.getAttribute('name'), parentXform };
  // Newton's default joint_damping_mode: URDF damping becomes drive damping.
  if (dyn) { dof.targetKd = +(dyn.getAttribute('damping') ?? 0); dof.friction = +(dyn.getAttribute('friction') ?? 0); }
  if (lim) {
    if (lim.hasAttribute('effort')) dof.effortLimit = +lim.getAttribute('effort');
    if (lim.hasAttribute('velocity')) dof.velocityLimit = +lim.getAttribute('velocity');
  }
  const limits = {};
  if (lim && type !== 'continuous') {
    if (lim.hasAttribute('lower')) limits.limitLower = +lim.getAttribute('lower');
    if (lim.hasAttribute('upper')) limits.limitUpper = +lim.getAttribute('upper');
  }
  if (type === 'revolute' || type === 'continuous') return builder.addJointRevolute(parent, child, { axis, ...dof, ...limits });
  if (type === 'prismatic') return builder.addJointPrismatic(parent, child, { axis, ...dof, ...limits });
  if (type === 'fixed') return builder.addJointFixed(parent, child, dof);
  if (type === 'floating') return builder.addJoint(4, parent, child, { ...dof, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]], linear: 3 });
  if (type === 'planar') {
    const n = axis.map((v) => v / Math.hypot(...axis));
    const h = Math.abs(n[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    const c = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const u = c(h, n), v = c(n, u);
    return builder.addJointD6(parent, child, { linearAxes: [u, v], angularAxes: [n], ...dof, ...limits });
  }
  throw new Error(`URDF joint type ${type} is not supported`);
}

// --- MJCF --------------------------------------------------------------------------------------
// Add an MJCF model (worldbody, nested defaults, mesh assets, joints, position/velocity/PD-general actuators,
// contact excludes). Several hinge/slide joints in one body become one D6 joint (slides first), as
// in Newton. baseUrl resolves mesh files against the compiler meshdir.
export async function loadMJCF(builder, text, { baseUrl, xform = IDENTITY, loadMesh = fetchMesh, material = {} } = {}) {
  const doc = xml(text);
  const compiler = kids(doc, 'compiler')[0];
  const degrees = (compiler?.getAttribute('angle') ?? 'degree') === 'degree';
  const eulerseq = compiler?.getAttribute('eulerseq') ?? 'xyz';
  const meshBase = new URL((compiler?.getAttribute('meshdir') ?? '').replace(/\/?$/, '/'), baseUrl ?? location.href).href;
  const ang = (v) => (degrees ? (v * Math.PI) / 180 : v);

  // Default classes: name -> { tag: attributes }, each inheriting its parent's.
  const classes = new Map();
  const readDefaults = (el, parent) => {
    const name = el.getAttribute('class') ?? 'main';
    const own = {};
    for (const [tag, attrs] of Object.entries(parent ?? {})) own[tag] = { ...attrs };
    for (const c of el.children) {
      if (c.tagName === 'default') continue;
      own[c.tagName] = { ...(own[c.tagName] ?? {}), ...Object.fromEntries([...c.attributes].map((a) => [a.name, a.value])) };
    }
    classes.set(name, own);
    for (const c of kids(el, 'default')) readDefaults(c, own);
  };
  for (const d of kids(doc, 'default')) readDefaults(d, null);
  const attrs = (el, cls) => {
    const tag = el.tagName === 'freejoint' ? 'joint' : el.tagName;
    const base = classes.get(el.getAttribute('class') ?? cls ?? 'main')?.[tag] ?? {};
    return { ...base, ...Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])) };
  };

  const orient = (a) => {
    if (a.quat) { const [w, x, y, z] = nums(a.quat); const n = Math.hypot(w, x, y, z); return [x / n, y / n, z / n, w / n]; }
    if (a.euler) {
      const e = nums(a.euler).map(ang);
      let r = [0, 0, 0, 1];
      [...eulerseq].forEach((ch, k) => {
        const ax = [0, 0, 0]; ax['xyz'.indexOf(ch.toLowerCase())] = 1;
        const q = qaxis(ax, e[k]);
        r = ch === ch.toLowerCase() ? qmul(r, q) : qmul(q, r);
      });
      return r;
    }
    if (a.axisangle) { const v = nums(a.axisangle); return qaxis(v.slice(0, 3), ang(v[3])); }
    if (a.xyaxes) {
      const v = nums(a.xyaxes);
      const nrm = (u) => { const n = Math.hypot(...u); return u.map((x) => x / n); };
      const c = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const x = nrm(v.slice(0, 3)), z = nrm(c(x, v.slice(3))), y = nrm(c(z, x));
      return matToQuat([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]);
    }
    if (a.zaxis) {
      const z = nums(a.zaxis); const n = Math.hypot(...z); const zz = z.map((x) => x / n);
      let axis = [-zz[1], zz[0], 0];
      if (axis[0] ** 2 + axis[1] ** 2 < 1e-14) axis = [1, 0, 0];
      return qaxis(axis, Math.atan2(Math.hypot(zz[0], zz[1]), zz[2]));
    }
    return [0, 0, 0, 1];
  };
  const pose = (a) => [...nums(a.pos, [0, 0, 0]), ...orient(a)];

  const meshes = new Map();
  for (const m of kids(doc, 'asset').flatMap((a) => kids(a, 'mesh'))) {
    const a = attrs(m);
    const file = a.file;
    // framefields: maxhullvert caps the mesh's collision hull (-1 keeps every vertex; unset, the builder's cap).
    const cap = a.maxhullvert === undefined ? undefined : +a.maxhullvert < 0 ? Infinity : +a.maxhullvert;
    meshes.set(a.name ?? file.split('/').pop().replace(/\.[^.]+$/, ''), { url: new URL(file, meshBase).href, scale: nums(a.scale, [1, 1, 1]), maxVertices: cap });
  }
  const meshCache = new Map();
  const getMesh = async (name) => {
    if (!meshCache.has(name)) {
      const m = meshes.get(name);
      if (!m) throw new Error(`MJCF mesh ${name} is not defined`);
      meshCache.set(name, scaled(await loadMesh(m.url), m.scale));
    }
    return meshCache.get(name);
  };

  // Geoms of a body (body -1 for worldbody); visual-class or non-colliding geoms render only.
  const addGeoms = async (el, body, frame, cls) => {
    for (const g of kids(el, 'geom')) {
      const a = attrs(g, cls);
      const type = a.type ?? 'sphere';
      const size = nums(a.size, [1, 1, 1]);
      const gcls = g.getAttribute('class');
      const visual = gcls ? /^visual/.test(gcls) || (!/^collision/.test(gcls) && +(a.contype ?? 1) === 0 && +(a.conaffinity ?? 1) === 0)
        : +(a.contype ?? 1) === 0 && +(a.conaffinity ?? 1) === 0;
      let xf = tmul(frame, pose(a));
      let half = size[1];
      if (a.fromto && (type === 'capsule' || type === 'cylinder')) {
        const v = nums(a.fromto);
        const s0 = tmul(frame, [...v.slice(0, 3), 0, 0, 0, 1]).slice(0, 3), s1 = tmul(frame, [...v.slice(3), 0, 0, 0, 1]).slice(0, 3);
        const d = [s0[0] - s1[0], s0[1] - s1[1], s0[2] - s1[2]];
        const len = Math.hypot(...d);
        half = len / 2;
        const dz = d.map((x) => x / len);
        const axis = [-dz[1], dz[0], 0];
        const q = dz[2] < -0.999999 ? [1, 0, 0, 0] : Math.hypot(...axis) < 1e-9 ? [0, 0, 0, 1] : qaxis(axis, Math.acos(Math.max(-1, Math.min(1, dz[2]))));
        xf = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2, (s0[2] + s1[2]) / 2, ...q];
      }
      if (visual) {
        if (type === 'mesh' && body >= 0) {
          try { builder.addVisualMesh(body, { ...(await getMesh(a.mesh)), xform: xf }); } catch (e) { console.warn(e.message); }
        }
        continue;
      }
      const fr = nums(a.friction, []);
      const opts = { xform: xf, ...material, ...(fr.length ? { mu: fr[0] } : {}), ...(fr.length > 1 ? { muTorsional: fr[1] } : {}), ...(fr.length > 2 ? { muRolling: fr[2] } : {}) };
      if (a.mass !== undefined) opts.mass = +a.mass; else opts.density = +(a.density ?? 1000);
      if (type === 'sphere') builder.addShapeSphere(body, { radius: size[0], ...opts });
      else if (type === 'box') builder.addShapeBox(body, { hx: size[0], hy: size[1], hz: size[2], ...opts });
      else if (type === 'capsule') builder.addShapeCapsule(body, { radius: size[0], halfHeight: half, ...opts });
      else if (type === 'cylinder') builder.addShapeCylinder(body, { radius: size[0], halfHeight: half, ...opts });
      else if (type === 'plane') builder.addShape(body, 1, [0, 0, 0], opts);
      else if (type === 'mesh') {
        const cap = meshes.get(a.mesh)?.maxVertices;
        builder.addShapeConvexHull(body, { vertices: (await getMesh(a.mesh)).vertices, ...opts, ...(cap !== undefined && { maxVertices: cap }) });
      }
      else console.warn(`MJCF geom type ${type} skipped`);
    }
  };

  const bodies = new Map(), joints = new Map(), dofOf = new Map();
  const world = kids(doc, 'worldbody')[0];
  const walk = async (el, parent, parentWorld, frame, cls) => {
    for (const c of el.children) {
      if (c.tagName === 'frame') { await walk(c, parent, parentWorld, tmul(frame, pose(attrs(c, cls))), c.getAttribute('childclass') ?? cls); continue; }
      if (c.tagName !== 'body') continue;
      const a = attrs(c, cls);
      const ccls = c.getAttribute('childclass') ?? cls;
      const name = a.name ?? `body_${builder.bodies.length}`;
      const local = tmul(frame, pose(a));
      const worldXf = tmul(parentWorld, local);
      const body = builder.addBody({ label: name, xform: worldXf });
      bodies.set(name, body);
      const js = [...c.children].filter((x) => x.tagName === 'joint' || x.tagName === 'freejoint').map((x) => [x, attrs(x, ccls)]);
      const jpos = js.length ? nums(js[0][1].pos, [0, 0, 0]) : [0, 0, 0];
      const pj = [...tmul(local, [...jpos, 0, 0, 0, 1]).slice(0, 3), ...local.slice(3)];
      const label = js.length ? js.map(([x, ja]) => ja.name ?? `${name}_joint`).join('_') : `${name}_joint`;
      const free = js.find(([x, ja]) => x.tagName === 'freejoint' || ja.type === 'free');
      const cfgOf = (ja, linear) => {
        const cfg = { armature: +(ja.armature ?? 0), friction: +(ja.frictionloss ?? 0), damping: +(ja.damping ?? 0) };
        const range = nums(ja.range, null);
        const limited = ja.limited ?? 'auto';
        if (range && limited !== 'false') {
          const ref = linear ? +(ja.ref ?? 0) : ang(+(ja.ref ?? 0));
          cfg.limitLower = (linear ? range[0] : ang(range[0])) - ref;
          cfg.limitUpper = (linear ? range[1] : ang(range[1])) - ref;
        }
        if (ja.actuatorfrcrange) { const r = nums(ja.actuatorfrcrange); cfg.effortLimit = Math.max(Math.abs(r[0]), Math.abs(r[1])); }
        return cfg;
      };
      let j;
      if (free) j = builder.addJointFree(body, { label: free[1].name ?? `${name}_joint` });
      else if (!js.length) j = builder.addJointFixed(parent, body, { parentXform: parent < 0 ? worldXf : local, label });
      else if (js.length === 1 && js[0][1].type === 'ball') {
        j = builder.addJointBall(parent, body, { parentXform: parent < 0 ? tmul(worldXf, [...jpos, 0, 0, 0, 1]) : pj, childXform: [...jpos, 0, 0, 0, 1], label, ...cfgOf(js[0][1], false) });
      } else {
        const lin = js.filter(([, ja]) => ja.type === 'slide'), angl = js.filter(([, ja]) => (ja.type ?? 'hinge') === 'hinge');
        const axisOf = (ja) => nums(ja.axis, [0, 0, 1]);
        const common = { parentXform: parent < 0 ? tmul(worldXf, [...jpos, 0, 0, 0, 1]) : pj, childXform: [...jpos, 0, 0, 0, 1], label };
        if (lin.length === 0 && angl.length === 1) j = builder.addJointRevolute(parent, body, { axis: axisOf(angl[0][1]), ...common, ...cfgOf(angl[0][1], false) });
        else if (lin.length === 1 && angl.length === 0) j = builder.addJointPrismatic(parent, body, { axis: axisOf(lin[0][1]), ...common, ...cfgOf(lin[0][1], true) });
        else {
          j = builder.addJointD6(parent, body, { ...common,
            linearAxes: lin.map(([, ja]) => ({ axis: axisOf(ja), ...cfgOf(ja, true) })), angularAxes: angl.map(([, ja]) => ({ axis: axisOf(ja), ...cfgOf(ja, false) })) });
        }
        [...lin, ...angl].forEach(([, ja], k) => { if (ja.name) dofOf.set(ja.name, [j, k]); });
      }
      if (!free && js.length === 1 && js[0][1].name) dofOf.set(js[0][1].name, [j, 0]);
      joints.set(label, j);
      await addGeoms(c, body, IDENTITY, ccls);
      const inertial = kids(c, 'inertial')[0];
      if (inertial && (compiler?.getAttribute('inertiafromgeom') ?? 'auto') !== 'true') {
        const ia = attrs(inertial, ccls);
        const f = pose(ia);
        let I;
        if (ia.diaginertia) { const d = nums(ia.diaginertia); I = [d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]]; }
        else { const v = nums(ia.fullinertia, [0, 0, 0, 0, 0, 0]); I = [v[0], v[3], v[4], v[3], v[1], v[5], v[4], v[5], v[2]]; }
        builder.setBodyInertia(body, { mass: +(ia.mass ?? 0), com: f.slice(0, 3), inertia: rotateInertia(I, f.slice(3)) });
      }
      await walk(c, body, worldXf, IDENTITY, ccls);
    }
  };
  await addGeoms(world, -1, xform, 'main');
  await walk(world, -1, xform, IDENTITY, 'main');

  // Actuators: position (kp, kv) and velocity (kv) set the joint's drive gains.
  // framefields: forcerange caps the drive's torque (effortLimit), as MuJoCo clamps the actuator's force: when
  // forcelimited is true, or left to autolimits (MuJoCo's default) and a range is given.
  const autolimits = (compiler?.getAttribute('autolimits') ?? 'true') === 'true';
  const effortOf = (a) => {
    const limited = a.forcelimited === 'true' || (a.forcelimited !== 'false' && autolimits && a.forcerange !== undefined);
    const [lo, hi] = nums(a.forcerange, [0, 0]);
    return limited && hi > lo ? { effortLimit: Math.max(Math.abs(lo), Math.abs(hi)) } : {};
  };
  for (const act of kids(doc, 'actuator').flatMap((a) => [...a.children])) {
    const a = attrs(act);
    const target = dofOf.get(a.joint);
    if (!target) continue;
    const effort = effortOf(a);
    if (act.tagName === 'position') builder.setJointDofConfig(target[0], target[1], { targetKe: +(a.kp ?? 1), targetKd: +(a.kv ?? 0), ...effort });
    else if (act.tagName === 'velocity') builder.setJointDofConfig(target[0], target[1], { targetKd: +(a.kv ?? 1), ...effort });
    else if (act.tagName === 'general' && a.biastype === 'affine') {
      // A PD servo (gain kp, bias -kp, -kv) becomes the joint drive; Newton leaves it to MuJoCo's actuators.
      const g = nums(a.gainprm, [1]), b = nums(a.biasprm, [0, 0, 0]);
      if (Math.abs(g[0] + (b[1] ?? 0)) <= 1e-9 * Math.abs(g[0])) builder.setJointDofConfig(target[0], target[1], { targetKe: g[0], targetKd: -(b[2] ?? 0), ...effort });
    }
  }
  // <contact><exclude body1 body2>: no collisions between the two bodies' shapes.
  for (const ex of kids(doc, 'contact').flatMap((c) => kids(c, 'exclude'))) {
    const b1 = bodies.get(ex.getAttribute('body1')), b2 = bodies.get(ex.getAttribute('body2'));
    builder.shapes.forEach((s1, i) => builder.shapes.forEach((s2, k) => {
      if (i < k && ((s1.body === b1 && s2.body === b2) || (s1.body === b2 && s2.body === b1))) builder.addCollisionFilter(i, k);
    }));
  }
  return { bodies, joints, dofs: dofOf };
}

// --- USDA (UsdPhysics) -------------------------------------------------------------------------
// Parse text USD into a prim tree: { path, name, type, api: [schemas], attrs: { name: value }, children }.
// References, payloads, variants and time samples are not resolved.
export function parseUSDA(text) {
  const tokens = [];
  const re = /\s+|#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[^@]*@|<[^>]*>|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-?inf\b|nan\b|[A-Za-z_][\w:.]*|[()[\]{}=,;&]/y;
  let m;
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    const t = m[0];
    if (/^\s|^#/.test(t)) continue;
    tokens.push(t);
  }
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const expect = (t) => { if (tokens[i] !== t) throw new Error(`USDA: expected ${t} near token ${i}: ${tokens.slice(i - 3, i + 3).join(' ')}`); i++; };
  const value = () => {
    const t = next();
    if (t === '(' || t === '[') {
      const close = t === '(' ? ')' : ']', out = [];
      while (peek() !== close) { out.push(value()); if (peek() === ',') i++; }
      i++;
      return out;
    }
    if (t === '{') { let d = 1; while (d) { const u = next(); if (u === '{') d++; else if (u === '}') d--; } return null; }
    if (/^["']/.test(t)) return t.replace(/^("""|'''|"|')|("""|'''|"|')$/g, '');
    if (t[0] === '<') return t.slice(1, -1);
    if (/^-?(\d|\.)/.test(t) || /inf|nan/.test(t)) return Number(t.replace('inf', 'Infinity'));
    if (t === 'true') return true;
    if (t === 'false') return false;
    return t;
  };
  const skipParens = () => { let d = 0; do { const t = next(); if (t === '(' ) d++; else if (t === ')') d--; } while (d); };
  const metadata = () => {
    const meta = {};
    if (peek() !== '(') return meta;
    i++;
    while (peek() !== ')') {
      let t = next();
      if (t === 'prepend' || t === 'append' || t === 'add' || t === 'delete' || t === 'reorder') t = next();
      if (peek() === '=') { i++; meta[t] = value(); } else if (peek() === '(') skipParens();
      if (peek() === ';' || peek() === ',') i++;
    }
    i++;
    return meta;
  };
  const prim = (parent) => {
    const spec = next();
    let type = '';
    if (!/^["']/.test(peek())) type = next();
    const name = value();
    const meta = metadata();
    const node = { name, type, spec, path: parent ? `${parent.path === '/' ? '' : parent.path}/${name}` : `/${name}`,
      api: [meta.apiSchemas ?? []].flat(), attrs: {}, children: [], parent };
    body(node);
    return node;
  };
  const body = (node) => {
    expect('{');
    while (peek() !== '}') {
      const t = peek();
      if (t === 'def' || t === 'over' || t === 'class') { node.children.push(prim(node)); continue; }
      if (t === 'variantSet') { while (next() !== '{'); let d = 1; while (d) { const u = next(); if (u === '{') d++; else if (u === '}') d--; } continue; }
      if (t === 'reorder') { next(); next(); next(); value(); continue; }
      // Property: [custom] [uniform|varying] type[[]] name [= value] [(meta)], or rel name [= targets].
      let isRel = false;
      while (['custom', 'uniform', 'varying', 'prepend', 'append', 'add', 'delete'].includes(peek())) i++;
      if (peek() === 'rel') { i++; isRel = true; } else { i++; if (peek() === '[') { i += 2; } }
      const name = next();
      let v;
      if (peek() === '=') { i++; v = value(); }
      if (peek() === '(') metadata();
      if (!/\.(timeSamples|connect|spline)$/.test(name)) node.attrs[name] = isRel ? [v].flat().filter((x) => x != null) : v;
    }
    i++;
  };
  const root = { name: '', path: '/', type: '', api: [], attrs: {}, children: [], parent: null, meta: {} };
  if (/^#usda/.test(text) === false) throw new Error('not a USDA file');
  root.meta = metadata();
  while (i < tokens.length) root.children.push(prim(null));
  return root;
}

// 4x4 row-major matrices with row vectors (USD convention: p' = p M).
const m4 = {
  I: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul: (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c]; return o; },
  T: (t) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1],
  S: (s) => [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1],
  Q: (q) => {
    const [x, y, z, w] = q;
    // Row-vector convention: the matrix is the transpose of the column-vector rotation.
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  },
};
// Decompose into position, rotation (x y z w) and per-axis scale (no shear).
function decompose(M) {
  const rows = [0, 1, 2].map((r) => [M[r * 4], M[r * 4 + 1], M[r * 4 + 2]]);
  const s = rows.map((r) => Math.hypot(...r));
  const R = rows.map((r, k) => r.map((v) => v / (s[k] || 1)));
  // R rows are the rotated basis vectors; the column-vector rotation matrix is its transpose.
  const q = matToQuat([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]);
  return { p: [M[12], M[13], M[14]], q, s };
}
const quatWXYZ = (v, d = [0, 0, 0, 1]) => (v ? [v[1], v[2], v[3], v[0]] : d);
function localMatrix(node) {
  const A = node.attrs;
  const order = A['xformOpOrder'] ?? [];
  let M = m4.I();
  // xformOpOrder lists ops outermost first; with row vectors the innermost op multiplies first.
  for (const op of [...order].reverse()) {
    if (op === '!resetXformStack!') continue;
    const inv = op.startsWith('!invert!');
    const name = op.replace('!invert!', '');
    const v = A[name];
    if (v == null) continue;
    let O;
    const kind = name.split(':')[1];
    if (kind === 'translate') O = m4.T(v);
    else if (kind === 'scale') O = m4.S(Array.isArray(v) ? v : [v, v, v]);
    else if (kind === 'orient') O = m4.Q(quatWXYZ(v));
    else if (kind === 'transform') O = v.flat();
    else if (kind.startsWith('rotate')) {
      const axes = kind.slice(6);
      const ang = Array.isArray(v) ? v : [v];
      O = m4.I();
      [...axes].forEach((ax, k) => {
        const a = [0, 0, 0]; a['XYZ'.indexOf(ax)] = 1;
        O = m4.mul(O, m4.Q(qaxis(a, (ang[k] * Math.PI) / 180)));
      });
    } else continue;
    if (inv) { const d = decompose(O); O = m4.mul(m4.mul(m4.T(d.p.map((x) => -x)), m4.Q([-d.q[0], -d.q[1], -d.q[2], d.q[3]])), m4.S(d.s.map((x) => 1 / x))); }
    M = m4.mul(M, O);
  }
  return M;
}

// Add the UsdPhysics content of a USDA stage: rigid bodies (PhysicsRigidBodyAPI), colliders
// (PhysicsCollisionAPI on Cube/Sphere/Capsule/Cylinder/Mesh/Plane), mass (PhysicsMassAPI), physics
// materials, and revolute/prismatic/spherical/fixed/D6 joints with limits and drives (angles in
// degrees, as in USD). Bodies and joints are labeled with their prim paths.
export function loadUSDA(builder, text, { xform = IDENTITY } = {}) {
  const root = parseUSDA(text);
  const mpu = root.meta.metersPerUnit ?? 1;
  const upY = root.meta.upAxis === 'Y';
  const D2R = Math.PI / 180;
  const all = [];
  const walk = (n, parentM) => {
    const M = m4.mul(localMatrix(n), parentM);
    n.world = M;
    if (n.spec === 'def') all.push(n);
    for (const c of n.children) walk(c, n.attrs['xformOpOrder']?.includes('!resetXformStack!') ? m4.I() : M);
  };
  let base = m4.S([mpu, mpu, mpu]);
  if (upY) base = m4.mul(base, m4.Q(qaxis([1, 0, 0], Math.PI / 2)));
  base = m4.mul(base, m4.mul(m4.Q(xform.slice(3)), m4.T(xform.slice(0, 3))));
  for (const c of root.children) walk(c, base);
  const byPath = new Map(all.map((n) => [n.path, n]));
  const has = (n, api) => n.api.some((a) => a === api || a.startsWith(api + ':'));

  const bodies = new Map();
  for (const n of all) {
    if (!has(n, 'PhysicsRigidBodyAPI') || n.attrs['physics:rigidBodyEnabled'] === false) continue;
    const d = decompose(n.world);
    const v = n.attrs['physics:velocity'] ?? [0, 0, 0], w = n.attrs['physics:angularVelocity'] ?? [0, 0, 0];
    const body = builder.addBody({ label: n.path, xform: [...d.p, ...d.q], kinematic: !!n.attrs['physics:kinematicEnabled'],
      twist: [...v.map((x) => x * mpu), ...w.map((x) => x * D2R)] });
    bodies.set(n.path, { body, node: n, scale: d.s });
  }
  const bodyOf = (n) => { for (let p = n; p; p = p.parent) if (bodies.has(p.path)) return bodies.get(p.path); return null; };
  const material = (n) => {
    const target = n.attrs['material:binding:physics']?.[0] ?? n.attrs['material:binding']?.[0];
    const mat = target && byPath.get(target);
    if (!mat || !has(mat, 'PhysicsMaterialAPI')) return {};
    const A = mat.attrs, o = {};
    if (A['physics:dynamicFriction'] != null) o.mu = A['physics:dynamicFriction'];
    if (A['physics:restitution'] != null) o.restitution = A['physics:restitution'];
    if (A['physics:density'] != null) o.density = A['physics:density'];
    return o;
  };
  const axisQ = (axis) => (axis === 'X' ? qaxis([0, 1, 0], Math.PI / 2) : axis === 'Y' ? qaxis([1, 0, 0], -Math.PI / 2) : [0, 0, 0, 1]);

  const inherit = new Set();
  for (const n of all) {
    if (!has(n, 'PhysicsCollisionAPI') || n.attrs['physics:collisionEnabled'] === false) continue;
    const owner = bodyOf(n);
    const B = owner ? m4.mul(m4.Q(decompose(owner.node.world).q), m4.T(decompose(owner.node.world).p)) : m4.I();
    const rel = decompose(m4.mul(n.world, invRigid(B)));
    const A = n.attrs, s = rel.s;
    const opts = { xform: [...rel.p, ...rel.q], ...material(n) };
    if (A['physics:mass'] > 0) opts.mass = A['physics:mass'];
    else if (A['physics:density'] > 0) opts.density = A['physics:density'];
    const own = opts.mass > 0 || opts.density > 0;
    const body = owner ? owner.body : -1;
    const before = builder.shapes.length;
    if (n.type === 'Cube') { const h = (A.size ?? 2) / 2; builder.addShapeBox(body, { hx: h * s[0], hy: h * s[1], hz: h * s[2], ...opts }); }
    else if (n.type === 'Sphere') builder.addShapeSphere(body, { radius: (A.radius ?? 1) * s[0], ...opts });
    else if (n.type === 'Capsule' || n.type === 'Cylinder') {
      const ax = A.axis ?? 'Z', k = 'XYZ'.indexOf(ax);
      const radial = s.filter((_, j) => j !== k);
      opts.xform = [...rel.p, ...qmul(rel.q, axisQ(ax))];
      const r = (A.radius ?? (n.type === 'Capsule' ? 0.5 : 1)) * Math.max(...radial);
      const hh = ((A.height ?? (n.type === 'Capsule' ? 1 : 2)) / 2) * s[k];
      if (n.type === 'Capsule') builder.addShapeCapsule(body, { radius: r, halfHeight: hh, ...opts });
      else builder.addShapeCylinder(body, { radius: r, halfHeight: hh, ...opts });
    } else if (n.type === 'Mesh') {
      const pts = (A.points ?? []).map((p) => [p[0] * s[0], p[1] * s[1], p[2] * s[2]]);
      if (pts.length >= 4) builder.addShapeConvexHull(body, { vertices: pts, ...opts });
    } else if (n.type === 'Plane') {
      opts.xform = [...rel.p, ...qmul(rel.q, axisQ(A.axis ?? 'Z'))];
      builder.addShape(body, 1, [0, 0, 0], opts);
    }
    if (!own) for (let k = before; k < builder.shapes.length; k++) inherit.add(k);
  }
  // Body density applies to its colliders without their own mass or density.
  for (const { body, node } of bodies.values()) {
    const rho = has(node, 'PhysicsMassAPI') ? node.attrs['physics:density'] : undefined;
    if (rho > 0) builder.shapes.forEach((sh, k) => { if (sh.body === body && inherit.has(k)) sh.o.density = rho; });
  }
  for (const { body, node } of bodies.values()) {
    const A = node.attrs;
    if (!has(node, 'PhysicsMassAPI') || !(A['physics:mass'] > 0)) continue;
    if (A['physics:diagonalInertia'] && A['physics:diagonalInertia'].some((x) => x > 0)) {
      const d = A['physics:diagonalInertia'];
      builder.setBodyInertia(body, { mass: A['physics:mass'], com: A['physics:centerOfMass'] ?? undefined,
        inertia: rotateInertia([d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]], quatWXYZ(A['physics:principalAxes'])) });
    } else {
      builder.bodies[body].mass = A['physics:mass'];
      if (A['physics:centerOfMass']) builder.bodies[body].com = A['physics:centerOfMass'];
    }
  }

  // Joints, parents before children (breadth first from the world).
  const jointNodes = all.filter((n) => /^Physics\w*Joint$/.test(n.type) && n.attrs['physics:jointEnabled'] !== false);
  // A joint with only body0 anchors body0 to the world: swap its sides so the world is the parent.
  const raw = (n, k) => { const t = n.attrs[`physics:body${k}`]?.[0]; return t ? bodyOf(byPath.get(t) ?? { path: t, parent: null }) : null; };
  const flipped = (n) => !raw(n, 1) && !!raw(n, 0);
  const ref = (n, k) => raw(n, flipped(n) ? 1 - k : k);
  const placed = new Set(), ordered = [];
  let frontier = jointNodes.filter((n) => !ref(n, 0));
  const pending = new Set(jointNodes);
  const parentDone = (n) => !ref(n, 0) || placed.has(ref(n, 0).body) || ![...jointNodes].some((j) => ref(j, 1)?.body === ref(n, 0).body);
  for (let guard = 0; pending.size && guard < jointNodes.length + 1; guard++) {
    frontier = [...pending].filter(parentDone);
    if (!frontier.length) frontier = [...pending];
    for (const n of frontier) { pending.delete(n); ordered.push(n); if (ref(n, 1)) placed.add(ref(n, 1).body); }
  }
  const joints = new Map();
  const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  for (const n of ordered) {
    const A = n.attrs, b0 = ref(n, 0), b1 = ref(n, 1);
    if (!b1) continue;
    const [k0, k1] = flipped(n) ? [1, 0] : [0, 1];
    const s0 = b0 ? b0.scale : [mpu, mpu, mpu], s1 = b1.scale;
    const lp0 = (A[`physics:localPos${k0}`] ?? [0, 0, 0]).map((x, k) => x * s0[k]);
    const lp1 = (A[`physics:localPos${k1}`] ?? [0, 0, 0]).map((x, k) => x * s1[k]);
    let parentXform = [...lp0, ...quatWXYZ(A[`physics:localRot${k0}`])];
    if (!b0) {
      // A world-anchored frame goes through the stage units, up axis and xform.
      const d = decompose(m4.mul(m4.mul(m4.Q(quatWXYZ(A[`physics:localRot${k0}`])), m4.T(A[`physics:localPos${k0}`] ?? [0, 0, 0])), base));
      parentXform = [...d.p, ...d.q];
    }
    const common = { parentXform, childXform: [...lp1, ...quatWXYZ(A[`physics:localRot${k1}`])], label: n.path,
      collisionFilterParent: !A['physics:collisionEnabled'] };
    const drive = (kind, angular) => {
      const g = (k) => A[`drive:${kind}:physics:${k}`];
      const c = {};
      if (!n.api.includes(`PhysicsDriveAPI:${kind}`)) return c;
      if (g('stiffness') != null) c.targetKe = angular ? g('stiffness') / D2R : g('stiffness');
      if (g('damping') != null) c.targetKd = angular ? g('damping') / D2R : g('damping');
      if (g('targetPosition') != null) c.targetPos = angular ? g('targetPosition') * D2R : g('targetPosition') * mpu;
      if (g('targetVelocity') != null) c.targetVel = angular ? g('targetVelocity') * D2R : g('targetVelocity') * mpu;
      if (g('maxForce') != null && Number.isFinite(g('maxForce'))) c.effortLimit = g('maxForce');
      return c;
    };
    const lim = (angular) => {
      const c = {}, lo = A['physics:lowerLimit'], hi = A['physics:upperLimit'];
      if (lo != null && Number.isFinite(lo)) c.limitLower = angular ? lo * D2R : lo * mpu;
      if (hi != null && Number.isFinite(hi)) c.limitUpper = angular ? hi * D2R : hi * mpu;
      return c;
    };
    const parent = b0 ? b0.body : -1;
    let j;
    if (n.type === 'PhysicsRevoluteJoint') j = builder.addJointRevolute(parent, b1.body, { axis: AX[A['physics:axis'] ?? 'X'], ...common, ...lim(true), ...drive('angular', true) });
    else if (n.type === 'PhysicsPrismaticJoint') j = builder.addJointPrismatic(parent, b1.body, { axis: AX[A['physics:axis'] ?? 'X'], ...common, ...lim(false), ...drive('linear', false) });
    else if (n.type === 'PhysicsSphericalJoint') j = builder.addJointBall(parent, b1.body, common);
    else if (n.type === 'PhysicsFixedJoint') j = builder.addJointFixed(parent, b1.body, common);
    else {
      // Generic joint: an axis is free unless its PhysicsLimitAPI locks it (low > high); limited otherwise.
      const axis = (name, angular) => {
        const lo = A[`limit:${name}:physics:low`], hi = A[`limit:${name}:physics:high`];
        if (lo != null && hi != null && lo > hi) return null;
        const c = { axis: AX[name.slice(-1)] };
        if (lo != null && Number.isFinite(lo)) c.limitLower = angular ? lo * D2R : lo * mpu;
        if (hi != null && Number.isFinite(hi)) c.limitUpper = angular ? hi * D2R : hi * mpu;
        return { ...c, ...drive(name, angular) };
      };
      const linear = ['transX', 'transY', 'transZ'].map((a) => axis(a, false)).filter(Boolean);
      const angular = ['rotX', 'rotY', 'rotZ'].map((a) => axis(a, true)).filter(Boolean);
      j = builder.addJointD6(parent, b1.body, { ...common, linearAxes: linear, angularAxes: angular });
    }
    joints.set(n.path, j);
  }
  return { bodies: new Map([...bodies].map(([p, b]) => [p, b.body])), joints };
}

function invRigid(M) {
  const d = decompose(M);
  const qi = [-d.q[0], -d.q[1], -d.q[2], d.q[3]];
  return m4.mul(m4.T(d.p.map((x) => -x)), m4.Q(qi));
}
