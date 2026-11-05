/**
 * Velocity pass for shutter motion blur: each mesh vertex is deformed twice,
 * with this frame's bindings and the previous frame's (model matrix,
 * skinning palette, instance records, wind and crowd time), by the same code
 * the color pass runs, and projected with this and the previous camera. The
 * target holds the screen motion in pixels (rg), linear depth (b) and
 * coverage (a).
 */
import {
	meshDeformStructWgsl,
	meshDeformWgsl,
	meshStructsWgsl,
} from "./mesh3d.js";

export const meshVelocityWgsl = `
${meshStructsWgsl}

struct VelocityCamera {
    viewProj     : mat4x4<f32>,
    prevViewProj : mat4x4<f32>,
    eye          : vec4<f32>,
    dir          : vec4<f32>,
    viewport     : vec4<f32>, // xy = target size, px
};

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
fn vs_velocity(in: VertexInput, @builtin(instance_index) instanceIndex: u32) -> VelocityOut {
    let now = deform(in, instanceIndex);
    let before = deformPrev(in, instanceIndex);
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
struct VelocityCamera {
    viewProj     : mat4x4<f32>,
    prevViewProj : mat4x4<f32>,
    eye          : vec4<f32>,
    dir          : vec4<f32>,
    viewport     : vec4<f32>,
};

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
