/**
 * @file shaders/screen-space-relight.ts
 * Screen-Space Normal Map 3D Relighting WGSL Shader
 * Casts dynamic multi-light Blinn-Phong illumination (Ambient, Directional, Point, Spot)
 * across 2D generative video and media layers using reconstructed surface normals.
 */

export const screenSpaceRelightWgsl = /* wgsl */ `
struct RelightMaterialUniforms {
    // vec4 0
    roughness        : f32,
    specularStrength : f32,
    metallic         : f32,
    ambientIntensity : f32,

    // vec4 1
    depthScale       : f32,
    depthInvert      : f32,
    hasNormalMap     : f32,
    volumetricDensity: f32,

    // vec4 2
    viewportWidth    : f32,
    viewportHeight   : f32,
    shininess        : f32,
    opacity          : f32,

    // vec4 3
    layerX           : f32,
    layerY           : f32,
    _pad0            : f32,
    _pad1            : f32,
};

struct GPULight {
    posType        : vec4<f32>, // xyz = position, w = type (0=ambient, 1=directional, 2=point, 3=spot)
    dirRadius      : vec4<f32>, // xyz = normalized direction, w = radius
    colorIntensity : vec4<f32>, // rgb = linear color, w = intensity
    spotParams     : vec4<f32>, // x = cos(outer), y = cos(inner), z = decay, w = 0
};

struct LightsUniforms {
    ambientColor : vec4<f32>,
    params       : vec4<f32>, // x = lightCount, y = hasLights (1=lit, 0=unlit)
    lights       : array<GPULight, 8>,
};

@group(0) @binding(0) var<uniform> mat    : RelightMaterialUniforms;
@group(1) @binding(0) var<uniform> lights : LightsUniforms;

@group(2) @binding(0) var albedoTex       : texture_2d<f32>;
@group(2) @binding(1) var albedoSamp      : sampler;
@group(2) @binding(2) var normalTex       : texture_2d<f32>;
@group(2) @binding(3) var normalSamp      : sampler;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, 1.0),
        vec2<f32>( 1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
    let albedo = textureSampleLevel(albedoTex, albedoSamp, in.uv, 0.0);
    if (albedo.a <= 0.001) {
        return vec4<f32>(0.0);
    }

    // Normal unpacking: [0, 1] -> [-1, 1]
    var N = vec3<f32>(0.0, 0.0, 1.0);
    if (mat.hasNormalMap > 0.5) {
        let rawNormal = textureSampleLevel(normalTex, normalSamp, in.uv, 0.0).xyz;
        let unpacked = rawNormal * 2.0 - 1.0;
        N = normalize(vec3<f32>(unpacked.x, unpacked.y, max(unpacked.z, 0.05)));
    }

    let V = vec3<f32>(0.0, 0.0, 1.0);
    let pSurface = vec3<f32>(
        mat.layerX + in.uv.x * mat.viewportWidth,
        mat.layerY + in.uv.y * mat.viewportHeight,
        0.0
    );

    // If scene lights are not declared, output base albedo unmodified
    if (lights.params.y < 0.5) {
        return vec4<f32>(albedo.rgb * mat.opacity, albedo.a * mat.opacity);
    }

    let numLights = u32(min(lights.params.x, 8.0));
    var ambientAccum = lights.ambientColor.rgb * mat.ambientIntensity;
    var directDiffuseAccum = vec3<f32>(0.0);
    var directSpecularAccum = vec3<f32>(0.0);

    let roughness = clamp(mat.roughness, 0.02, 1.0);
    let specPower = max(2.0, 2.0 / (roughness * roughness) - 2.0);

    for (var i = 0u; i < 8u; i = i + 1u) {
        if (i >= numLights) {
            break;
        }

        let light = lights.lights[i];
        let lightType = light.posType.w;
        let lightColor = light.colorIntensity.rgb;
        let intensity = light.colorIntensity.w;

        var L = vec3<f32>(0.0, 0.0, 1.0);
        var attenuation: f32 = 1.0;

        if (lightType > 0.5 && lightType < 1.5) {
            // Directional Light
            L = normalize(-light.dirRadius.xyz);
        } else if (lightType >= 1.5) {
            // Point or Spot Light
            let lightPosCanvas = light.posType.xyz;
            let toLight = lightPosCanvas - pSurface;
            let dist = length(toLight);
            let radius = max(10.0, light.dirRadius.w);

            if (dist > radius * 2.0) {
                continue;
            }

            L = normalize(toLight);
            let dNorm = clamp(dist / radius, 0.0, 1.0);
            let decay = max(0.5, light.spotParams.z);
            attenuation = pow(clamp(1.0 - dNorm, 0.0, 1.0), decay) / (1.0 + dNorm * dNorm);

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
            // Ambient light in array
            ambientAccum += lightColor * (intensity * mat.ambientIntensity);
            continue;
        }

        let NdotL = max(dot(N, L), 0.0);
        let diffuse = lightColor * (NdotL * intensity * attenuation);
        directDiffuseAccum += diffuse;

        let H = normalize(L + V);
        let NdotH = max(dot(N, H), 0.0);
        let specularFactor = pow(NdotH, specPower) * mat.specularStrength * intensity * attenuation;
        let specColor = mix(lightColor, lightColor * albedo.rgb, mat.metallic);
        directSpecularAccum += specColor * specularFactor;
    }

    let finalColor = albedo.rgb * (ambientAccum + directDiffuseAccum) + directSpecularAccum;
    let outOpacity = albedo.a * mat.opacity;

    // Premultiplied alpha return
    return vec4<f32>(finalColor * outOpacity, outOpacity);
}
`;
