/**
 * Velocity pass for shutter motion blur: each mesh vertex is deformed twice,
 * with this frame's bindings and the previous frame's (deformed position,
 * model matrix, skinning palette, instance records, wind and crowd time), by the same code
 * the color pass runs, and projected with this and the previous camera. The
 * target holds the screen motion in pixels (rg), linear depth (b) and
 * coverage (a).
 */
import {
	meshDeformStructWgsl,
	meshDeformWgsl,
	meshStructsWgsl,
} from "./mesh3d.js";
import { slugCoverageWgsl } from "./slug.js";

/** The velocity pass's camera: this and the previous frame's view-projection. */
const velocityCameraWgsl = `
struct VelocityCamera {
    viewProj     : mat4x4<f32>,
    prevViewProj : mat4x4<f32>,
    invViewProj  : mat4x4<f32>,
    eye          : vec4<f32>,
    dir          : vec4<f32>,
    viewport     : vec4<f32>, // xy = target size, px
};
`;

export const meshVelocityWgsl = `
${meshStructsWgsl}

${velocityCameraWgsl}

@group(0) @binding(0) var<uniform> vcam : VelocityCamera;
@group(1) @binding(0) var<uniform> model : ModelUniforms;
@group(1) @binding(1) var<storage, read> skinning : SkinningUniforms;
@group(1) @binding(4) var<storage, read> instances : array<InstanceData>;
@group(2) @binding(0) var<uniform> modelPrev : ModelUniforms;
@group(2) @binding(1) var<storage, read> skinningPrev : SkinningUniforms;
@group(2) @binding(4) var<storage, read> instancesPrev : array<InstanceData>;
@group(3) @binding(0) var texSampler : sampler;
@group(3) @binding(1) var mainTex : texture_2d<f32>;

fn rotateVecByQuat(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

${meshDeformStructWgsl}
${meshDeformWgsl("", "model", "skinning", "instances")}
${meshDeformWgsl("Prev", "modelPrev", "skinningPrev", "instancesPrev")}

struct VelocityOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) curr  : vec4<f32>,
    @location(1) prev  : vec4<f32>,
    @location(2) uv    : vec2<f32>,
    @location(3) depth : f32,
    @location(4) alpha : f32,
};

@vertex
fn vs_velocity(
    in: VertexInput,
    @location(12) prevPosition: vec3<f32>,
    @builtin(instance_index) instanceIndex: u32,
) -> VelocityOut {
    let now = deform(in, instanceIndex);
    // Morphs and audio deformation ran on the GPU before this pass: the
    // previous frame starts from its own deformed position.
    var inPrev = in;
    inPrev.position = prevPosition;
    let before = deformPrev(inPrev, instanceIndex);
    let world = model.modelMatrix * vec4<f32>(now.localPos, 1.0);
    let worldPrev = modelPrev.modelMatrix * vec4<f32>(before.localPos, 1.0);
    var out: VelocityOut;
    out.pos = vcam.viewProj * world;
    out.curr = out.pos;
    out.prev = vcam.prevViewProj * worldPrev;
    out.uv = model.uvRect.xy + in.uv * model.uvRect.zw;
    out.depth = dot(world.xyz - vcam.eye.xyz, vcam.dir.xyz);
    out.alpha = in.color.a * now.instColor.a;
    return out;
}

@fragment
fn fs_velocity(in: VelocityOut) -> @location(0) vec4<f32> {
    // Cut-out texels (alpha-tested leaves, cards) leave no motion behind.
    let cutoff = model.shade.a;
    if (cutoff > 0.0) {
        let a = textureSample(mainTex, texSampler, in.uv).a * in.alpha;
        if (a < cutoff) {
            discard;
        }
    }
    let ndc = in.curr.xy / in.curr.w;
    let ndcPrev = in.prev.xy / max(in.prev.w, 1e-6);
    // NDC y points up, pixels down.
    let motion = (ndc - ndcPrev) * 0.5 * vcam.viewport.xy * vec2<f32>(1.0, -1.0);
    return vec4<f32>(motion, in.depth, 1.0);
}
`;

/**
 * Velocity of a 3D layer plane (the unit quad its model matrix places):
 * this and the previous frame's model matrix; transparent texels leave
 * the background's motion.
 */
export const quadVelocityWgsl = `
${velocityCameraWgsl}

struct QuadMotion {
    model     : mat4x4<f32>,
    modelPrev : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> vcam : VelocityCamera;
@group(1) @binding(0) var<uniform> quad : QuadMotion;
@group(1) @binding(1) var quadSampler : sampler;
@group(1) @binding(2) var quadTex : texture_2d<f32>;

struct QuadVelocityOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) curr  : vec4<f32>,
    @location(1) prev  : vec4<f32>,
    @location(2) uv    : vec2<f32>,
    @location(3) depth : f32,
};

@vertex
fn vs_quad_velocity(@builtin(vertex_index) i: u32) -> QuadVelocityOut {
    let corner = vec2<f32>(f32(i & 1u), f32(i >> 1u));
    let local = vec4<f32>(corner - 0.5, 0.0, 1.0);
    let world = quad.model * local;
    var out: QuadVelocityOut;
    out.pos = vcam.viewProj * world;
    out.curr = out.pos;
    out.prev = vcam.prevViewProj * (quad.modelPrev * local);
    out.uv = corner;
    out.depth = dot(world.xyz - vcam.eye.xyz, vcam.dir.xyz);
    return out;
}

@fragment
fn fs_quad_velocity(in: QuadVelocityOut) -> @location(0) vec4<f32> {
    if (textureSample(quadTex, quadSampler, in.uv).a < 0.02) {
        discard;
    }
    let ndc = in.curr.xy / in.curr.w;
    let ndcPrev = in.prev.xy / max(in.prev.w, 1e-6);
    let motion = (ndc - ndcPrev) * 0.5 * vcam.viewport.xy * vec2<f32>(1.0, -1.0);
    return vec4<f32>(motion, in.depth, 1.0);
}
`;

/**
 * Velocity of the environment's floor plane (y = floorY, infinite, drawn by
 * ray intersection like the color pass): still in the world, it moves only
 * with the camera.
 */
export const floorVelocityWgsl = `
${velocityCameraWgsl}

struct FloorMotion {
    params : vec4<f32>, // x = floor y
};

@group(0) @binding(0) var<uniform> vcam : VelocityCamera;
@group(1) @binding(0) var<uniform> floorM : FloorMotion;

@vertex
fn vs_floor_velocity(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    return vec4<f32>(p[i], 0.0, 1.0);
}

struct FloorVelocityOut {
    @location(0) color : vec4<f32>,
    @builtin(frag_depth) depth : f32,
};

@fragment
fn fs_floor_velocity(@builtin(position) pos: vec4<f32>) -> FloorVelocityOut {
    let size = vcam.viewport.xy;
    let ndc = vec2<f32>(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0);
    let a = vcam.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
    let b = vcam.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
    let p0 = a.xyz / a.w;
    let ray = b.xyz / b.w - p0;
    if (abs(ray.y) < 1e-9) {
        discard;
    }
    let t = (floorM.params.x - p0.y) / ray.y;
    if (t < 0.0) {
        discard;
    }
    let world = vec4<f32>(p0 + ray * t, 1.0);
    let clip = vcam.viewProj * world;
    let clipPrev = vcam.prevViewProj * world;
    let motion = (clip.xy / clip.w - clipPrev.xy / max(clipPrev.w, 1e-6)) *
        0.5 * size * vec2<f32>(1.0, -1.0);
    var out: FloorVelocityOut;
    out.color = vec4<f32>(motion, dot(world.xyz - vcam.eye.xyz, vcam.dir.xyz), 1.0);
    out.depth = clamp(clip.z / clip.w, 0.0, 1.0);
    return out;
}
`;

/**
 * Velocity of a text layer's Slug glyphs on their 3D plane: each glyph quad
 * is placed with this and the previous frame's plane matrix and per-glyph
 * animation (rotation, scale, offset), and coverage is solved from the
 * outline as the color pass does, so only the glyphs' own pixels move.
 */
export const slugVelocityWgsl = `
${velocityCameraWgsl}

struct SlugMotion {
    model     : mat4x4<f32>, // paragraph px -> world, this frame
    modelPrev : mat4x4<f32>, // and the previous frame
    params    : vec4<f32>,   // x = opacity, y = slant, w = pull toward the eye
};

@group(0) @binding(0) var<uniform> vcam : VelocityCamera;
@group(1) @binding(0) var<uniform> motion : SlugMotion;
@group(2) @binding(0) var curvesTex : texture_2d<f32>;
@group(2) @binding(1) var bandsTex  : texture_2d<u32>;

${slugCoverageWgsl}

struct SlugVelocityOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) curr  : vec4<f32>,
    @location(1) prev  : vec4<f32>,
    @location(2) uv    : vec2<f32>,
    @location(3) depth : f32,
    @location(4) @interpolate(flat) glyphScale : vec2<f32>,
    @location(5) @interpolate(flat) bandScale  : vec2<f32>,
    @location(6) @interpolate(flat) bandMax    : vec2<u32>,
    @location(7) @interpolate(flat) bandsTexCoords : vec2<u32>,
    @location(8) alpha : f32,
};

var<private> corners : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
);

/** A glyph quad corner in world space, slid toward the eye as the color pass slides it. */
fn glyphCorner(m: mat4x4<f32>, corner: vec2<f32>, scaleBias: vec4<f32>, anim: vec4<f32>) -> vec4<f32> {
    let rot = mat2x2<f32>(cos(anim.x), sin(anim.x), -sin(anim.x), cos(anim.x));
    let shear = mat2x2<f32>(1.0, 0.0, -motion.params.y, 1.0);
    let p = scaleBias.zw + anim.zw + rot * shear * (corner * scaleBias.xy * anim.y);
    let w = (m * vec4<f32>(p, 0.0, 1.0)).xyz;
    return vec4<f32>(w + (vcam.eye.xyz - w) * motion.params.w, 1.0);
}

@vertex
fn vs_slug_velocity(
    @builtin(vertex_index) vertexIndex : u32,
    @location(0) aScaleBias : vec4<f32>,
    @location(1) aGlyphBandScale : vec4<f32>,
    @location(2) aBandMaxTexCoords : vec4<f32>,
    @location(3) aAnim : vec4<f32>,
    @location(4) aColor : vec4<f32>,
    @location(6) aPrevScaleBias : vec4<f32>,
    @location(7) aPrevAnim : vec4<f32>,
) -> SlugVelocityOut {
    let corner = corners[vertexIndex];
    let world = glyphCorner(motion.model, corner, aScaleBias, aAnim);
    let worldPrev = glyphCorner(motion.modelPrev, corner, aPrevScaleBias, aPrevAnim);
    var out : SlugVelocityOut;
    out.pos = vcam.viewProj * world;
    out.curr = out.pos;
    out.prev = vcam.prevViewProj * worldPrev;
    out.uv = vec2<f32>(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
    out.depth = dot(world.xyz - vcam.eye.xyz, vcam.dir.xyz);
    out.glyphScale = aGlyphBandScale.xy;
    out.bandScale = aGlyphBandScale.zw;
    out.bandMax = vec2<u32>(aBandMaxTexCoords.xy);
    out.bandsTexCoords = vec2<u32>(aBandMaxTexCoords.zw);
    out.alpha = aColor.a * motion.params.x;
    return out;
}

@fragment
fn fs_slug_velocity(in : SlugVelocityOut) -> @location(0) vec4<f32> {
    let fw = max(abs(dpdx(in.uv)) + abs(dpdy(in.uv)), vec2<f32>(0.000001));
    let glyph = SlugGlyph(in.glyphScale, in.bandScale, in.bandMax, in.bandsTexCoords);
    let coverage = sampleSlugCoverage(in.uv, glyph, max(vec2<f32>(1.0) / fw, vec2<f32>(1.0)));
    // Inside the outline only: the pixels around a glyph keep what is behind.
    if (coverage < 0.5 || in.alpha < 0.02) {
        discard;
    }
    let ndc = in.curr.xy / in.curr.w;
    let ndcPrev = in.prev.xy / max(in.prev.w, 1e-6);
    let shift = (ndc - ndcPrev) * 0.5 * vcam.viewport.xy * vec2<f32>(1.0, -1.0);
    return vec4<f32>(shift, in.depth, 1.0);
}
`;
