/**
 * @file shaders/pbr-glass.ts
 * @module @gitframes/webgpu-renderers/shaders/pbr-glass
 *
 * WebGPU PBR Glass, Acrylic & Frosted Glass Refraction WGSL Shader.
 * Features Schlick Fresnel grazing rim reflectance, Snell's law refraction,
 * chromatic dispersion ray splitting (RGB), and roughness-based MIP blurring.
 */

export const pbrGlassWgsl = /* wgsl */ `
struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    projMatrix: mat4x4<f32>,
    viewProjMatrix: mat4x4<f32>,
    invViewProjMatrix: mat4x4<f32>,
    cameraPos: vec3<f32>,
    near: f32,
    cameraDir: vec3<f32>,
    far: f32,
    dofParams: vec4<f32>,
    screenParams: vec4<f32>,
};

struct ModelUniforms {
    modelMatrix: mat4x4<f32>,
    normalMatrix: mat4x4<f32>,
    colorTint: vec4<f32>,
    params: vec4<f32>, // opacity, borderRadius, twoSided, unused
};

struct GlassUniforms {
    // 0..15: ior, roughness, f0, transmission
    ior: f32,
    roughness: f32,
    f0: f32,
    transmission: f32,
    // 16..31: dispersion, envIntensity, fresnelPower, unused
    dispersion: f32,
    envIntensity: f32,
    fresnelPower: f32,
    _pad0: f32,
    // 32..47: viewportWidth, viewportHeight, unused, unused
    viewportWidth: f32,
    viewportHeight: f32,
    _pad1: f32,
    _pad2: f32,
    // 48..63: tint (r, g, b, a)
    tintColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<uniform> model: ModelUniforms;
@group(2) @binding(0) var<uniform> glass: GlassUniforms;
@group(3) @binding(0) var backdropSampler: sampler;
@group(3) @binding(1) var backdropTexture: texture_2d<f32>;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) normal: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) clipPos: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let worldPos4 = model.modelMatrix * vec4<f32>(in.position, 1.0);
    out.worldPos = worldPos4.xyz;
    let normal4 = model.normalMatrix * vec4<f32>(in.normal, 0.0);
    out.worldNormal = normalize(normal4.xyz);
    out.uv = in.uv;
    out.clipPos = camera.viewProjMatrix * worldPos4;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let V = normalize(camera.cameraPos - in.worldPos);
    var N = normalize(in.worldNormal);
    
    // Dynamic normal flip for two-sided surfaces viewed from behind
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    
    let NdotV = max(dot(N, V), 0.0001);
    
    // 1. Schlick Fresnel Reflectance
    let F = glass.f0 + (1.0 - glass.f0) * pow(1.0 - NdotV, max(1.0, glass.fresnelPower));
    
    // 2. Refraction Ray Direction with Chromatic Dispersion
    let ior = max(1.0, glass.ior);
    let disp = max(0.0, glass.dispersion);
    let eta_g = 1.0 / ior;
    let eta_r = 1.0 / max(1.0, ior - disp);
    let eta_b = 1.0 / (ior + disp);
    
    let R_refl = reflect(-V, N);
    let R_refr_r = refract(-V, N, eta_r);
    let R_refr_g = refract(-V, N, eta_g);
    let R_refr_b = refract(-V, N, eta_b);
    
    let screenUv = in.clipPos.xy / vec2<f32>(glass.viewportWidth, glass.viewportHeight);
    
    // 3. Screen-Space Refraction Lookup with Chromatic Aberration Offset
    let refractOffsetScale = 0.035 * (1.0 - glass.roughness * 0.4);
    let uv_r = clamp(screenUv + R_refr_r.xy * refractOffsetScale, vec2<f32>(0.001), vec2<f32>(0.999));
    let uv_g = clamp(screenUv + R_refr_g.xy * refractOffsetScale, vec2<f32>(0.001), vec2<f32>(0.999));
    let uv_b = clamp(screenUv + R_refr_b.xy * refractOffsetScale, vec2<f32>(0.001), vec2<f32>(0.999));
    
    // Roughness mip/jitter level
    let mipLevel = glass.roughness * 5.0;
    let sampleR = textureSampleLevel(backdropTexture, backdropSampler, uv_r, mipLevel).r;
    let sampleG = textureSampleLevel(backdropTexture, backdropSampler, uv_g, mipLevel).g;
    let sampleB = textureSampleLevel(backdropTexture, backdropSampler, uv_b, mipLevel).b;
    
    let transmittedColor = vec3<f32>(sampleR, sampleG, sampleB) * glass.tintColor.rgb * model.colorTint.rgb;
    
    // 4. Procedural Studio HDRI Environment Reflection (Warm key + cool rim highlights)
    let envAngle = atan2(R_refl.z, R_refl.x);
    let envElevation = R_refl.y;
    let studioKey = pow(max(0.0, dot(R_refl, normalize(vec3<f32>(0.6, 0.8, -0.5)))), 32.0) * 1.5;
    let studioRim = pow(max(0.0, dot(R_refl, normalize(vec3<f32>(-0.7, 0.3, 0.6)))), 16.0) * 0.8;
    let ambientSky = mix(vec3<f32>(0.92, 0.94, 0.98), vec3<f32>(0.98, 0.96, 0.92), envElevation * 0.5 + 0.5);
    let envColor = (ambientSky * 0.6 + vec3<f32>(1.0, 0.98, 0.95) * studioKey + vec3<f32>(0.85, 0.92, 1.0) * studioRim) * glass.envIntensity;
    
    // 5. Energy-Conserving Blend with Premultiplied Alpha
    let blendedRGB = mix(transmittedColor, envColor, F);
    let alpha = clamp((F + (1.0 - glass.transmission) * 0.6) * model.params.x, 0.0, 1.0);
    
    return vec4<f32>(blendedRGB * alpha, alpha);
}
`;
