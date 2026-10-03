/**
 * WebGPU WGSL shaders for 3D textured quads transformed by Camera View-Projection matrices.
 * Supports Ambient, Directional, Point, and Spot lights with Blinn-Phong specular shading,
 * normal matrix transformations for non-uniform scaling, and linear depth MRT output.
 */

import { lighting3dWgsl } from "./lighting3d.js";

export const quad3dWgsl = `
${lighting3dWgsl}
struct ModelUniforms {
    modelMatrix    : mat4x4<f32>,
    normalMatrix   : mat4x4<f32>,
    colorTint      : vec4<f32>,
    borderColor    : vec4<f32>,
    params         : vec4<f32>, // x = opacity, y = borderRadius, z = twoSided (1.0 = yes), w = borderWidth
    dimensions     : vec4<f32>, // x = width, y = height, zw = texture extent the layer covers (0 = whole texture)
    materialParams : vec4<f32>, // x = shininess, y = specularIntensity, z = ambientIntensity, w = materialMode (0=unlit, 1=lit)
};

@group(0) @binding(0) var<uniform> cam    : CameraUniforms;
@group(1) @binding(0) var<uniform> model  : ModelUniforms;
@group(2) @binding(0) var texSampler      : sampler;
@group(2) @binding(1) var mainTex         : texture_2d<f32>;
@group(3) @binding(0) var<uniform> lights : LightsUniforms;

struct VertexInput {
    @location(0) position : vec3<f32>,
    @location(1) uv       : vec2<f32>,
    @location(2) normal   : vec3<f32>,
};

struct VertexOutput {
    @builtin(position) clipPos     : vec4<f32>,
    @location(0)       uv          : vec2<f32>,
    @location(1)       worldPos    : vec3<f32>,
    @location(2)       worldNormal : vec3<f32>,
    @location(3)       linearDepth : f32,
    @location(4)       localPos    : vec2<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    let hasDimensions = model.dimensions.x > 0.0 && model.dimensions.y > 0.0;
    var pad = 0.0;
    if (hasDimensions) {
        let viewPos = cam.viewMatrix * model.modelMatrix * vec4<f32>(0.0, 0.0, 0.0, 1.0);
        let viewDepth = max(abs(viewPos.z), 0.1);
        let projScale = max(cam.projMatrix[1][1], 0.001);
        let worldPx = (2.0 * viewDepth) / max(cam.screenParams.y * projScale, 0.001);
        pad = max(4.0 * worldPx, 4.0);
    }
    let scalePad = select(vec2<f32>(1.0), 1.0 + vec2<f32>(2.0 * pad) / model.dimensions.xy, hasDimensions);
    
    let paddedPos = vec3<f32>(in.position.xy * scalePad, in.position.z);
    let worldPos4 = model.modelMatrix * vec4<f32>(paddedPos, 1.0);
    out.worldPos = worldPos4.xyz;
    
    // Normal transformed by 3x3 normal matrix
    let norm4 = model.normalMatrix * vec4<f32>(in.normal, 0.0);
    out.worldNormal = normalize(norm4.xyz);
    
    out.clipPos = cam.viewProjMatrix * worldPos4;
    
    out.localPos = in.position.xy * (model.dimensions.xy + vec2<f32>(2.0 * pad));
    // A layer of fractional size renders into a texture rounded up to whole
    // pixels: map the quad onto the part it covers, not the whole texture,
    // or the content is stretched by up to a pixel and resampled off-grid.
    let uvExtent = select(model.dimensions.zw, vec2<f32>(1.0), model.dimensions.zw <= vec2<f32>(0.0));
    out.uv = select(in.uv, (out.localPos / model.dimensions.xy + vec2<f32>(0.5)) * uvExtent, hasDimensions);
    
    // Linear camera depth along optical viewing axis
    out.linearDepth = dot(worldPos4.xyz - cam.cameraPos.xyz, cam.cameraDir.xyz);
    return out;
}

fn calculateLighting(in: VertexOutput, isFront: bool, baseColor: vec3<f32>) -> vec3<f32> {
    return applyLighting3D(in.worldPos, in.worldNormal, baseColor, model.materialParams);
}

fn sdRoundedRectWithNormal(p: vec2<f32>, b: vec2<f32>, r: f32) -> vec3<f32> {
    let q = abs(p) - b + vec2<f32>(r);
    let sx = select(1.0, -1.0, p.x < 0.0);
    let sy = select(1.0, -1.0, p.y < 0.0);
    let s = vec2<f32>(sx, sy);
    
    // Outside corner arc region
    if (q.x > 0.0 && q.y > 0.0) {
        let l = length(q);
        let n = select(vec2<f32>(0.0, 1.0), q / l, l > 0.0001);
        return vec3<f32>(l - r, s * n);
    }
    
    // Straight edges or interior
    if (q.x > q.y) {
        let dist = q.x - r;
        return vec3<f32>(dist, s.x, 0.0);
    } else {
        let dist = q.y - r;
        return vec3<f32>(dist, 0.0, s.y);
    }
}

struct MrtOutput {
    @location(0) color : vec4<f32>,
    @location(1) depth : vec4<f32>,
};

@fragment
fn fs_mrt(in: VertexOutput, @builtin(front_facing) isFront: bool) -> MrtOutput {
    // One-sided quads cull against their declared normal, not the hardware
    // winding: the Y-down view basis mirrors winding, so front_facing reads
    // camera-facing quads as back faces.
    if (model.params.z < 0.5 && dot(in.worldNormal, cam.cameraPos.xyz - in.worldPos) < 0.0) {
        discard;
    }
    
    var outerAlpha = 1.0;
    var borderFactor = 0.0;
    let br = model.params.y;
    let borderWidth = model.params.w;
    let hasDimensions = model.dimensions.x > 0.0 && model.dimensions.y > 0.0;
    
    if (hasDimensions) {
        let halfSize = model.dimensions.xy * 0.5;
        let normData = sdRoundedRectWithNormal(in.localPos, halfSize, br);
        
        let uvDx = dpdx(in.localPos);
        let uvDy = dpdy(in.localPos);
        
        let dPdx = normData.y * uvDx.x + normData.z * uvDx.y;
        let dPdy = normData.y * uvDy.x + normData.z * uvDy.y;
        let gradLen = max(sqrt(dPdx * dPdx + dPdy * dPdy), 0.001);
        
        let distPixel = normData.x / gradLen;
        outerAlpha = clamp(0.5 - distPixel, 0.0, 1.0);
        if (outerAlpha <= 0.001) {
            discard;
        }
        
        if (borderWidth > 0.0 && model.borderColor.a > 0.0) {
            let borderWidthPixel = max(borderWidth / gradLen, 0.0);
            let innerAlpha = clamp(0.5 - (distPixel + borderWidthPixel), 0.0, 1.0);
            borderFactor = clamp(outerAlpha - innerAlpha, 0.0, 1.0) * model.borderColor.a;
        }
    }
    
    let clampedUv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let dxUV = dpdx(in.uv);
    let dyUV = dpdy(in.uv);
    var texColor = textureSampleGrad(mainTex, texSampler, clampedUv, dxUV, dyUV);
    let texAlpha = texColor.a;
    
    let unmultipliedRgb = select(texColor.rgb / texAlpha, texColor.rgb, texAlpha < 0.001);
    let baseRgb = mix(unmultipliedRgb * model.colorTint.rgb, model.borderColor.rgb, borderFactor);
    let alpha = mix(texAlpha, 1.0, borderFactor) * model.params.x * model.colorTint.a * outerAlpha;
    if (alpha <= 0.001) {
        discard;
    }
    
    let litRgb = calculateLighting(in, isFront, baseRgb);
    let premulColor = vec4<f32>(litRgb * alpha, alpha);
    
    var out: MrtOutput;
    out.color = premulColor;
    out.depth = vec4<f32>(in.linearDepth, 0.0, 0.0, 1.0);
    return out;
}

@fragment
fn fs_single(in: VertexOutput, @builtin(front_facing) isFront: bool) -> @location(0) vec4<f32> {
    // One-sided quads cull against their declared normal, not the hardware
    // winding: the Y-down view basis mirrors winding, so front_facing reads
    // camera-facing quads as back faces.
    if (model.params.z < 0.5 && dot(in.worldNormal, cam.cameraPos.xyz - in.worldPos) < 0.0) {
        discard;
    }
    
    var outerAlpha = 1.0;
    var borderFactor = 0.0;
    let br = model.params.y;
    let borderWidth = model.params.w;
    let hasDimensions = model.dimensions.x > 0.0 && model.dimensions.y > 0.0;
    
    if (hasDimensions) {
        let halfSize = model.dimensions.xy * 0.5;
        let normData = sdRoundedRectWithNormal(in.localPos, halfSize, br);
        
        let uvDx = dpdx(in.localPos);
        let uvDy = dpdy(in.localPos);
        
        let dPdx = normData.y * uvDx.x + normData.z * uvDx.y;
        let dPdy = normData.y * uvDy.x + normData.z * uvDy.y;
        let gradLen = max(sqrt(dPdx * dPdx + dPdy * dPdy), 0.001);
        
        let distPixel = normData.x / gradLen;
        outerAlpha = clamp(0.5 - distPixel, 0.0, 1.0);
        if (outerAlpha <= 0.001) {
            discard;
        }
        
        if (borderWidth > 0.0 && model.borderColor.a > 0.0) {
            let borderWidthPixel = max(borderWidth / gradLen, 0.0);
            let innerAlpha = clamp(0.5 - (distPixel + borderWidthPixel), 0.0, 1.0);
            borderFactor = clamp(outerAlpha - innerAlpha, 0.0, 1.0) * model.borderColor.a;
        }
    }
    
    let clampedUv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let dxUV = dpdx(in.uv);
    let dyUV = dpdy(in.uv);
    var texColor = textureSampleGrad(mainTex, texSampler, clampedUv, dxUV, dyUV);
    let texAlpha = texColor.a;
    
    let unmultipliedRgb = select(texColor.rgb / texAlpha, texColor.rgb, texAlpha < 0.001);
    let baseRgb = mix(unmultipliedRgb * model.colorTint.rgb, model.borderColor.rgb, borderFactor);
    let alpha = mix(texAlpha, 1.0, borderFactor) * model.params.x * model.colorTint.a * outerAlpha;
    if (alpha <= 0.001) {
        discard;
    }
    
    let litRgb = calculateLighting(in, isFront, baseRgb);
    return vec4<f32>(litRgb * alpha, alpha);
}
`;
