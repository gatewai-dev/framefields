/**
 * @file packages/webgpu-renderers/src/shaders/ssao.ts
 * WGSL Shader Module for Screen-Space Ambient Occlusion (SSAO) & Bilateral Cross-Blur.
 */

export const ssaoWgsl = /* wgsl */ `
struct SSAOUniforms {
    projMatrix: mat4x4<f32>,
    invProjMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    radius: f32,
    bias: f32,
    intensity: f32,
    sampleCount: u32,
    viewportWidth: f32,
    viewportHeight: f32,
};

@group(0) @binding(0) var depthTexture: texture_depth_2d;
@group(0) @binding(1) var normalTexture: texture_2d<f32>;
@group(0) @binding(2) var noiseTexture: texture_2d<f32>;
@group(0) @binding(3) var colorSampler: sampler;
@group(0) @binding(4) var<storage, read> kernelSamples: array<vec4<f32>>;
@group(0) @binding(5) var<uniform> u: SSAOUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

fn reconstructViewPos(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let clipPos = vec4<f32>(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
    let viewPos = u.invProjMatrix * clipPos;
    return viewPos.xyz / viewPos.w;
}

@fragment
fn fs_ssao(@builtin(position) pos: vec4<f32>) -> @location(0) f32 {
    let uv = pos.xy / vec2<f32>(u.viewportWidth, u.viewportHeight);
    let depth = textureSampleLevel(depthTexture, colorSampler, uv, 0);
    
    if (depth >= 1.0) {
        return 1.0;
    }
    
    let rawNormal = textureSampleLevel(normalTexture, colorSampler, uv, 0.0).xyz;
    let normal = normalize(rawNormal * 2.0 - 1.0);
    let viewPos = reconstructViewPos(uv, depth);
    
    let noiseUV = pos.xy / 4.0;
    let randomVec = normalize(textureSampleLevel(noiseTexture, colorSampler, noiseUV, 0.0).xyz * 2.0 - 1.0);
    
    let tangent = normalize(randomVec - normal * dot(randomVec, normal));
    let bitangent = cross(normal, tangent);
    let TBN = mat3x3<f32>(tangent, bitangent, normal);
    
    var occlusion = 0.0;
    let count = min(u.sampleCount, arrayLength(&kernelSamples));
    
    for (var i = 0u; i < count; i = i + 1u) {
        let sampleDir = TBN * kernelSamples[i].xyz;
        let samplePos = viewPos + sampleDir * u.radius;
        
        let offset = u.projMatrix * vec4<f32>(samplePos, 1.0);
        var sampleUV = vec2<f32>(
            (offset.x / offset.w) * 0.5 + 0.5,
            (1.0 - (offset.y / offset.w)) * 0.5
        );
        
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }
        
        let sampleDepthVal = textureSampleLevel(depthTexture, colorSampler, sampleUV, 0);
        let sampleViewZ = reconstructViewPos(sampleUV, sampleDepthVal).z;
        
        let rangeCheck = smoothstep(0.0, 1.0, u.radius / max(abs(viewPos.z - sampleViewZ), 0.001));
        if (sampleViewZ >= samplePos.z + u.bias) {
            occlusion += rangeCheck;
        }
    }
    
    let ao = 1.0 - (occlusion / f32(max(count, 1u))) * u.intensity;
    return clamp(ao, 0.0, 1.0);
}
`;

export const ssaoBlurWgsl = /* wgsl */ `
struct BlurUniforms {
    viewportWidth: f32,
    viewportHeight: f32,
    blurRadius: i32,
    depthThreshold: f32,
};

@group(0) @binding(0) var ssaoTexture: texture_2d<f32>;
@group(0) @binding(1) var depthTexture: texture_depth_2d;
@group(0) @binding(2) var colorSampler: sampler;
@group(0) @binding(3) var<uniform> u: BlurUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_blur(@builtin(position) pos: vec4<f32>) -> @location(0) f32 {
    let uv = pos.xy / vec2<f32>(u.viewportWidth, u.viewportHeight);
    let centerDepth = textureSampleLevel(depthTexture, colorSampler, uv, 0);
    let centerAO = textureSampleLevel(ssaoTexture, colorSampler, uv, 0.0).r;
    
    if (centerDepth >= 1.0) {
        return 1.0;
    }
    
    var result = 0.0;
    var totalWeight = 0.0;
    let texelSize = 1.0 / vec2<f32>(u.viewportWidth, u.viewportHeight);
    let r = u.blurRadius;
    
    for (var x = -r; x <= r; x = x + 1) {
        for (var y = -r; y <= r; y = y + 1) {
            let offsetUV = uv + vec2<f32>(f32(x), f32(y)) * texelSize;
            let sampleDepth = textureSampleLevel(depthTexture, colorSampler, offsetUV, 0);
            let depthDelta = abs(sampleDepth - centerDepth);
            
            let spatialW = exp(-f32(x * x + y * y) / f32(2 * r * r));
            let depthW = clamp(1.0 - depthDelta / max(u.depthThreshold, 0.0001), 0.0, 1.0);
            let w = spatialW * depthW;
            
            let sampleAO = textureSampleLevel(ssaoTexture, colorSampler, offsetUV, 0.0).r;
            result += sampleAO * w;
            totalWeight += w;
        }
    }
    
    if (totalWeight <= 0.0) {
        return centerAO;
    }
    return result / totalWeight;
}
`;
