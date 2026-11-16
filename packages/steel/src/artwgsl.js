// Tree articulations (Featherstone articulated-body algorithm). Each link's spatial
// quantities are expressed at its own COM with world orientation (as Steel does), so
// light links far from the origin stay well conditioned: motion (w, v_com), force
// (t_com, f); parent/child exchange goes through point shifts. Steel's propagation response:
// per-step factorization with implicit drives in D, exact link responses with the
// joint split, and impulse propagation after each colored sweep.
export const ART = /* wgsl */ `
const LB: u32 = 268u;      // floats per link block in art[] (room for JM = 6)
const L_S: u32 = 0u;       // JM motion columns
const L_U: u32 = 36u;      // U = I^A S
const L_DI: u32 = 72u;     // D^-1 (JM x JM)
const L_IA: u32 = 108u;    // articulated inertia blocks A, B, C
const L_C: u32 = 135u;     // velocity-product acceleration
const L_PA: u32 = 141u;    // articulated bias force
const L_V: u32 = 147u;     // spatial velocity / scratch
const L_W: u32 = 153u;     // split COM response, 6x6 row-major
const L_A: u32 = 189u;     // spatial acceleration / scratch
const L_UU: u32 = 195u;    // joint bias u (JM)
const L_P: u32 = 201u;     // propagated force scratch
const L_DV: u32 = 207u;    // velocity change scratch
const L_POS: u32 = 213u;   // link origin
const L_ROT: u32 = 216u;   // link rotation
const L_COM: u32 = 220u;   // link COM (world)
const L_TAU: u32 = 223u;   // generalized test impulse (JM)
const L_JR: u32 = 229u;    // COM minus joint child origin (world)
const L_W2: u32 = 232u;    // unsplit COM response, 6x6 row-major (regularization reweight)
const PD: u32 = MAXPATH * JM;

struct SV { a: vec3f, l: vec3f };

fn link_type(l: u32) -> u32 { return u32(statF[SF_LINK + l * 6u].x); }
fn link_parent(l: u32) -> i32 { return i32(statF[SF_LINK + l * 6u].y); }
fn link_dof(l: u32) -> u32 { return u32(statF[SF_LINK + l * 6u].z); }
fn link_body(l: u32) -> i32 { return i32(statF[SF_LINK + l * 6u].w); }
fn link_ndof(l: u32) -> u32 { return u32(statF[SF_LINK + l * 6u + 1u].w); }
fn link_qs(l: u32) -> u32 { return u32(statF[SF_LINK + l * 6u + 3u].w); }
fn dof_drive(d: u32) -> vec4f { return statF[SF_DOF + d * 5u]; }    // armature, ke, kd, effort
fn dof_limit(d: u32) -> vec4f { return statF[SF_DOF + d * 5u + 1u]; } // lower, upper, limited, link
fn dof_passive(d: u32) -> vec4f { return statF[SF_DOF + d * 5u + 2u]; } // damping, friction, velocity limit (<0 none)
// Sleep state per node (free body b -> b, articulation a -> NB + a): age, asleep, union-find parent, flags.
fn body_node(b: i32) -> i32 {
  if (b < 0) { return -1; }
  let k = body_kind(b);
  if (k == 1u) { return b; }
  if (k == 2u || k == 3u) { return i32(NB) + body_art(b); }
  return -1;
}
fn art_has_constraint(a: u32) -> bool { return statU[SU_ACON + a] != 0u; }
fn node_asleep(n: i32) -> bool { return SLEEP == 1u && n >= 0 && art[A_SLP + u32(n) * 4u + 1u] > 0.5; }
fn dof_axis(d: u32) -> vec3f { return statF[SF_DOF + d * 5u + 3u].xyz; }
fn scalar_dof(d: u32) -> bool { return statF[SF_DOF + d * 5u + 2u].w > 0.5; }
fn dof_spring(d: u32) -> vec2f { return statF[SF_DOF + d * 5u + 4u].xy; } // stiffness, rest position
// A dof whose velocity limit rides the fused drive clamp (drive rows, fuse_joint_velocity_limits).
fn fused_dof(d: u32) -> bool { let dr = dof_drive(d); return DRIVE_ROWS == 1u && FUSE_VLIM == 1u && (dr.y > 0.0 || dr.z > 0.0); }
fn art_info(a: u32) -> vec4u { return vec4u(statU[SU_ART + a * 4u], statU[SU_ART + a * 4u + 1u], statU[SU_ART + a * 4u + 2u], statU[SU_ART + a * 4u + 3u]); }

fn lo(l: u32) -> u32 { return A_LINK + l * LB; }
fn ld3(o: u32) -> vec3f { return vec3f(art[o], art[o + 1u], art[o + 2u]); }
fn st3(o: u32, v: vec3f) { art[o] = v.x; art[o + 1u] = v.y; art[o + 2u] = v.z; }
fn ldsv(o: u32) -> SV { return SV(ld3(o), ld3(o + 3u)); }
fn stsv(o: u32, s: SV) { st3(o, s.a); st3(o + 3u, s.l); }
fn ldm(o: u32) -> mat3x3f { return mat3x3f(ld3(o), ld3(o + 3u), ld3(o + 6u)); }
fn stm(o: u32, m: mat3x3f) { st3(o, m[0]); st3(o + 3u, m[1]); st3(o + 6u, m[2]); }
fn sv0() -> SV { return SV(vec3f(0.0), vec3f(0.0)); }
fn sadd(x: SV, y: SV) -> SV { return SV(x.a + y.a, x.l + y.l); }
fn ssub(x: SV, y: SV) -> SV { return SV(x.a - y.a, x.l - y.l); }
fn sscale(x: SV, s: f32) -> SV { return SV(x.a * s, x.l * s); }
fn sdot(m: SV, f: SV) -> f32 { return dot(m.a, f.a) + dot(m.l, f.l); }
fn crm(v: SV, m: SV) -> SV { return SV(cross(v.a, m.a), cross(v.a, m.l) + cross(v.l, m.a)); }
fn crf(v: SV, f: SV) -> SV { return SV(cross(v.a, f.a) + cross(v.l, f.l), cross(v.a, f.l)); }
fn skew3(r: vec3f) -> mat3x3f { return mat3x3f(vec3f(0.0, r.z, -r.y), vec3f(-r.z, 0.0, r.x), vec3f(r.y, -r.x, 0.0)); }
fn outer3(x: vec3f, y: vec3f) -> mat3x3f { return mat3x3f(x * y.x, x * y.y, x * y.z); }
fn imul(o: u32, m: SV) -> SV {
  let A = ldm(o); let B = ldm(o + 9u); let C = ldm(o + 18u);
  return SV(A * m.a + B * m.l, transpose(B) * m.a + C * m.l);
}
fn ldS(l: u32, k: u32) -> SV { return ldsv(lo(l) + L_S + k * 6u); }
fn ldU(l: u32, k: u32) -> SV { return ldsv(lo(l) + L_U + k * 6u); }
fn ldDI(l: u32, r: u32, c: u32) -> f32 { return art[lo(l) + L_DI + r * JM + c]; }

// Point shifts, r = c_child - c_parent: motion parent -> child, force child -> parent.
fn mshift(m: SV, r: vec3f) -> SV { return SV(m.a, m.l + cross(m.a, r)); }
fn fshift(f: SV, r: vec3f) -> SV { return SV(f.a + cross(r, f.l), f.l); }
fn link_r(l: u32) -> vec3f {
  let par = link_parent(l);
  if (par < 0) { return vec3f(0.0); }
  return ld3(lo(l) + L_COM) - ld3(lo(u32(par)) + L_COM);
}
// Add the child's articulated inertia, shifted to the parent's point, into the parent block.
fn add_shifted_inertia(o: u32, A: mat3x3f, B: mat3x3f, C: mat3x3f, r: vec3f) {
  let R = skew3(r);
  stm(o, ldm(o) + A - B * R + R * transpose(B) - R * C * R);
  stm(o + 9u, ldm(o + 9u) + B + R * C);
  stm(o + 18u, ldm(o + 18u) + C);
}

// Link poses, COMs and world motion subspaces.
fn art_fk(a: u32) {
  let ai = art_info(a);
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k;
    let o = SF_LINK + l * 6u;
    var pp = vec3f(0.0); var pq = vec4f(0.0, 0.0, 0.0, 1.0);
    let par = link_parent(l);
    if (par >= 0) { pp = ld3(lo(u32(par)) + L_POS); pq = vec4f(ld3(lo(u32(par)) + L_ROT), art[lo(u32(par)) + L_ROT + 3u]); }
    let jp = pp + qrot(pq, statF[o + 1u].xyz);
    let jq = qmul(pq, statF[o + 2u]);
    let axis = statF[o + 5u].xyz;
    var mq = vec4f(0.0, 0.0, 0.0, 1.0); var mp = vec3f(0.0);
    let t = link_type(l);
    let qs = link_qs(l);
    if (t == JT_REVOLUTE) { mq = qaxis(axis, art[A_Q + qs]); }
    if (t == JT_PRISMATIC) { mp = axis * art[A_Q + qs]; }
    if (t == JT_BALL) { mq = normalize(vec4f(art[A_Q + qs], art[A_Q + qs + 1u], art[A_Q + qs + 2u], art[A_Q + qs + 3u])); }
    let d0 = link_dof(l);
    let nlin = u32(statF[o + 5u].w);
    let nang = link_ndof(l) - nlin;
    var ang: array<vec3f, 3>;  // D6 rotation axes in the joint frame, as Newton transports them
    if (t == JT_D6) {
      for (var c = 0u; c < nlin; c++) { mp += dof_axis(d0 + c) * art[A_Q + qs + c]; }
      let iq = qs + nlin;
      if (nang == 1u) {
        ang[0] = dof_axis(d0 + nlin);
        mq = qaxis(ang[0], art[A_Q + iq]);
      }
      if (nang == 2u) {
        let x0 = normalize(dof_axis(d0 + nlin));
        let x2 = normalize(cross(x0, dof_axis(d0 + nlin + 1u)));
        ang[0] = x0;
        let q0 = qaxis(x0, art[A_Q + iq]);
        ang[1] = qrot(q0, cross(x2, x0));
        mq = qmul(qaxis(ang[1], art[A_Q + iq + 1u]), q0);
      }
      if (nang == 3u) {
        ang[0] = dof_axis(d0 + nlin);
        let q0 = qaxis(ang[0], art[A_Q + iq]);
        ang[1] = qrot(q0, dof_axis(d0 + nlin + 1u));
        let q1 = qaxis(ang[1], art[A_Q + iq + 1u]);
        ang[2] = qrot(qmul(q1, q0), dof_axis(d0 + nlin + 2u));
        mq = qmul(qaxis(ang[2], art[A_Q + iq + 2u]), qmul(q1, q0));
      }
    }
    if (t == JT_FREE) {
      mp = vec3f(art[A_Q + qs], art[A_Q + qs + 1u], art[A_Q + qs + 2u]);
      mq = normalize(vec4f(art[A_Q + qs + 3u], art[A_Q + qs + 4u], art[A_Q + qs + 5u], art[A_Q + qs + 6u]));
    }
    let cq = qmul(jq, mq);
    let cp = jp + qrot(jq, mp);
    let iq = qconj(statF[o + 4u]);
    let lq = normalize(qmul(cq, iq));
    let lp = cp + qrot(cq, -qrot(iq, statF[o + 3u].xyz));
    let L = lo(l);
    st3(L + L_POS, lp); st3(L + L_ROT, lq.xyz); art[L + L_ROT + 3u] = lq.w;
    let com = lp + qrot(lq, body_com_local(link_body(l)));
    st3(L + L_COM, com);
    let aw = qrot(jq, axis);
    let rj = com - jp;
    for (var c = 0u; c < JM; c++) { stsv(L + L_S + c * 6u, sv0()); }
    if (t == JT_REVOLUTE) { stsv(L + L_S, SV(aw, cross(aw, rj))); }
    if (t == JT_PRISMATIC) { stsv(L + L_S, SV(vec3f(0.0), aw)); }
    if (t == JT_BALL) {
      for (var c = 0u; c < 3u; c++) {
        var e = vec3f(0.0); e[c] = 1.0;
        let ew = qrot(jq, e);
        stsv(L + L_S + c * 6u, SV(ew, cross(ew, rj)));
      }
    }
    let rf = com - cp;
    st3(L + L_JR, rf);
    if (t == JT_D6) {
      for (var c = 0u; c < nlin; c++) { stsv(L + L_S + c * 6u, SV(vec3f(0.0), qrot(jq, dof_axis(d0 + c)))); }
      for (var c = 0u; c < nang; c++) {
        let ew = qrot(jq, ang[c]);
        stsv(L + L_S + (nlin + c) * 6u, SV(ew, cross(ew, rf)));
      }
    }
    if (t == JT_FREE) {
      // qd = (translation rate, angular velocity) of the joint frame, in the parent joint frame.
      for (var c = 0u; c < 3u; c++) {
        var e = vec3f(0.0); e[c] = 1.0;
        let ew = qrot(jq, e);
        stsv(L + L_S + c * 6u, SV(vec3f(0.0), ew));
        stsv(L + L_S + (c + 3u) * 6u, SV(ew, cross(ew, rf)));
      }
    }
  }
}

fn link_rot(l: u32) -> vec4f { return vec4f(ld3(lo(l) + L_ROT), art[lo(l) + L_ROT + 3u]); }

// Inverse of the leading n x n block of an SPD JM x JM matrix (Gauss-Jordan, row-major).
fn inv_spd(D: ptr<function, array<f32, 36>>, n: u32) -> array<f32, 36> {
  var Di: array<f32, 36>;
  for (var i = 0u; i < JM * JM; i++) { Di[i] = 0.0; }
  for (var i = 0u; i < n; i++) { Di[i * JM + i] = 1.0; }
  for (var c = 0u; c < n; c++) {
    let pv = 1.0 / max((*D)[c * JM + c], 1e-12);
    for (var k = 0u; k < n; k++) { (*D)[c * JM + k] *= pv; Di[c * JM + k] *= pv; }
    for (var r = 0u; r < n; r++) {
      if (r == c) { continue; }
      let f = (*D)[r * JM + c];
      if (f == 0.0) { continue; }
      for (var k = 0u; k < n; k++) { (*D)[r * JM + k] -= f * (*D)[c * JM + k]; Di[r * JM + k] -= f * Di[c * JM + k]; }
    }
  }
  return Di;
}

// Factor: articulated inertias, U, D^-1 (implicit drives in D) and the free velocity qd_hat.
fn art_factor(a: u32) {
  let ai = art_info(a);
  let g = P.gravity.xyz;
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k; let L = lo(l);
    let par = link_parent(l);
    var vp = sv0();
    if (par >= 0) { vp = mshift(ldsv(lo(u32(par)) + L_V), link_r(l)); }
    var sq = sv0();
    for (var c = 0u; c < link_ndof(l); c++) { sq = sadd(sq, sscale(ldS(l, c), art[A_QD + link_dof(l) + c])); }
    let v = sadd(vp, sq);
    stsv(L + L_V, v);
    var cb = crm(vp, sq);
    if (link_type(l) == JT_D6) {
      // Rotation axes transported by earlier D6 angles: d(a_k)/dt = sum_{j<k} a_j x a_k qd_j.
      let nlin = u32(statF[SF_LINK + l * 6u + 5u].w);
      var ca = vec3f(0.0);
      for (var j = nlin; j < link_ndof(l); j++) {
        for (var k = j + 1u; k < link_ndof(l); k++) {
          ca += cross(ldS(l, j).a, ldS(l, k).a) * art[A_QD + link_dof(l) + j] * art[A_QD + link_dof(l) + k];
        }
      }
      cb = sadd(cb, SV(ca, cross(ca, ld3(L + L_JR))));
    }
    let jt = link_type(l);
    if (jt == JT_FREE || jt == JT_D6) {
      // Translation qd is the joint origin's classical velocity; with rotation dofs after it, the
      // spatial acceleration differs by omega_j x v_o.
      let nlin = select(u32(statF[SF_LINK + l * 6u + 5u].w), 3u, jt == JT_FREE);
      var vo = vec3f(0.0); var wj = vec3f(0.0);
      for (var c = 0u; c < link_ndof(l); c++) {
        let sc = ldS(l, c); let q = art[A_QD + link_dof(l) + c];
        if (c < nlin) { vo += sc.l * q; } else { wj += sc.a * q; }
      }
      cb = sadd(cb, SV(vec3f(0.0), -cross(wj, vo)));
    }
    stsv(L + L_C, cb);
    let b = link_body(l);
    let m = body_mass(b);
    let R = qmat(link_rot(l));
    let Ic = R * body_inertia(b) * transpose(R);
    stm(L + L_IA, Ic);
    stm(L + L_IA + 9u, mat3x3f(vec3f(0.0), vec3f(0.0), vec3f(0.0)));
    stm(L + L_IA + 18u, mat3x3f(vec3f(m, 0.0, 0.0), vec3f(0.0, m, 0.0), vec3f(0.0, 0.0, m)));
    var pa0 = crf(v, imul(L + L_IA, v));
    // disable_gravity: cancel this link's share of the base-acceleration gravity (p = -f_ext).
    // framefields: a gravity scale s cancels (1 - s) of it the same way (disable_gravity is s = 0).
    let gs = select(body_ext(i32(b)).x, 0.0, (u32(statF[SF_BODY + u32(b) * 8u + 7u].w) & 2u) != 0u);
    if (gs != 1.0) { pa0 = sadd(pa0, SV(vec3f(0.0), m * g * (1.0 - gs))); }
    // Applied wrench (State.body_f) at the link COM.
    pa0 = sadd(pa0, SV(-ld3(A_BF + u32(b) * 8u + 4u), -ld3(A_BF + u32(b) * 8u)));
    // Mouse spring on a grabbed link: the free body's point spring (5 Hz, at most ~6 g) as a force at the grab
    // point; the rest of the articulation only adds mass, so the link follows more softly than a free body.
    if (P.pick_target.w > 0.5 && u32(P.pick_local.w) == u32(b)) {
      let lq = link_rot(l);
      let r = qrot(lq, P.pick_local.xyz);
      let x = ld3(L + L_COM) + r;
      let wn = 2.0 * 3.14159265 * 5.0;
      var acc = wn * wn * (P.pick_target.xyz - x) - 2.0 * wn * (v.l + cross(v.a, r));
      if (length(acc) > 60.0) { acc *= 60.0 / length(acc); }
      let Iinv = R * body_inv_inertia(b) * transpose(R);
      let S = mat3x3f(vec3f(0.0, r.z, -r.y), vec3f(-r.z, 0.0, r.x), vec3f(r.y, -r.x, 0.0));
      let im = body_inv_mass(b);
      let K = mat3x3f(vec3f(im, 0.0, 0.0), vec3f(0.0, im, 0.0), vec3f(0.0, 0.0, im)) - S * Iinv * S;
      let c0 = cross(K[1], K[2]); let c1 = cross(K[2], K[0]); let c2 = cross(K[0], K[1]);
      let F = transpose(mat3x3f(c0, c1, c2)) * acc / dot(K[0], c0);
      pa0 = sadd(pa0, SV(-cross(r, F), -F));
    }
    stsv(L + L_PA, pa0);
  }
  for (var kk = 0u; kk < ai.y; kk++) {
    let l = ai.x + ai.y - 1u - kk; let L = lo(l);
    let n = link_ndof(l);
    let pA = ldsv(L + L_PA);
    var D: array<f32, 36>;
    for (var i = 0u; i < JM * JM; i++) { D[i] = 0.0; }
    var u: array<f32, 6>;
    for (var c = 0u; c < n; c++) {
      let U = imul(L + L_IA, ldS(l, c));
      stsv(L + L_U + c * 6u, U);
    }
    for (var r = 0u; r < n; r++) {
      let d = link_dof(l) + r;
      for (var c = 0u; c < n; c++) { D[r * JM + c] = sdot(ldS(l, r), ldU(l, c)); }
      let dr = dof_drive(d);
      D[r * JM + r] += dr.x;
      // Passive damping is implicit and never saturates.
      let damp = dof_passive(d).x;
      D[r * JM + r] += P.dt * damp;
      var tau = -damp * art[A_QD + d] + art[A_JF + d];  // Control.joint_f
      // Passive spring is explicit, as in Steel.
      let sp = dof_spring(d);
      if (sp.x != 0.0) { tau += sp.x * (sp.y - art[A_Q + link_qs(l) + r]); }
      if (DRIVE_ROWS == 0u && (dr.y > 0.0 || dr.z > 0.0)) {
        let q = art[A_Q + link_qs(l) + r]; let qd = art[A_QD + d];
        let err = art[A_TGT + d] - q;
        let tv = art[A_TGTV + d];
        // Saturate on the torque the implicit step applies (this dof's effective inertia m), not the explicit PD
        // torque: a stiff gain on a light joint overstates it, and the drive chatters between +-effort.
        let m = max(D[r * JM + r], 1e-9);
        let qdn = (m * qd + P.dt * (dr.y * err + dr.z * tv)) / (m + P.dt * dr.z + P.dt * P.dt * dr.y);
        let ti = dr.y * (err - P.dt * qdn) + dr.z * (tv - qdn);
        // framefields: ti assumes the dof moves freely. Against a contact it does not, and the implicit drive
        // pushes with its full stiffness. The PD torque at this state is what the implicit drive delivered over
        // the last substep (q moved by dt qd), so past the effort it was held back: push with the effort.
        let held = dr.y * err + dr.z * (tv - qd);
        if (dr.w <= 0.0 || (abs(ti) <= dr.w && abs(held) <= dr.w)) {
          D[r * JM + r] += P.dt * P.dt * dr.y + P.dt * dr.z;
          tau += dr.y * err - P.dt * dr.y * qd + dr.z * (tv - qd);
        } else if (abs(ti) > dr.w) {
          tau += clamp(ti, -dr.w, dr.w);
        } else {
          tau += clamp(held, -dr.w, dr.w);
        }
      }
      u[r] = tau - sdot(ldS(l, r), pA);
    }
    let Di = inv_spd(&D, n);
    for (var i = 0u; i < JM * JM; i++) { art[L + L_DI + i] = Di[i]; }
    for (var r = 0u; r < JM; r++) { art[L + L_UU + r] = u[r]; }
    let par = link_parent(l);
    if (par < 0) { continue; }
    var A = ldm(L + L_IA); var B = ldm(L + L_IA + 9u); var C = ldm(L + L_IA + 18u);
    var Duu = sv0();
    for (var r = 0u; r < n; r++) {
      let Ur = ldU(l, r);
      var du = 0.0;
      for (var c = 0u; c < n; c++) {
        let Uc = ldU(l, c);
        let w = ldDI(l, r, c);
        A -= w * outer3(Ur.a, Uc.a); B -= w * outer3(Ur.a, Uc.l); C -= w * outer3(Ur.l, Uc.l);
        du += w * u[c];
      }
      Duu = sadd(Duu, sscale(Ur, du));
    }
    stm(L + L_IA, A); stm(L + L_IA + 9u, B); stm(L + L_IA + 18u, C);
    let cbias = ldsv(L + L_C);
    let pa = sadd(sadd(pA, imul(L + L_IA, cbias)), Duu);
    let P0 = lo(u32(par));
    let r = link_r(l);
    add_shifted_inertia(P0 + L_IA, A, B, C, r);
    stsv(P0 + L_PA, sadd(ldsv(P0 + L_PA), fshift(pa, r)));
  }
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k; let L = lo(l);
    let par = link_parent(l);
    var ap = SV(vec3f(0.0), -g);
    if (par >= 0) { ap = mshift(ldsv(lo(u32(par)) + L_A), link_r(l)); }
    let a1 = sadd(ap, ldsv(L + L_C));
    let n = link_ndof(l);
    var acc = a1;
    for (var r = 0u; r < n; r++) {
      var qdd = 0.0;
      for (var c = 0u; c < n; c++) { qdd += ldDI(l, r, c) * (art[L + L_UU + c] - sdot(ldU(l, c), a1)); }
      let d = link_dof(l) + r;
      art[A_QDH + d] = art[A_QD + d] + P.dt * qdd;
      acc = sadd(acc, sscale(ldS(l, r), qdd));
    }
    stsv(L + L_A, acc);
    if (JFL == 1u) {
      // steel:joint_friction_load_coefficient: the joint's transmitted force and torque under the
      // free dynamics (articulated force I^A a + p^A at the child COM) raise its friction bound.
      let f = sadd(imul(L + L_IA, acc), ldsv(L + L_PA));
      let fm = length(f.l) + length(f.a);
      for (var r = 0u; r < n; r++) { let d = link_dof(l) + r; art[A_JFL + d] = statF[SF_DOF + d * 5u + 3u].w * fm; }
    }
  }
}

// Response of link 'target' to a spatial impulse F (or a generalized impulse tau at
// local dof td of path link tl): returns the target's spatial velocity change and fills
// ub (joint biases u along the path) for the split term. Only the root path moves the target.
struct PathOut { dv: SV, dqd_t: f32 };
fn path_test(tgt: u32, F: SV, tl: i32, td: u32, tau: f32, ub: ptr<function, array<f32, PD>>, path: ptr<function, array<u32, MAXPATH>>, np: u32) -> PathOut {
  var p = sscale(F, -1.0);  // articulated bias convention: p = -f_ext
  // Backward: path[0] = target ... path[np-1] = root link.
  for (var i = 0u; i < np; i++) {
    let l = (*path)[i];
    let n = link_ndof(l);
    var u: array<f32, 6>;
    for (var r = 0u; r < n; r++) {
      var t = 0.0;
      if (i32(l) == tl && r == td) { t = tau; }
      u[r] = t - sdot(ldS(l, r), p);
      (*ub)[i * JM + r] = u[r];
    }
    for (var r = 0u; r < n; r++) {
      var du = 0.0;
      for (var c = 0u; c < n; c++) { du += ldDI(l, r, c) * u[c]; }
      p = sadd(p, sscale(ldU(l, r), du));
    }
    p = fshift(p, link_r(l));
  }
  var dv = sv0();
  var out = PathOut(sv0(), 0.0);
  for (var ii = 0u; ii < np; ii++) {
    let i = np - 1u - ii;
    let l = (*path)[i];
    let n = link_ndof(l);
    dv = mshift(dv, link_r(l));
    var dq: array<f32, 6>;
    for (var r = 0u; r < n; r++) {
      dq[r] = 0.0;
      for (var c = 0u; c < n; c++) { dq[r] += ldDI(l, r, c) * ((*ub)[i * JM + c] - sdot(ldU(l, c), dv)); }
    }
    for (var r = 0u; r < n; r++) {
      dv = sadd(dv, sscale(ldS(l, r), dq[r]));
      if (i32(l) == tl && r == td) { out.dqd_t = dq[r]; }
    }
  }
  out.dv = dv;
  return out;
}

fn link_path(l0: u32, path: ptr<function, array<u32, MAXPATH>>) -> u32 {
  var n = 0u;
  var l = i32(l0);
  loop {
    if (l < 0 || n >= MAXPATH) { break; }
    (*path)[n] = u32(l); n++;
    l = link_parent(u32(l));
  }
  return n;
}

// Split COM response of link l: exact 6x6 plus Steel's (n_j - 1) u_j^T D_j^-1 u_j over
// path joints shared with other contact-bearing links (a sweep is Jacobi across links). The six
// unit COM impulses (force x, y, z, then torque) travel the path together, each path link's
// factors loaded once.
fn link_response(l: u32, split_count: ptr<function, array<u32, MAXPATH>>) {
  var path: array<u32, MAXPATH>;
  let np = link_path(l, &path);
  var ub: array<f32, 6u * PD>;  // [basis][path dof]: joint biases u
  var p: array<SV, 6>;
  for (var e = 0u; e < 6u; e++) {
    var f = vec3f(0.0); var t = vec3f(0.0);
    if (e < 3u) { f[e] = 1.0; } else { t[e - 3u] = 1.0; }
    p[e] = SV(-t, -f);  // articulated bias convention: p = -f_ext
  }
  var S: array<SV, 6>; var U: array<SV, 6>; var DI: array<f32, 36>;
  for (var i = 0u; i < np; i++) {
    let pl = path[i];
    let n = link_ndof(pl);
    for (var c = 0u; c < n; c++) { S[c] = ldS(pl, c); U[c] = ldU(pl, c); }
    for (var x = 0u; x < n * JM; x++) { DI[x] = art[lo(pl) + L_DI + x]; }
    let r = link_r(pl);
    for (var e = 0u; e < 6u; e++) {
      var u: array<f32, 6>;
      for (var c = 0u; c < n; c++) { u[c] = 0.0 - sdot(S[c], p[e]); ub[e * PD + i * JM + c] = u[c]; }
      var pe = p[e];
      for (var rr = 0u; rr < n; rr++) {
        var du = 0.0;
        for (var c = 0u; c < n; c++) { du += DI[rr * JM + c] * u[c]; }
        pe = sadd(pe, sscale(U[rr], du));
      }
      p[e] = fshift(pe, r);
    }
  }
  var dv: array<SV, 6>;
  for (var e = 0u; e < 6u; e++) { dv[e] = sv0(); }
  for (var ii = 0u; ii < np; ii++) {
    let i = np - 1u - ii;
    let pl = path[i];
    let n = link_ndof(pl);
    for (var c = 0u; c < n; c++) { S[c] = ldS(pl, c); U[c] = ldU(pl, c); }
    for (var x = 0u; x < n * JM; x++) { DI[x] = art[lo(pl) + L_DI + x]; }
    let r = link_r(pl);
    for (var e = 0u; e < 6u; e++) {
      var d = mshift(dv[e], r);
      var dq: array<f32, 6>;
      for (var rr = 0u; rr < n; rr++) {
        dq[rr] = 0.0;
        for (var c = 0u; c < n; c++) { dq[rr] += DI[rr * JM + c] * (ub[e * PD + i * JM + c] - sdot(U[c], d)); }
      }
      for (var rr = 0u; rr < n; rr++) { d = sadd(d, sscale(S[rr], dq[rr])); }
      dv[e] = d;
    }
  }
  var W: array<f32, 36>;
  for (var e = 0u; e < 6u; e++) {
    W[0u * 6u + e] = dv[e].l.x; W[1u * 6u + e] = dv[e].l.y; W[2u * 6u + e] = dv[e].l.z;
    W[3u * 6u + e] = dv[e].a.x; W[4u * 6u + e] = dv[e].a.y; W[5u * 6u + e] = dv[e].a.z;
  }
  for (var k = 0u; k < 36u; k++) { art[lo(l) + L_W2 + k] = W[k]; }
  for (var i = 0u; i < np; i++) {
    let extra = f32((*split_count)[i]) - 1.0;
    if (extra <= 0.0) { continue; }
    let pl = path[i];
    let n = link_ndof(pl);
    for (var x = 0u; x < n * JM; x++) { DI[x] = art[lo(pl) + L_DI + x]; }
    // t[cc] = D^-1 u_cc, then u_r . t[cc].
    var t: array<f32, 36>;
    for (var cc = 0u; cc < 6u; cc++) {
      for (var x = 0u; x < n; x++) {
        var v = 0.0;
        for (var y = 0u; y < n; y++) { v += DI[x * JM + y] * ub[cc * PD + i * JM + y]; }
        t[cc * 6u + x] = v;
      }
    }
    for (var rr = 0u; rr < 6u; rr++) {
      for (var cc = 0u; cc < 6u; cc++) {
        var sv = 0.0;
        for (var x = 0u; x < n; x++) { sv += ub[rr * PD + i * JM + x] * t[cc * 6u + x]; }
        W[rr * 6u + cc] += extra * sv;
      }
    }
  }
  for (var k = 0u; k < 36u; k++) { art[lo(l) + L_W + k] = W[k]; }
}

// Diagonal of H^-1 for dof r of link l (for joint-limit rows).
fn dof_hinv(l: u32, r: u32) -> f32 {
  var path: array<u32, MAXPATH>;
  let np = link_path(l, &path);
  var ub: array<f32, PD>;
  return path_test(l, sv0(), i32(l), r, 1.0, &ub, &path, np).dqd_t;
}


// Dense (generalized) rows for same-articulation contacts, as Steel's dense family:
// J over the articulation's dofs and Y = H^-1 J^T, solved with exact Gauss-Seidel.

// Generalized Jacobian of the point velocity of link x at p along three directions.
fn add_gen_jac(x: u32, p: vec3f, sgn: f32, d0: vec3f, d1: vec3f, d2: vec3f, ds: u32, J: ptr<function, array<f32, JDIM>>) {
  var l = i32(x);
  loop {
    if (l < 0) { break; }
    let k = u32(l);
    let c = ld3(lo(k) + L_COM);
    for (var r = 0u; r < link_ndof(k); r++) {
      let S = ldS(k, r);
      let v = S.l + cross(S.a, p - c);
      let i = link_dof(k) + r - ds;
      (*J)[i] += sgn * dot(d0, v); (*J)[NDA + i] += sgn * dot(d1, v); (*J)[2u * NDA + i] += sgn * dot(d2, v);
    }
    l = link_parent(k);
  }
}

// Generalized Jacobian of the angular velocity of link x along two directions.
fn add_gen_ang(x: u32, sgn: f32, d0: vec3f, d1: vec3f, ds: u32, J: ptr<function, array<f32, JDIM>>) {
  var l = i32(x);
  loop {
    if (l < 0) { break; }
    let k = u32(l);
    for (var r = 0u; r < link_ndof(k); r++) {
      let w = ldS(k, r).a;
      let i = link_dof(k) + r - ds;
      (*J)[i] += sgn * dot(d0, w); (*J)[NDA + i] += sgn * dot(d1, w);
    }
    l = link_parent(k);
  }
}

// qd change of articulation a for generalized impulse tau (private scratch, any thread).
fn art_solve_gen(a: u32, tau: ptr<function, array<f32, NDA>>, out: ptr<function, array<f32, NDA>>) {
  let ai = art_info(a);
  var p: array<SV, MAXLP>; var uu: array<array<f32, 6>, MAXLP>; var dvs: array<SV, MAXLP>;
  for (var k = 0u; k < ai.y; k++) { p[k] = sv0(); }
  for (var kk = 0u; kk < ai.y; kk++) {
    let k = ai.y - 1u - kk; let l = ai.x + k;
    let n = link_ndof(l);
    var u: array<f32, 6>;
    for (var r = 0u; r < n; r++) { u[r] = (*tau)[link_dof(l) + r - ai.z] - sdot(ldS(l, r), p[k]); }
    uu[k] = u;
    let par = link_parent(l);
    if (par >= 0) {
      var pp = p[k];
      for (var r = 0u; r < n; r++) {
        var du = 0.0;
        for (var c = 0u; c < n; c++) { du += ldDI(l, r, c) * u[c]; }
        pp = sadd(pp, sscale(ldU(l, r), du));
      }
      let pk = u32(par) - ai.x;
      p[pk] = sadd(p[pk], fshift(pp, link_r(l)));
    }
  }
  for (var k = 0u; k < ai.y; k++) {
    let l = ai.x + k;
    let par = link_parent(l);
    var dv = sv0();
    if (par >= 0) { dv = mshift(dvs[u32(par) - ai.x], link_r(l)); }
    let n = link_ndof(l);
    var dq: array<f32, 6>;
    for (var r = 0u; r < n; r++) {
      dq[r] = 0.0;
      for (var c = 0u; c < n; c++) { dq[r] += ldDI(l, r, c) * (uu[k][c] - sdot(ldU(l, c), dv)); }
    }
    for (var r = 0u; r < n; r++) {
      dv = sadd(dv, sscale(ldS(l, r), dq[r]));
      (*out)[link_dof(l) + r - ai.z] = dq[r];
    }
    dvs[k] = dv;
  }
}
`;
