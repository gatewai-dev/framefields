/**
 * WebGPU WGSL shaders for 3D static and skinned meshes.
 * Supports GPU Linear Blend Skinning (up to 128 bones),
 * the shared 3D surface shading (Blinn-Phong, or physical GGX + image-based light
 * in scenes with an environment) or toon shading, shadow maps, emissive,
 * alpha-cutoff (glTF MASK) materials,
 * Material parameters, normal transformations, and linear depth MRT output for Bokeh DoF.
 */

import { lighting3dWgsl, lightsBindingsWgsl } from "./lighting3d.js";
import { matte3dWgsl } from "./matte3d.js";

export const mesh3dWgsl = `
${lighting3dWgsl}

struct ModelUniforms {
    modelMatrix    : mat4x4<f32>,
    normalMatrix   : mat4x4<f32>,
    colorTint      : vec4<f32>,
    params         : vec4<f32>, // x = opacity, y = twoSided (1.0 = yes), z = isSkinned (1.0 = yes), w = isInstanced (1.0 = yes)
    materialParams : vec4<f32>, // x = shininess, y = specularIntensity, z = ambientIntensity, w = materialMode (0=unlit, 1=lit, 2=toon)
    shade          : vec4<f32>, // rgb = toon shadow-side color multiplier, a = alpha cutoff (0 = none)
    pbr            : vec4<f32>, // x = roughness (<0 = default), y = metallic
    emissive       : vec4<f32>, // rgb = sRGB emissive color, w = strength
    maps           : vec4<f32>, // x = normal scale (0 = no map), y = occlusion strength, z = has metallic-roughness map, w = has emissive map
};

struct SkinningUniforms {
    jointMatrices : array<mat4x4<f32>, 128>,
};

struct InstanceData {
    posScale : vec4<f32>, // xyz = translation, w = scale
    quat     : vec4<f32>, // xyzw = unit rotation quaternion
    color    : vec4<f32>, // rgba = color multiplier
    emissive : vec4<f32>, // rgb = sRGB emissive color, w = emissiveIntensity
};

@group(0) @binding(0) var<uniform> cam      : CameraUniforms;
@group(1) @binding(0) var<uniform> model    : ModelUniforms;
@group(1) @binding(1) var<uniform> skinning : SkinningUniforms;
${matte3dWgsl(1, 2)}@group(1) @binding(3) var backdropTex : texture_2d<f32>;
@group(1) @binding(4) var<storage, read> instances : array<InstanceData>;
@group(2) @binding(0) var texSampler        : sampler;
@group(2) @binding(1) var mainTex           : texture_2d<f32>;
@group(2) @binding(2) var normalTex         : texture_2d<f32>;
@group(2) @binding(3) var metalRoughTex     : texture_2d<f32>;
@group(2) @binding(4) var occlusionTex      : texture_2d<f32>;
@group(2) @binding(5) var emissiveTex       : texture_2d<f32>;
${lightsBindingsWgsl}

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) uv       : vec2<f32>,
    @location(2) normal   : vec3<f32>,
    @location(3) joints   : vec4<f32>,
    @location(4) weights  : vec4<f32>,
    @location(5) color    : vec4<f32>, // vertex color (display / sRGB), white when absent
};

struct VertexOutput {
    @builtin(position) clipPos     : vec4<f32>,
    @location(0)       uv          : vec2<f32>,
    @location(1)       worldPos    : vec3<f32>,
    @location(2)       worldNormal : vec3<f32>,
    @location(3)       linearDepth : f32,
    @location(4)       color       : vec4<f32>,
    @location(5)       emissive    : vec4<f32>,
};

fn rotateVecByQuat(v: vec3<f32>, q: vec4<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

@vertex
fn vs_main(
    in: VertexInput,
    @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
    var out: VertexOutput;

    var localPos = in.position;
    var localNorm = in.normal;

    // Linear Blend Skinning (LBS) on GPU
    if (model.params.z > 0.5) {
        let j0 = i32(in.joints.x);
        let j1 = i32(in.joints.y);
        let j2 = i32(in.joints.z);
        let j3 = i32(in.joints.w);

        let w0 = in.weights.x;
        let w1 = in.weights.y;
        let w2 = in.weights.z;
        let w3 = in.weights.w;

        let totalWeight = w0 + w1 + w2 + w3;
        if (totalWeight > 0.001) {
            let skinMat = skinning.jointMatrices[j0] * w0 +
                          skinning.jointMatrices[j1] * w1 +
                          skinning.jointMatrices[j2] * w2 +
                          skinning.jointMatrices[j3] * w3;

            let pos4 = skinMat * vec4<f32>(in.position, 1.0);
            localPos = pos4.xyz;

            let norm4 = skinMat * vec4<f32>(in.normal, 0.0);
            localNorm = normalize(norm4.xyz);
        }
    }

    // Hardware instancing: transform local vertex by instance transform
    // Static read prevents Tint from dropping the storage buffer binding
    let dummyInst = instances[0].posScale.x;
    var instColor = vec4<f32>(1.0);
    var instEmissive = vec4<f32>(0.0);

    if (model.params.w > 0.5) {
        let inst = instances[instanceIndex];
        let scaledPos = localPos * inst.posScale.w;
        localPos = rotateVecByQuat(scaledPos, inst.quat) + inst.posScale.xyz;
        localNorm = rotateVecByQuat(localNorm, inst.quat);
        instColor = inst.color;
        instEmissive = inst.emissive;
    } else {
        localPos.x += dummyInst * 0.0;
    }

    let worldPos4 = model.modelMatrix * vec4<f32>(localPos, 1.0);
    out.worldPos = worldPos4.xyz;

    let norm4 = model.normalMatrix * vec4<f32>(localNorm, 0.0);
    out.worldNormal = normalize(norm4.xyz);

    out.clipPos = cam.viewProjMatrix * worldPos4;
    out.uv = in.uv;
    out.color = in.color * instColor;
    out.emissive = instEmissive;

    out.linearDepth = dot(worldPos4.xyz - cam.cameraPos.xyz, cam.cameraDir.xyz);
    return out;
}

// Toon (MToon-style): the base color as authored where the light reaches,
// the shade color past a soft terminator. Highlights stay out: the texture
// already paints them.
fn toonLighting(in: VertexOutput, baseColor: vec3<f32>) -> vec3<f32> {
    var N = normalize(in.worldNormal);
    let V = normalize(cam.cameraPos.xyz - in.worldPos);
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    var lit = 0.0;
    let numLights = i32(lights.params.x);
    for (var i = 0; i < 8; i++) {
        if (i >= numLights) {
            break;
        }
        let light = lights.lights[i];
        let lightType = light.posType.w;
        var L = vec3<f32>(0.0, 0.0, 1.0);
        if (lightType > 0.5 && lightType < 1.5) {
            L = normalize(-light.dirRadius.xyz);
        } else if (lightType >= 1.5) {
            L = normalize(light.posType.xyz - in.worldPos);
        } else {
            continue;
        }
        let terminator = smoothstep(-0.05, 0.2, dot(N, L));
        lit = max(lit, terminator * min(light.colorIntensity.w, 1.0));
    }
    return baseColor * mix(model.shade.rgb, vec3<f32>(1.0), lit);
}

struct MeshFragment {
    color : vec4<f32>, // premultiplied display color
    hdr   : vec4<f32>, // premultiplied scene radiance (bloom source)
};

// Normal mapping without tangents: a cotangent frame from screen-space
// derivatives (Schüler, "Followup: Normal Mapping Without Precomputed Tangents").
fn perturbNormal(N: vec3<f32>, p: vec3<f32>, uv: vec2<f32>, tn: vec3<f32>, dp1: vec3<f32>, dp2: vec3<f32>, duv1: vec2<f32>, duv2: vec2<f32>) -> vec3<f32> {
    let dp2perp = cross(dp2, N);
    let dp1perp = cross(N, dp1);
    // The derivation assumes cross(dp1, dp2) points along N; with this
    // engine's y-down view basis it can point away, mirroring the frame.
    let handed = select(1.0, -1.0, dot(cross(dp1, dp2), N) < 0.0);
    let T = (dp2perp * duv1.x + dp1perp * duv2.x) * handed;
    let B = (dp2perp * duv1.y + dp1perp * duv2.y) * handed;
    let invmax = inverseSqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
    // glTF maps are +Y up while v grows down the image: green points along -B.
    return normalize(T * (tn.x * invmax) - B * (tn.y * invmax) + N * tn.z);
}

// Glass: what is behind the 3D batch on screen (backdrop), bent by
// refraction along the surface normal with a red/blue split, frosted by a
// disc blur, tinted by the color, under Fresnel-weighted reflections.
// shade.rgb = (dispersion, thickness px, frost), pbr.w = ior.
fn backdropAt(uv: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(backdropTex, texSampler, clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999)), 0.0).rgb;
}

// rimWidth: how much 1 - N·V changes across this pixel (fwidth, taken in
// uniform control flow by the caller). Rim effects narrower than a pixel are
// faded out, or per-pixel shading turns them into stair-stepped lines that
// MSAA (coverage only) cannot smooth.
fn shadeGlass(in: VertexOutput, Nin: vec3<f32>, tint: vec3<f32>, alpha: f32, rimWidth: f32) -> MeshFragment {
    let V = normalize(cam.cameraPos.xyz - in.worldPos);
    var N = Nin;
    if (dot(N, V) < 0.0) { N = -N; }
    let NdotV = clamp(dot(N, V), 0.0, 1.0);
    // Also fade toward edge-on: a face seen at a grazing angle is a sliver
    // under a pixel tall (a slab's bottom), which would alias the same way.
    let rimAA = clamp(1.0 - rimWidth * 2.5, 0.0, 1.0) * smoothstep(0.03, 0.22, NdotV);
    let rim = (1.0 - NdotV) * rimAA;
    let ior = max(model.pbr.w, 1.0001);
    let screen = max(cam.screenParams.xy, vec2<f32>(1.0));
    let uv = in.clipPos.xy / screen;
    // Screen-space bend: the normal's in-plane part, stronger toward the rim.
    let bend = N.xy * model.shade.g * (1.0 - 1.0 / ior) * (0.6 + rim) * rimAA / screen;
    let disp = model.shade.r;
    let frost = model.shade.b * 22.0 / screen;
    var col = vec3<f32>(0.0);
    let taps = select(1, 8, model.shade.b > 0.001);
    for (var i = 0; i < taps; i++) {
        let a = f32(i) * 2.399963;
        let r = sqrt((f32(i) + 0.5) / f32(taps));
        let o = select(vec2<f32>(0.0), vec2<f32>(cos(a), sin(a)) * r * frost, taps > 1);
        col += vec3<f32>(
            backdropAt(uv - bend * (1.0 + disp * 6.0) + o).r,
            backdropAt(uv - bend + o).g,
            backdropAt(uv - bend * (1.0 - disp * 6.0) + o).b,
        );
    }
    col /= f32(taps);
    // Light travels further through the glass toward the rim: the tint
    // deepens and the body darkens there, which is what outlines glass.
    let depthTint = mix(vec3<f32>(1.0), tint, 0.55 + 0.45 * rim);
    let transmitted = col * depthTint * (1.0 - 0.45 * rim * rim);
    let f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
    let F = f0 + (1.0 - f0) * pow(rim, 5.0);
    let lit = shadeSurfaceFull(in.worldPos, N, vec3<f32>(0.0), model.materialParams, vec4<f32>(model.pbr.x, 0.0, 0.0, 0.0), vec4<f32>(0.0));
    // Grazing faces mirror the room; keep that faint so dark scenes stay dark
    // and the studio highlights below carry the shape.
    let sheen = vec3<f32>(0.9, 0.94, 1.0) * F * 0.22 + tint * 0.05 * (0.4 + rim);
    // A studio in the reflection: a sharp key and two strip softboxes, which
    // is most of what makes glass read as glass.
    let R = reflect(-V, N);
    // Tight: a flat face only flashes as it turns through the light.
    let key = pow(max(dot(R, normalize(vec3<f32>(-0.45, -0.75, -0.5))), 0.0), 600.0) * 1.8;
    // Two tall softboxes: narrow bands in the reflection, brightest above.
    let strips = (1.0 - smoothstep(0.03, 0.07, abs(R.x + 0.45))) * smoothstep(0.3, -0.5, R.y) * 1.1
        + (1.0 - smoothstep(0.02, 0.05, abs(R.x - 0.6))) * smoothstep(0.4, -0.3, R.y) * 0.7;
    let studio = vec3<f32>(1.0, 0.98, 0.95) * (key + strips * (0.25 + F));
    // A thin bright line where the surface turns away: glass silhouettes.
    let edge = vec3<f32>(1.0, 0.99, 0.97) * smoothstep(0.8, 0.97, rim) * 0.55;
    let rgb = transmitted * (1.0 - F) + lit.display + sheen + studio + edge;
    var out: MeshFragment;
    out.color = vec4<f32>(rgb * alpha, alpha);
    out.hdr = vec4<f32>(srgbToLinear(transmitted * (1.0 - F)) * alpha + lit.hdr * alpha + srgbToLinear(sheen + studio + edge) * alpha, alpha);
    return out;
}

fn shadeMesh(in: VertexOutput, isFront: bool) -> MeshFragment {
    // Every sample and derivative up front, in uniform control flow.
    var texColor = textureSample(mainTex, texSampler, in.uv);
    let normalSample = textureSample(normalTex, texSampler, in.uv).xyz;
    let mrSample = textureSample(metalRoughTex, texSampler, in.uv);
    let aoSample = textureSample(occlusionTex, texSampler, in.uv).r;
    let emissiveSample = textureSample(emissiveTex, texSampler, in.uv).rgb;
    let dp1 = dpdx(in.worldPos);
    let dp2 = dpdy(in.worldPos);
    let duv1 = dpdx(in.uv);
    let duv2 = dpdy(in.uv);
    let rimWidth = fwidth(1.0 - abs(dot(normalize(in.worldNormal), normalize(cam.cameraPos.xyz - in.worldPos))));

    if (!isFront && model.params.y < 0.5) {
        discard;
    }
    if (texColor.a < model.shade.a) {
        discard;
    }
    let alpha = texColor.a * in.color.a * model.params.x * model.colorTint.a * matteCoverage(in.clipPos.xy);
    if (alpha <= 0.001) {
        discard;
    }

    let baseRgb = texColor.rgb * in.color.rgb * model.colorTint.rgb;
    var out: MeshFragment;
    if (model.materialParams.w > 1.5) {
        var toon = baseRgb;
        if (lights.params.y >= 0.5) {
            toon = toonLighting(in, baseRgb);
        }
        if (model.params.w > 0.5 && (in.emissive.w > 0.0 || dot(in.emissive.rgb, in.emissive.rgb) > 0.0)) {
            toon += in.emissive.rgb * in.emissive.w;
        }
        out.color = vec4<f32>(toon * alpha, alpha);
        out.hdr = vec4<f32>(srgbToLinear(toon) * alpha, alpha);
        return out;
    }

    var N = normalize(in.worldNormal);
    if (model.maps.x > 0.0) {
        var tn = normalSample * 2.0 - 1.0;
        tn = vec3<f32>(tn.xy * model.maps.x, tn.z);
        // The frame follows the surface side the camera sees.
        var Nf = N;
        if (dot(Nf, cam.cameraPos.xyz - in.worldPos) < 0.0) {
            Nf = -Nf;
        }
        N = perturbNormal(Nf, in.worldPos, in.uv, tn, dp1, dp2, duv1, duv2);
    }
    var pbr = model.pbr;
    if (model.maps.z > 0.5) {
        pbr.x = select(pbr.x, 1.0, pbr.x < 0.0) * mrSample.g;
        pbr.y = pbr.y * mrSample.b;
    }
    if (model.pbr.z > 0.5) {
        return shadeGlass(in, N, baseRgb, alpha, rimWidth);
    }
    var material = model.materialParams;
    material.z = material.z * mix(1.0, aoSample, clamp(model.maps.y, 0.0, 1.0));
    var emissive = model.emissive;
    if (model.maps.w > 0.5) {
        // Linear multiply in display space is close enough for an 8-bit map.
        emissive = vec4<f32>(emissive.rgb * emissiveSample, emissive.w);
    }
    if (model.params.w > 0.5 && (in.emissive.w > 0.0 || dot(in.emissive.rgb, in.emissive.rgb) > 0.0)) {
        emissive = in.emissive;
    }
    let shaded = shadeSurfaceFull(in.worldPos, N, baseRgb, material, pbr, emissive);
    out.color = vec4<f32>(shaded.display * alpha, alpha);
    out.hdr = vec4<f32>(shaded.hdr * alpha, alpha);
    return out;
}

struct MrtOutput {
    @location(0) color : vec4<f32>,
    @location(1) depth : vec4<f32>,
};

struct BloomOutput {
    @location(0) color : vec4<f32>,
    @location(1) hdr   : vec4<f32>,
};

struct MrtBloomOutput {
    @location(0) color : vec4<f32>,
    @location(1) depth : vec4<f32>,
    @location(2) hdr   : vec4<f32>,
};

@fragment
fn fs_single(in: VertexOutput, @builtin(front_facing) isFront: bool) -> @location(0) vec4<f32> {
    return shadeMesh(in, isFront).color;
}

@fragment
fn fs_mrt(in: VertexOutput, @builtin(front_facing) isFront: bool) -> MrtOutput {
    var out: MrtOutput;
    out.color = shadeMesh(in, isFront).color;
    out.depth = vec4<f32>(in.linearDepth, 0.0, 0.0, 1.0);
    return out;
}

@fragment
fn fs_single_bloom(in: VertexOutput, @builtin(front_facing) isFront: bool) -> BloomOutput {
    let f = shadeMesh(in, isFront);
    var out: BloomOutput;
    out.color = f.color;
    out.hdr = f.hdr;
    return out;
}

@fragment
fn fs_mrt_bloom(in: VertexOutput, @builtin(front_facing) isFront: bool) -> MrtBloomOutput {
    let f = shadeMesh(in, isFront);
    var out: MrtBloomOutput;
    out.color = f.color;
    out.depth = vec4<f32>(in.linearDepth, 0.0, 0.0, 1.0);
    out.hdr = f.hdr;
    return out;
}
`;
