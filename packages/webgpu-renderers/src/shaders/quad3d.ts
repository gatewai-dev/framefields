/**
 * WebGPU WGSL shaders for 3D textured quads transformed by Camera View-Projection matrices.
 * Supports Ambient, Directional, Point, and Spot lights with Blinn-Phong specular shading,
 * normal matrix transformations for non-uniform scaling, and linear depth MRT output.
 */

import { lighting3dWgsl, lightsBindingsWgsl } from "./lighting3d.js";
import { matte3dWgsl } from "./matte3d.js";

export const quad3dWgsl = `
${lighting3dWgsl}
// Grid cells either side a relief's normals span.
const RELIEF_NORMAL_CELLS : f32 = 4.0;

struct ModelUniforms {
    modelMatrix          : mat4x4<f32>,
    normalMatrix         : mat4x4<f32>,
    colorTint            : vec4<f32>,
    borderColor          : vec4<f32>,
    params               : vec4<f32>, // x = opacity, y = borderRadius, z = twoSided (1.0 = yes), w = borderWidth
    dimensions           : vec4<f32>, // x = width, y = height, zw = texture extent the layer covers (0 = whole texture)
    materialParams       : vec4<f32>, // x = shininess, y = specularIntensity, z = ambientIntensity, w = materialMode (0=unlit, 1=lit)
    pbr                  : vec4<f32>, // x = roughness (<0 = default), y = metallic
    emissive             : vec4<f32>, // rgb = sRGB emissive color, w = strength
    toonShadow           : vec4<f32>, // rgb shadow-side multiplier, w diffuse modelling
    toonLight            : vec4<f32>, // rgb lit-side multiplier, w terminator threshold
    toonParams           : vec4<f32>, // x terminator softness, y outline participation, z sheenRoughness, w triplanarSharpness
    substrateClearcoat   : vec4<f32>, // x = clearcoat, y = clearcoatRoughness, z = anisotropy, w = anisotropyRotationRad
    substrateSubsurface  : vec4<f32>, // x = subsurface, yzw = subsurfaceColor (sRGB)
    substrateSheen       : vec4<f32>, // x = sheen, yzw = sheenColor (sRGB)
    substrateIridescence : vec4<f32>, // x = iridescence, y = thicknessNm, z = filmIor, w = triplanarUvFreq
    relief               : vec4<f32>, // x = amount (px), y = on, w = grid cells per side
    reliefRect           : vec4<f32>, // xy = where the layer's box starts in reliefTex (0..1), zw = its size
    reliefEye            : vec4<f32>, // xyz = the eye the surface keeps its look from (the default camera)
};

@group(0) @binding(0) var<uniform> cam    : CameraUniforms;
@group(1) @binding(0) var<uniform> model  : ModelUniforms;
${matte3dWgsl(1, 1)}@group(1) @binding(2) var reliefTex : texture_2d<f32>;
@group(2) @binding(0) var texSampler      : sampler;
@group(2) @binding(1) var mainTex         : texture_2d<f32>;
${lightsBindingsWgsl}

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

// Relief: the layer's plane pushed toward the eye by the brightness of a
// second picture, so a flat quad becomes a surface (see DrawQuad3DOpts.relief).
fn reliefAt(uv: vec2<f32>) -> f32 {
    let dims = vec2<f32>(textureDimensions(reliefTex));
    let p = (model.reliefRect.xy + clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * model.reliefRect.zw) * dims - 0.5;
    let i = floor(p);
    let f = p - i;
    // Texels of the layer's own box only: past its edge the relief was never drawn.
    let lo = max(floor(model.reliefRect.xy * dims), vec2<f32>(0.0));
    let hi = min(ceil((model.reliefRect.xy + model.reliefRect.zw) * dims) - 1.0, dims - 1.0);
    let a = textureLoad(reliefTex, vec2<i32>(clamp(i, lo, hi)), 0).rgb;
    let b = textureLoad(reliefTex, vec2<i32>(clamp(i + vec2<f32>(1.0, 0.0), lo, hi)), 0).rgb;
    let c = textureLoad(reliefTex, vec2<i32>(clamp(i + vec2<f32>(0.0, 1.0), lo, hi)), 0).rgb;
    let d = textureLoad(reliefTex, vec2<i32>(clamp(i + vec2<f32>(1.0, 1.0), lo, hi)), 0).rgb;
    let rgb = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// The plane's front: the side the default camera sees.
fn reliefFront() -> vec3<f32> {
    return normalize((model.normalMatrix * vec4<f32>(0.0, 0.0, -1.0, 0.0)).xyz);
}

// A point of the plane lifted by its relief along the ray to the eye, so from
// the eye it lands on the same pixel as the flat picture.
fn reliefPoint(local: vec2<f32>, uv: vec2<f32>) -> vec3<f32> {
    let flat = (model.modelMatrix * vec4<f32>(local, 0.0, 1.0)).xyz;
    let n = reliefFront();
    let h = model.relief.x * reliefAt(uv);
    let toEye = model.reliefEye.xyz - flat;
    let along = dot(toEye, n);
    return select(flat + n * h, flat + toEye * (h / along), along > 1.0);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    let hasDimensions = model.dimensions.x > 0.0 && model.dimensions.y > 0.0;
    let hasRelief = model.relief.y > 0.5;
    var pad = 0.0;
    if (hasDimensions && !hasRelief) {
        let viewPos = cam.viewMatrix * model.modelMatrix * vec4<f32>(0.0, 0.0, 0.0, 1.0);
        let viewDepth = max(abs(viewPos.z), 0.1);
        let projScale = max(cam.projMatrix[1][1], 0.001);
        let worldPx = (2.0 * viewDepth) / max(cam.screenParams.y * projScale, 0.001);
        pad = max(4.0 * worldPx, 4.0);
    }
    let scalePad = select(vec2<f32>(1.0), 1.0 + vec2<f32>(2.0 * pad) / model.dimensions.xy, hasDimensions);
    
    let paddedPos = vec3<f32>(in.position.xy * scalePad, in.position.z);
    var worldPos4 = model.modelMatrix * vec4<f32>(paddedPos, 1.0);
    
    // Normal transformed by 3x3 normal matrix
    let norm4 = model.normalMatrix * vec4<f32>(in.normal, 0.0);
    out.worldNormal = normalize(norm4.xyz);
    if (hasRelief) {
        let p = reliefPoint(in.position.xy, in.uv);
        // Central differences a few cells wide: an 8-bit height map steps every
        // level, and normals from adjacent cells would light those steps as rings.
        let e = RELIEF_NORMAL_CELLS / max(model.relief.w, 1.0);
        let dx = vec2<f32>(e, 0.0);
        let dy = vec2<f32>(0.0, e);
        let tx = reliefPoint(in.position.xy + dx, in.uv + dx) - reliefPoint(in.position.xy - dx, in.uv - dx);
        let ty = reliefPoint(in.position.xy + dy, in.uv + dy) - reliefPoint(in.position.xy - dy, in.uv - dy);
        var nrm = normalize(cross(tx, ty));
        if (dot(nrm, reliefFront()) < 0.0) {
            nrm = -nrm;
        }
        worldPos4 = vec4<f32>(p, 1.0);
        out.worldNormal = nrm;
    }
    out.worldPos = worldPos4.xyz;
    
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

struct QuadFragment {
    color : vec4<f32>, // premultiplied display color
    hdr   : vec4<f32>, // premultiplied scene radiance (bloom source)
};

fn shadeQuad(in: VertexOutput, isFront: bool) -> QuadFragment {
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
    let alpha = mix(texAlpha, 1.0, borderFactor) * model.params.x * model.colorTint.a * outerAlpha * matteCoverage(in.clipPos.xy);
    if (alpha <= 0.001) {
        discard;
    }
    
    let substrate = SubstrateParams(
        model.substrateClearcoat,
        model.substrateSubsurface,
        model.substrateSheen,
        model.substrateIridescence,
    );
    let shaded = shadeSurfaceSubstrate(in.worldPos, in.worldNormal, baseRgb, model.materialParams, model.pbr, model.emissive, model.toonShadow, model.toonLight, model.toonParams, substrate);
    var out: QuadFragment;
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
    return shadeQuad(in, isFront).color;
}

@fragment
fn fs_mrt(in: VertexOutput, @builtin(front_facing) isFront: bool) -> MrtOutput {
    var out: MrtOutput;
    out.color = shadeQuad(in, isFront).color;
    out.depth = geometryPixel(in.linearDepth, in.worldNormal, model.toonParams.y);
    return out;
}

@fragment
fn fs_single_bloom(in: VertexOutput, @builtin(front_facing) isFront: bool) -> BloomOutput {
    let f = shadeQuad(in, isFront);
    var out: BloomOutput;
    out.color = f.color;
    out.hdr = f.hdr;
    return out;
}

@fragment
fn fs_mrt_bloom(in: VertexOutput, @builtin(front_facing) isFront: bool) -> MrtBloomOutput {
    let f = shadeQuad(in, isFront);
    var out: MrtBloomOutput;
    out.color = f.color;
    out.depth = geometryPixel(in.linearDepth, in.worldNormal, model.toonParams.y);
    out.hdr = f.hdr;
    return out;
}

// Shadow-map pass: depth only, alpha-tested so a cut-out casts its shape.
@fragment
fn fs_shadow(in: VertexOutput) {
    let clampedUv = clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let a = textureSampleLevel(mainTex, texSampler, clampedUv, 0.0).a * model.params.x * model.colorTint.a;
    if (a < 0.5) {
        discard;
    }
}
`;
