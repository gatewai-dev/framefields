/**
 * WebGPU WGSL shaders for 3D static and skinned meshes.
 * Supports GPU Linear Blend Skinning (up to 128 bones),
 * Multi-Light Blinn-Phong illumination (Ambient, Directional, Point, Spot) or toon shading,
 * alpha-cutoff (glTF MASK) materials,
 * Material parameters, normal transformations, and linear depth MRT output for Bokeh DoF.
 */

export const mesh3dWgsl = `
struct CameraUniforms {
    viewMatrix        : mat4x4<f32>,
    projMatrix        : mat4x4<f32>,
    viewProjMatrix    : mat4x4<f32>,
    invViewProjMatrix : mat4x4<f32>,
    cameraPos         : vec4<f32>, // xyz = eye, w = near
    cameraDir         : vec4<f32>, // xyz = forward, w = far
    dofParams         : vec4<f32>, // x = focusDistance, y = fStop, z = maxBlurRadius, w = dofEnabled
    screenParams      : vec4<f32>, // x = surfaceWidth, y = surfaceHeight, z = time, w = unused
};

struct ModelUniforms {
    modelMatrix    : mat4x4<f32>,
    normalMatrix   : mat4x4<f32>,
    colorTint      : vec4<f32>,
    params         : vec4<f32>, // x = opacity, y = twoSided (1.0 = yes), z = isSkinned (1.0 = yes), w = wireframe
    materialParams : vec4<f32>, // x = shininess, y = specularIntensity, z = ambientIntensity, w = materialMode (0=unlit, 1=lit, 2=toon)
    shade          : vec4<f32>, // rgb = toon shadow-side color multiplier, a = alpha cutoff (0 = none)
};

struct SkinningUniforms {
    jointMatrices : array<mat4x4<f32>, 128>,
};

struct GPULight {
    posType        : vec4<f32>, // xyz = position, w = type (0=ambient, 1=directional, 2=point, 3=spot)
    dirRadius      : vec4<f32>, // xyz = normalized direction, w = radius / range
    colorIntensity : vec4<f32>, // rgb = linear color, w = intensity
    spotParams     : vec4<f32>, // x = cos(outer), y = cos(inner), z = decay, w = unused
};

struct LightsUniforms {
    ambientColor : vec4<f32>, // rgb = ambient color * intensity, w = unused
    params       : vec4<f32>, // x = numLights, y = hasLights (1.0 = lit, 0.0 = unlit), z = unused, w = unused
    lights       : array<GPULight, 8>,
};

@group(0) @binding(0) var<uniform> cam      : CameraUniforms;
@group(1) @binding(0) var<uniform> model    : ModelUniforms;
@group(1) @binding(1) var<uniform> skinning : SkinningUniforms;
@group(2) @binding(0) var texSampler        : sampler;
@group(2) @binding(1) var mainTex           : texture_2d<f32>;
@group(3) @binding(0) var<uniform> lights   : LightsUniforms;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) uv       : vec2<f32>,
    @location(2) normal   : vec3<f32>,
    @location(3) joints   : vec4<f32>,
    @location(4) weights  : vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clipPos     : vec4<f32>,
    @location(0)       uv          : vec2<f32>,
    @location(1)       worldPos    : vec3<f32>,
    @location(2)       worldNormal : vec3<f32>,
    @location(3)       linearDepth : f32,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
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

    let worldPos4 = model.modelMatrix * vec4<f32>(localPos, 1.0);
    out.worldPos = worldPos4.xyz;

    let norm4 = model.normalMatrix * vec4<f32>(localNorm, 0.0);
    out.worldNormal = normalize(norm4.xyz);

    out.clipPos = cam.viewProjMatrix * worldPos4;
    out.uv = in.uv;

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

fn calculateLighting(in: VertexOutput, isFront: bool, baseColor: vec3<f32>) -> vec3<f32> {
    if (lights.params.y < 0.5 || model.materialParams.w < 0.5) {
        return baseColor;
    }
    if (model.materialParams.w > 1.5) {
        return toonLighting(in, baseColor);
    }

    var N = normalize(in.worldNormal);
    let V = normalize(cam.cameraPos.xyz - in.worldPos);
    if (dot(N, V) < 0.0) {
        N = -N;
    }

    let shininess = max(1.0, model.materialParams.x);
    let specularInt = model.materialParams.y;
    let ambientInt = model.materialParams.z;

    var totalIllumination = baseColor * (lights.ambientColor.rgb * ambientInt);

    let numLights = i32(lights.params.x);
    for (var i = 0; i < 8; i++) {
        if (i >= numLights) {
            break;
        }
        let light = lights.lights[i];
        let lightType = light.posType.w;
        let lightColor = light.colorIntensity.rgb;
        let intensity = light.colorIntensity.w;

        var L = vec3<f32>(0.0, 0.0, 1.0);
        var attenuation = 1.0;

        if (lightType > 0.5 && lightType < 1.5) {
            // Directional Light
            L = normalize(-light.dirRadius.xyz);
        } else if (lightType >= 1.5) {
            // Point or Spot Light
            let toLight = light.posType.xyz - in.worldPos;
            let dist = length(toLight);
            let radius = max(1.0, light.dirRadius.w);
            if (dist > radius) {
                continue;
            }
            L = normalize(toLight);

            let dNorm = clamp(dist / radius, 0.0, 1.0);
            let decay = max(0.5, light.spotParams.z);
            attenuation = pow(clamp(1.0 - dNorm, 0.0, 1.0), decay);

            if (lightType > 2.5) {
                // Spot Light
                let spotDir = normalize(light.dirRadius.xyz);
                let cosAngle = dot(-L, spotDir);
                let cosOuter = light.spotParams.x;
                let cosInner = light.spotParams.y;

                if (cosAngle < cosOuter) {
                    continue;
                }
                let spotFalloff = smoothstep(cosOuter, cosInner, cosAngle);
                attenuation *= spotFalloff;
            }
        } else {
            continue;
        }

        let NdotL = max(dot(N, L), 0.0);
        let diffuse = baseColor * lightColor * (NdotL * intensity * attenuation);

        var specular = vec3<f32>(0.0);
        if (NdotL > 0.0 && specularInt > 0.001) {
            let H = normalize(L + V);
            let NdotH = max(dot(N, H), 0.0);
            let specFactor = pow(NdotH, shininess);
            specular = lightColor * (specFactor * specularInt * intensity * attenuation);
        }

        totalIllumination += diffuse + specular;
    }

    return totalIllumination;
}

struct MrtOutput {
    @location(0) color : vec4<f32>,
    @location(1) depth : vec4<f32>,
};

@fragment
fn fs_mrt(in: VertexOutput, @builtin(front_facing) isFront: bool) -> MrtOutput {
    if (!isFront && model.params.y < 0.5) {
        discard;
    }

    var texColor = textureSample(mainTex, texSampler, in.uv);
    if (texColor.a < model.shade.a) {
        discard;
    }
    let alpha = texColor.a * model.params.x * model.colorTint.a;
    if (alpha <= 0.001) {
        discard;
    }

    let baseRgb = texColor.rgb * model.colorTint.rgb;
    let litRgb = calculateLighting(in, isFront, baseRgb);
    let premulColor = vec4<f32>(litRgb * alpha, alpha);

    var out: MrtOutput;
    out.color = premulColor;
    out.depth = vec4<f32>(in.linearDepth, 0.0, 0.0, 1.0);
    return out;
}

@fragment
fn fs_single(in: VertexOutput, @builtin(front_facing) isFront: bool) -> @location(0) vec4<f32> {
    if (!isFront && model.params.y < 0.5) {
        discard;
    }

    var texColor = textureSample(mainTex, texSampler, in.uv);
    if (texColor.a < model.shade.a) {
        discard;
    }
    let alpha = texColor.a * model.params.x * model.colorTint.a;
    if (alpha <= 0.001) {
        discard;
    }

    let baseRgb = texColor.rgb * model.colorTint.rgb;
    let litRgb = calculateLighting(in, isFront, baseRgb);
    return vec4<f32>(litRgb * alpha, alpha);
}
`;
