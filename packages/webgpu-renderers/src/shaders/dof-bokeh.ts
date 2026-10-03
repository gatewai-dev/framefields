/**
 * WebGPU WGSL shader for bilateral Poisson-disc bokeh Depth-of-Field post-processing.
 * Reads color and linear depth targets to produce photorealistic optical lens blur.
 */

export const dofBokehWgsl = `
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

@group(0) @binding(0) var<uniform> cam     : CameraUniforms;
@group(0) @binding(1) var samp             : sampler;
@group(0) @binding(2) var colorTex         : texture_2d<f32>;
@group(0) @binding(3) var depthTex         : texture_2d<f32>;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0)       uv  : vec2<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid : u32) -> VSOut {
    var out: VSOut;
    // Fullscreen triangle covering [-1, 1] NDC
    var coord = vec2<f32>(-1.0, -1.0);
    if (vid == 1u) {
        coord = vec2<f32>(3.0, -1.0);
    } else if (vid == 2u) {
        coord = vec2<f32>(-1.0, 3.0);
    }
    out.pos = vec4<f32>(coord, 0.0, 1.0);
    out.uv = coord * 0.5 + 0.5;
    out.uv.y = 1.0 - out.uv.y; // Flip Y for texture coordinates
    return out;
}

fn computeCoC(depth: f32) -> f32 {
    let focusDist = cam.dofParams.x;
    let maxBlur = cam.dofParams.z;
    if (focusDist <= 0.0 || maxBlur <= 0.0) {
        return 0.0;
    }
    let delta = abs(depth - focusDist);
    // Smooth non-linear ramp around focus plane
    return clamp((delta / (focusDist * 0.5 + 1.0)) * maxBlur, 0.0, maxBlur);
}

@fragment
fn fs_dof(in: VSOut) -> @location(0) vec4<f32> {
    let centerColor = textureSampleLevel(colorTex, samp, in.uv, 0.0);
    let centerDepth = textureSampleLevel(depthTex, samp, in.uv, 0.0).r;
    let coc = computeCoC(centerDepth);
    
    // Skip if DoF is disabled or blur is negligible
    if (cam.dofParams.w < 0.5 || coc < 0.5) {
        return centerColor;
    }
    
    var accumColor = centerColor;
    var totalWeight = 1.0;
    
    let NUM_SAMPLES = 24;
    let GOLDEN_ANGLE = 2.39996323;
    let texelSize = 1.0 / cam.screenParams.xy;
    
    for (var i = 1; i <= NUM_SAMPLES; i = i + 1) {
        let theta = f32(i) * GOLDEN_ANGLE;
        let r = sqrt(f32(i) / f32(NUM_SAMPLES)) * coc;
        let offset = vec2<f32>(cos(theta), sin(theta)) * r * texelSize;
        
        let sampleUV = in.uv + offset;
        let sampleColor = textureSampleLevel(colorTex, samp, sampleUV, 0.0);
        let sampleDepth = textureSampleLevel(depthTex, samp, sampleUV, 0.0).r;
        let sampleCoC = computeCoC(sampleDepth);
        
        // Depth-aware bilateral rejection: prevent background bleed onto sharp foreground
        let depthDiff = sampleDepth - centerDepth;
        let weight = select(
            smoothstep(-10.0, 0.0, depthDiff) * clamp(sampleCoC / coc, 0.2, 1.0),
            1.0,
            depthDiff >= 0.0
        );
        
        accumColor = accumColor + sampleColor * weight;
        totalWeight = totalWeight + weight;
    }
    
    return accumColor / totalWeight;
}
`;
