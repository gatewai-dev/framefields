/**
 * @file packages/webgpu-renderers/src/shaders/motion-blur.ts
 * WGSL Shader Module for Velocity-Directed Line Integral Camera Motion Blur.
 */

export const motionBlurWgsl = /* wgsl */ `
struct MotionBlurUniforms {
    shutterFraction: f32, // shutterAngle / 360.0
    sampleCount: u32,     // e.g. 16
    maxVelocity: f32,     // in pixels
    tileDilation: u32,
    viewportWidth: f32,
    viewportHeight: f32,
    depthThreshold: f32,
    curveType: u32,       // 0: box, 1: gaussian, 2: triangle
};

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var velocityTexture: texture_2d<f32>;
@group(0) @binding(2) var depthTexture: texture_depth_2d;
@group(0) @binding(3) var colorSampler: sampler;
@group(0) @binding(4) var<uniform> u: MotionBlurUniforms;

fn computeVertexPos(vertexIndex: u32) -> vec4<f32> {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    return computeVertexPos(vertexIndex);
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    return computeVertexPos(vertexIndex);
}

fn executeMotionBlur(pos: vec4<f32>) -> vec4<f32> {
    let uv = pos.xy / vec2<f32>(u.viewportWidth, u.viewportHeight);
    let centerDepth = textureLoad(depthTexture, vec2<i32>(pos.xy), 0);
    let rawVel = textureSampleLevel(velocityTexture, colorSampler, uv, 0.0).xy;
    
    // Scale velocity by shutter exposure fraction
    var vel = rawVel * u.shutterFraction;
    let speed = length(vel);
    
    if (speed < 0.5) {
        return textureSampleLevel(colorTexture, colorSampler, uv, 0.0);
    }
    
    // Clamp to configured max velocity limit
    if (speed > u.maxVelocity) {
        vel = (vel / speed) * u.maxVelocity;
    }
    
    let velUV = vel / vec2<f32>(u.viewportWidth, u.viewportHeight);
    let halfSamples = f32(u.sampleCount) * 0.5;
    
    var accumColor = vec4<f32>(0.0);
    var totalWeight = 0.0;
    
    for (var i = 0u; i < u.sampleCount; i = i + 1u) {
        let t = (f32(i) - halfSamples) / halfSamples;
        let sampleUV = uv + velUV * t;
        
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }
        
        let sampleDepth = textureSampleLevel(depthTexture, colorSampler, sampleUV, 0);
        let depthDelta = abs(sampleDepth - centerDepth);
        let depthWeight = clamp(1.0 - depthDelta / max(u.depthThreshold, 0.0001), 0.05, 1.0);
        
        var curveW = 1.0;
        if (u.curveType == 1u) {
            curveW = exp(-2.5 * t * t);
        } else if (u.curveType == 2u) {
            curveW = 1.0 - abs(t);
        }
        
        let w = curveW * depthWeight;
        let sampleCol = textureSampleLevel(colorTexture, colorSampler, sampleUV, 0.0);
        
        accumColor += sampleCol * w;
        totalWeight += w;
    }
    
    if (totalWeight <= 0.0) {
        return textureSampleLevel(colorTexture, colorSampler, uv, 0.0);
    }
    
    return accumColor / totalWeight;
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return executeMotionBlur(pos);
}

@fragment
fn fs_motion_blur(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return executeMotionBlur(pos);
}
`;
