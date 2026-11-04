/**
 * Camera and light uniforms plus the surface shading shared by the 3D quad,
 * 3D text and mesh shaders, so every surface in a scene is lit the same way.
 * The including shader declares `cam : CameraUniforms` and binds
 * `lightsBindingsWgsl` (lights, shadow map, shadow sampler) at group 3.
 *
 * Two shading modes, picked per scene by `lights.params.z`:
 *  - legacy (no `Layer.environment`): Blinn-Phong in display space, exactly
 *    as before, plus shadows and emissive when a scene asks for them;
 *  - physical (`Layer.environment(...)` present): linear-light GGX PBR with a
 *    procedural studio environment (image-based light), emissive, exposure,
 *    AgX / ACES tone mapping and display-space fog.
 */
export const lighting3dWgsl = `
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

struct GPULight {
    posType        : vec4<f32>, // xyz = position, w = type (0=ambient, 1=directional, 2=point, 3=spot)
    dirRadius      : vec4<f32>, // xyz = normalized direction, w = radius / range
    colorIntensity : vec4<f32>, // rgb = sRGB color, w = intensity
    spotParams     : vec4<f32>, // x = cos(outer), y = cos(inner), z = decay, w = unused
};

struct DirectLight {
    posType : vec4<f32>,
    dirRadius : vec4<f32>,
    colorIntensity : vec4<f32>,
    spotParams : vec4<f32>,
    shadowMatrix : mat4x4<f32>,
    shadowParams : vec4<f32>,
    shadowBias : vec4<f32>,
    rectRight : vec4<f32>,
    rectUp : vec4<f32>,
};

struct LightsUniforms {
    ambientColor  : vec4<f32>, // rgb = ambient color * intensity (sRGB), w = unused
    params        : vec4<f32>, // x = numLights, y = hasLights, z = physical (1), w = tone mapping (0 none, 1 ACES, 2 AgX, 3 PBR Neutral)
    lights        : array<GPULight, 8>,
    // Appended after the original layout so older readers of the prefix still line up.
    ambientLinear : vec4<f32>, // rgb = ambient irradiance (linear), w = exposure multiplier
    envTop        : vec4<f32>, // rgb = sky radiance (linear), w = environment rotation (rad)
    envHorizon    : vec4<f32>, // rgb = horizon radiance, w = softbox strength
    envBottom     : vec4<f32>, // rgb = ground radiance, w = environment enabled
    fog           : vec4<f32>, // rgb = fog color (display linear), w = enabled
    fogRange      : vec4<f32>, // x = start distance, y = full distance, z = max opacity, w = unused
    shadowParams  : vec4<f32>, // x = enabled, y = shadowed light index, z = softness (texels), w = map size
    shadowBias    : vec4<f32>, // x = depth bias, y = normal offset (world px), z = darkness 0..1, w = unused
    shadowMatrix  : mat4x4<f32>,
    floorParams   : vec4<f32>, // x = floorY, y = fadeDistance, z = isReflectionPass, w = environment intensity
    envSh         : array<vec4<f32>, 9>, // HDRI irradiance / PI as L2 SH (rgb), environment space
};

const PI = 3.14159265359;

fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((max(c, vec3<f32>(0.0)) + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
    let x = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = x * 12.92;
    let hi = 1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, x <= vec3<f32>(0.0031308));
}

// ── Tone mapping (linear scene → linear display, 0..1) ─────────────────

fn rrtAndOdtFit(v: vec3<f32>) -> vec3<f32> {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

// Stephen Hill's fitted ACES (RRT + sRGB ODT).
fn toneMapAces(c: vec3<f32>) -> vec3<f32> {
    let x = c / 0.6;
    var v = vec3<f32>(
        dot(vec3<f32>(0.59719, 0.35458, 0.04823), x),
        dot(vec3<f32>(0.07600, 0.90834, 0.01566), x),
        dot(vec3<f32>(0.02840, 0.13383, 0.83777), x),
    );
    v = rrtAndOdtFit(v);
    v = vec3<f32>(
        dot(vec3<f32>(1.60475, -0.53108, -0.07367), v),
        dot(vec3<f32>(-0.10208, 1.10813, -0.00605), v),
        dot(vec3<f32>(-0.00327, -0.07276, 1.07602), v),
    );
    return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn agxContrast(x: vec3<f32>) -> vec3<f32> {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x
        + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// AgX (Troy Sobotka), base look: graceful highlight roll-off that keeps
// saturated emissives from clipping to flat primaries.
fn toneMapAgx(c: vec3<f32>) -> vec3<f32> {
    let inset = mat3x3<f32>(
        0.842479062253094, 0.0423282422610123, 0.0423756549057051,
        0.0784335999999992, 0.878468636469772, 0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104,
    );
    let outset = mat3x3<f32>(
        1.19687900512017, -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433, 1.15107367264116,
    );
    let minEv = -12.47393;
    let maxEv = 4.026069;
    var v = inset * max(c, vec3<f32>(0.0));
    v = clamp(log2(max(v, vec3<f32>(1e-10))), vec3<f32>(minEv), vec3<f32>(maxEv));
    v = (v - minEv) / (maxEv - minEv);
    v = agxContrast(v);
    v = outset * v;
    return clamp(pow(max(v, vec3<f32>(0.0)), vec3<f32>(2.2)), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Khronos PBR Neutral: base colors come out as authored (hue and
// saturation kept) up to near-white; only highlights are compressed.
fn toneMapNeutral(cIn: vec3<f32>) -> vec3<f32> {
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    var c = max(cIn, vec3<f32>(0.0));
    let x = min(c.r, min(c.g, c.b));
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    c = c - offset;
    let peak = max(c.r, max(c.g, c.b));
    if (peak < startCompression) {
        return c;
    }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    c = c * (newPeak / peak);
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3<f32>(newPeak), g);
}

fn toneMap(c: vec3<f32>) -> vec3<f32> {
    let exposed = c * lights.ambientLinear.w;
    let mode = lights.params.w;
    if (mode > 2.5) {
        return toneMapNeutral(exposed);
    }
    if (mode > 1.5) {
        return toneMapAgx(exposed);
    }
    if (mode > 0.5) {
        return toneMapAces(exposed);
    }
    return clamp(exposed, vec3<f32>(0.0), vec3<f32>(1.0));
}

// ── Procedural studio environment (image-based light) ─────────────────

// A rectangular-ish softbox seen from the scene: bright inside its angular
// radius, blurring out with roughness while keeping roughly the same energy.
fn softbox(d: vec3<f32>, axis: vec3<f32>, radius: f32, rough: f32) -> f32 {
    let cosA = dot(d, axis);
    let edge = cos(radius + rough * 0.9);
    let width = 0.004 + rough * rough * 0.5;
    let lobe = smoothstep(edge - width, edge + width * 0.25, cosA);
    return lobe / (1.0 + rough * rough * 6.0);
}

/// Radiance arriving from direction d (world space; y points down), as a
/// surface of the given roughness sees it.
fn envRadiance(dirIn: vec3<f32>, rough: f32) -> vec3<f32> {
    if (lights.envBottom.w < 0.5) {
        return vec3<f32>(0.0);
    }
    let rot = lights.envTop.w;
    let c = cos(rot);
    let s = sin(rot);
    let d = normalize(vec3<f32>(c * dirIn.x + s * dirIn.z, dirIn.y, -s * dirIn.x + c * dirIn.z));
    let up = -d.y;
    if (lights.envBottom.w >= 1.5) {
        // GGX-prefiltered cubemap: mip = perceptual roughness * max mip.
        let maxMip = max(0.0, lights.envBottom.w - 2.0);
        let mip = clamp(rough, 0.0, 1.0) * maxMip;
        return textureSampleLevel(envMap, envSampler, d, mip).rgb * max(0.0, lights.floorParams.w);
    }
    let spread = 0.35 + rough * 0.9;
    let tUp = smoothstep(-0.05, spread, up);
    let tDown = smoothstep(-0.05, spread, -up);
    var col = mix(lights.envHorizon.rgb, lights.envTop.rgb, tUp);
    col = mix(col, lights.envBottom.rgb, tDown);
    let k = lights.envHorizon.w;
    if (k > 0.0) {
        // Key softbox overhead-front-left, a rim strip behind-right, a fill strip left.
        let key = softbox(d, normalize(vec3<f32>(-0.35, -0.85, -0.4)), 0.32, rough);
        let rim = softbox(d, normalize(vec3<f32>(0.75, -0.35, 0.55)), 0.2, rough);
        let fill = softbox(d, normalize(vec3<f32>(-0.92, -0.15, -0.2)), 0.16, rough);
        col += vec3<f32>(k * (key * 1.0 + rim * 0.7 + fill * 0.35));
    }
    return col;
}

/// Cosine-weighted mean radiance arriving around normal n (irradiance / PI):
/// what a Lambertian surface of albedo c reflects as c * envIrradiance(n).
fn envIrradiance(nIn: vec3<f32>) -> vec3<f32> {
    if (lights.envBottom.w < 1.5) {
        return envRadiance(nIn, 1.0);
    }
    let rot = lights.envTop.w;
    let c = cos(rot);
    let s = sin(rot);
    let n = normalize(vec3<f32>(c * nIn.x + s * nIn.z, nIn.y, -s * nIn.x + c * nIn.z));
    var e = lights.envSh[0].rgb * 0.282095;
    e += lights.envSh[1].rgb * (0.488603 * n.y);
    e += lights.envSh[2].rgb * (0.488603 * n.z);
    e += lights.envSh[3].rgb * (0.488603 * n.x);
    e += lights.envSh[4].rgb * (1.092548 * n.x * n.y);
    e += lights.envSh[5].rgb * (1.092548 * n.y * n.z);
    e += lights.envSh[6].rgb * (0.315392 * (3.0 * n.z * n.z - 1.0));
    e += lights.envSh[7].rgb * (1.092548 * n.x * n.z);
    e += lights.envSh[8].rgb * (0.546274 * (n.x * n.x - n.y * n.y));
    return max(e, vec3<f32>(0.0)) * max(0.0, lights.floorParams.w);
}

// Karis' analytic approximation of the split-sum environment BRDF.
fn envBrdfApprox(f0: vec3<f32>, rough: f32, nDotV: f32) -> vec3<f32> {
    let c0 = vec4<f32>(-1.0, -0.0275, -0.572, 0.022);
    let c1 = vec4<f32>(1.0, 0.0425, 1.04, -0.04);
    let r = rough * c0 + c1;
    let a004 = min(r.x * r.x, exp2(-9.28 * nDotV)) * r.x + r.y;
    let ab = vec2<f32>(-1.04, 1.04) * a004 + r.zw;
    return f0 * ab.x + ab.y;
}

// ── Shadows ───────────────────────────────────────────────────────────

var<private> POISSON : array<vec2<f32>, 12> = array<vec2<f32>, 12>(
    vec2<f32>(-0.326, -0.406), vec2<f32>(-0.840, -0.074), vec2<f32>(-0.696, 0.457),
    vec2<f32>(-0.203, 0.621), vec2<f32>(0.962, -0.195), vec2<f32>(0.473, -0.480),
    vec2<f32>(0.519, 0.767), vec2<f32>(0.185, -0.893), vec2<f32>(0.507, 0.064),
    vec2<f32>(0.896, 0.412), vec2<f32>(-0.322, -0.933), vec2<f32>(-0.792, -0.598),
);

struct PointCubeProj {
    uv : vec2<f32>,
    ndcZ : f32,
    face : i32,
    valid : bool,
};

fn projectPointCubeShadow(d: vec3<f32>, near: f32, far: f32) -> PointCubeProj {
    var out = PointCubeProj(vec2<f32>(0.5), 0.0, 0, false);
    let ax = abs(d.x);
    let ay = abs(d.y);
    let az = abs(d.z);
    var xEye = 0.0;
    var yEye = 0.0;
    var zEye = 0.0;
    if (ax >= ay && ax >= az) {
        if (d.x >= 0.0) {
            out.face = 0;
            xEye = -d.z;
            yEye = -d.y;
            zEye = d.x;
        } else {
            out.face = 1;
            xEye = d.z;
            yEye = -d.y;
            zEye = -d.x;
        }
    } else if (ay >= ax && ay >= az) {
        if (d.y >= 0.0) {
            out.face = 2;
            xEye = d.x;
            yEye = d.z;
            zEye = d.y;
        } else {
            out.face = 3;
            xEye = d.x;
            yEye = -d.z;
            zEye = -d.y;
        }
    } else {
        if (d.z >= 0.0) {
            out.face = 4;
            xEye = d.x;
            yEye = -d.y;
            zEye = d.z;
        } else {
            out.face = 5;
            xEye = -d.x;
            yEye = -d.y;
            zEye = -d.z;
        }
    }
    if (zEye <= near || zEye >= far) {
        return out;
    }
    let ndcX = xEye / zEye;
    let ndcY = yEye / zEye;
    out.uv = vec2<f32>(ndcX * 0.5 + 0.5, 0.5 - ndcY * 0.5);
    out.ndcZ = (far - (near * far) / zEye) / max(far - near, 1e-4);
    out.valid = true;
    return out;
}

/// 1 = fully lit, 0 = fully shadowed, for light index i.
fn shadowFactor(worldPos: vec3<f32>, N: vec3<f32>, i: i32) -> f32 {
    let shadow = directLights[i];
    if (shadow.shadowParams.w < 0.5) {
        return 1.0;
    }
    let p = worldPos + N * shadow.shadowBias.y;
    let texel = 1.0 / max(shadow.shadowParams.y, 1.0);
    let radius = shadow.shadowParams.x * texel;
    let baseLayer = i32(shadow.shadowParams.z);

    if (shadow.shadowParams.w > 1.5) {
        let near = max(0.5, shadow.shadowBias.w);
        let far = max(near + 1.0, shadow.shadowMatrix[0][0]);
        let cp = projectPointCubeShadow(p - shadow.posType.xyz, near, far);
        if (!cp.valid) {
            return 1.0;
        }
        let depthRef = cp.ndcZ - shadow.shadowBias.x;
        let layer = baseLayer + cp.face;
        var lit = 0.0;
        for (var k = 0; k < 12; k++) {
            let sampleUv = clamp(cp.uv + POISSON[k] * radius, vec2<f32>(texel), vec2<f32>(1.0 - texel));
            lit += textureSampleCompareLevel(shadowMap, shadowSampler, sampleUv, layer, depthRef);
        }
        lit = lit / 12.0;
        return mix(1.0, lit, shadow.shadowBias.z);
    }

    let lp = shadow.shadowMatrix * vec4<f32>(p, 1.0);
    let ndc = lp.xyz / lp.w;
    let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (lp.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) {
        return 1.0;
    }
    let depthRef = ndc.z - shadow.shadowBias.x;
    var lit = 0.0;
    for (var k = 0; k < 12; k++) {
        lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + POISSON[k] * radius, baseLayer, depthRef);
    }
    lit = lit / 12.0;
    return mix(1.0, lit, shadow.shadowBias.z);
}

/// Hardware-comparison shadow lookup with 4-tap soft penumbra for volumetric raymarching.
fn volumetricShadowFactor(worldPos: vec3<f32>, i: i32) -> f32 {
    let shadow = directLights[i];
    if (shadow.shadowParams.w < 0.5) {
        return 1.0;
    }
    let texel = 1.0 / max(shadow.shadowParams.y, 1.0);
    let radius = shadow.shadowParams.x * texel * 0.85;
    let baseLayer = i32(shadow.shadowParams.z);
    if (shadow.shadowParams.w > 1.5) {
        let near = max(0.5, shadow.shadowBias.w);
        let far = max(near + 1.0, shadow.shadowMatrix[0][0]);
        let cp = projectPointCubeShadow(worldPos - shadow.posType.xyz, near, far);
        if (!cp.valid) {
            return 1.0;
        }
        let lit = textureSampleCompareLevel(shadowMap, shadowSampler, cp.uv, baseLayer + cp.face, cp.ndcZ - shadow.shadowBias.x);
        return mix(1.0, lit, shadow.shadowBias.z);
    }
    let lp = shadow.shadowMatrix * vec4<f32>(worldPos, 1.0);
    let ndc = lp.xyz / lp.w;
    let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (lp.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) {
        return 1.0;
    }
    let depthRef = ndc.z - shadow.shadowBias.x;
    var lit = 0.0;
    lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + POISSON[0] * radius, baseLayer, depthRef);
    lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + POISSON[3] * radius, baseLayer, depthRef);
    lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + POISSON[5] * radius, baseLayer, depthRef);
    lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + POISSON[8] * radius, baseLayer, depthRef);
    return mix(1.0, lit * 0.25, shadow.shadowBias.z);
}

// ── Lights ────────────────────────────────────────────────────────────

struct LightSample {
    L : vec3<f32>,
    attenuation : f32,
    valid : bool,
};

fn sampleLight(i: i32, worldPos: vec3<f32>) -> LightSample {
    var out = LightSample(vec3<f32>(0.0, 0.0, 1.0), 1.0, false);
    let light = directLights[i];
    let lightType = light.posType.w;
    if (lightType > 0.5 && lightType < 1.5) {
        out.L = normalize(-light.dirRadius.xyz);
        out.valid = true;
        return out;
    }
    if (lightType < 1.5) {
        return out;
    }
    if (lightType > 3.5) {
        // Rect area light (lightType == 4.0)
        let lightPos = light.posType.xyz;
        let lightForward = normalize(light.dirRadius.xyz);
        let right = light.rectRight.xyz;
        let halfW = max(0.5, light.rectRight.w);
        let up = light.rectUp.xyz;
        let halfH = max(0.5, light.rectUp.w);
        let twoSided = light.spotParams.w > 0.5;
        let rel = worldPos - lightPos;
        let frontDist = dot(rel, lightForward);
        if (!twoSided && frontDist <= 0.0) {
            return out;
        }
        let uCoord = clamp(dot(rel, right), -halfW, halfW);
        let vCoord = clamp(dot(rel, up), -halfH, halfH);
        let nearestPt = lightPos + right * uCoord + up * vCoord;
        let toLight = nearestPt - worldPos;
        let dist = length(toLight);
        let radius = max(1.0, light.dirRadius.w);
        if (dist > radius) {
            return out;
        }
        out.L = select(normalize(-lightForward), toLight / dist, dist > 1e-4);
        let emitCos = select(max(0.0, dot(-out.L, lightForward)), abs(dot(-out.L, lightForward)), twoSided);
        if (emitCos <= 0.0) {
            return out;
        }
        let dNorm = clamp(dist / radius, 0.0, 1.0);
        let decay = max(0.5, light.spotParams.z);
        let area = 4.0 * halfW * halfH;
        let areaFactor = clamp(area / (area + PI * dist * dist), 0.12, 1.0);
        out.attenuation = pow(clamp(1.0 - dNorm, 0.0, 1.0), decay) * emitCos * (0.45 + 0.55 * areaFactor);
        out.valid = true;
        return out;
    }
    let toLight = light.posType.xyz - worldPos;
    let dist = length(toLight);
    let radius = max(1.0, light.dirRadius.w);
    if (dist > radius) {
        return out;
    }
    out.L = normalize(toLight);
    let dNorm = clamp(dist / radius, 0.0, 1.0);
    let decay = max(0.5, light.spotParams.z);
    out.attenuation = pow(clamp(1.0 - dNorm, 0.0, 1.0), decay);
    if (lightType > 2.5) {
        let spotDir = normalize(light.dirRadius.xyz);
        let cosAngle = dot(-out.L, spotDir);
        if (cosAngle < light.spotParams.x) {
            return out;
        }
        out.attenuation *= smoothstep(light.spotParams.x, light.spotParams.y, cosAngle);
    }
    out.valid = true;
    return out;
}

// Representative point on a rectangular area light along reflection vector R.
fn rectRepresentativeDirection(light: DirectLight, worldPos: vec3<f32>, R: vec3<f32>, fallbackL: vec3<f32>) -> vec3<f32> {
    let lightPos = light.posType.xyz;
    let lightForward = normalize(light.dirRadius.xyz);
    let right = light.rectRight.xyz;
    let halfW = max(0.5, light.rectRight.w);
    let up = light.rectUp.xyz;
    let halfH = max(0.5, light.rectUp.w);
    let denom = dot(R, lightForward);
    let centerDist = length(lightPos - worldPos);
    var tRay = centerDist;
    if (abs(denom) > 1e-3) {
        let tHit = dot(lightPos - worldPos, lightForward) / denom;
        if (tHit > 0.0) {
            tRay = tHit;
        }
    }
    let planeHit = worldPos + R * tRay - lightPos;
    let uSpec = clamp(dot(planeHit, right), -halfW, halfW);
    let vSpec = clamp(dot(planeHit, up), -halfH, halfH);
    let specPt = lightPos + right * uSpec + up * vSpec;
    let toSpec = specPt - worldPos;
    let len = length(toSpec);
    return select(fallbackL, toSpec / len, len > 1e-4);
}

// Blinn-Phong in display space: the original look, plus shadows when a
// light casts them.
fn applyLighting3D(worldPos: vec3<f32>, worldNormal: vec3<f32>, baseColor: vec3<f32>, material: vec4<f32>) -> vec3<f32> {
    if (lights.params.y < 0.5 || material.w < 0.5) {
        return baseColor;
    }
    var N = normalize(worldNormal);
    let V = normalize(cam.cameraPos.xyz - worldPos);
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    let R = reflect(-V, N);
    let shininess = max(1.0, material.x);
    let specularInt = material.y;
    let ambientInt = material.z;

    var totalIllumination = baseColor * (lights.ambientColor.rgb * ambientInt);
    let numLights = i32(lights.params.x);
    for (var i = 0; i < numLights; i++) {
        let ls = sampleLight(i, worldPos);
        if (!ls.valid) {
            continue;
        }
        let light = directLights[i];
        let lightColor = light.colorIntensity.rgb;
        let intensity = light.colorIntensity.w;
        let NdotL = max(dot(N, ls.L), 0.0);
        let diffuse = baseColor * lightColor * (NdotL * intensity * ls.attenuation);
        var specular = vec3<f32>(0.0);
        if (NdotL > 0.0 && specularInt > 0.001) {
            let specL = select(ls.L, rectRepresentativeDirection(light, worldPos, R, ls.L), light.posType.w > 3.5);
            let H = normalize(specL + V);
            let NdotH = max(dot(N, H), 0.0);
            specular = lightColor * (pow(NdotH, shininess) * specularInt * intensity * ls.attenuation);
        }
        totalIllumination += (diffuse + specular) * shadowFactor(worldPos, N, i);
    }
    return totalIllumination;
}

struct SubstrateParams {
    clearcoat   : vec4<f32>, // x = clearcoat (0..1), y = clearcoatRoughness (0.03..1), z = anisotropy (-1..1), w = anisotropyRotation (rad)
    subsurface  : vec4<f32>, // x = subsurface (0..1), yzw = subsurfaceColor (sRGB)
    sheen       : vec4<f32>, // x = sheen (0..1), yzw = sheenColor (sRGB)
    iridescence : vec4<f32>, // x = intensity (0..1), y = thickness nm (100..1200), z = film ior (1.3), w = triplanarUvFreq
};

fn defaultSubstrate() -> SubstrateParams {
    return SubstrateParams(
        vec4<f32>(0.0, 0.08, 0.0, 0.0),
        vec4<f32>(0.0, 1.0, 0.42, 0.29),
        vec4<f32>(0.0, 1.0, 1.0, 1.0),
        vec4<f32>(0.0, 400.0, 1.3, 0.0),
    );
}

// Airy / Belcour thin-film spectral interference at RGB primary wavelengths (650, 510, 475 nm).
fn evalIridescence(cosTheta1: f32, thicknessNm: f32, filmIor: f32, baseF0: vec3<f32>) -> vec3<f32> {
    let n2 = max(1.05, filmIor);
    let sin2Theta2 = (1.0 - cosTheta1 * cosTheta1) / (n2 * n2);
    let cosTheta2 = sqrt(max(0.0, 1.0 - sin2Theta2));
    let opd = 2.0 * n2 * thicknessNm * cosTheta2;
    let lambdas = vec3<f32>(650.0, 510.0, 475.0);
    let phi = (2.0 * PI * opd) / lambdas + vec3<f32>(PI);
    let f0_12 = pow((n2 - 1.0) / (n2 + 1.0), 2.0);
    let r12 = vec3<f32>(f0_12 + (1.0 - f0_12) * pow(clamp(1.0 - cosTheta1, 0.0, 1.0), 5.0));
    let r23 = baseF0 + (vec3<f32>(1.0) - baseF0) * pow(clamp(1.0 - cosTheta2, 0.0, 1.0), 5.0);
    let interf = r12 + r23 + 2.0 * sqrt(max(r12 * r23, vec3<f32>(0.0))) * cos(phi);
    return clamp(interf, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Multi-lobe Substrate PBR: GGX (isotropic or anisotropic) + Thin-Film Iridescence +
// Subsurface wrap/transmission + Charlie Cloth Sheen + Clearcoat secondary lobe + IBL.
fn shadePhysicalSubstrate(
    worldPos: vec3<f32>,
    worldNormal: vec3<f32>,
    albedo: vec3<f32>,
    rough: f32,
    metal: f32,
    ambientInt: f32,
    sheenRoughness: f32,
    substrate: SubstrateParams,
) -> vec3<f32> {
    var N = normalize(worldNormal);
    let V = normalize(cam.cameraPos.xyz - worldPos);
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    let R = reflect(-V, N);
    let nDotV = max(dot(N, V), 1e-4);
    let r = clamp(rough, 0.03, 1.0);
    let a = r * r;
    let a2 = a * a;
    let f0 = mix(vec3<f32>(0.04), albedo, metal);
    let diffuseColor = albedo * (1.0 - metal);

    let cc = clamp(substrate.clearcoat.x, 0.0, 1.0);
    let ccRough = clamp(substrate.clearcoat.y, 0.03, 1.0);
    let ccA = ccRough * ccRough;
    let ccA2 = ccA * ccA;
    let aniso = clamp(substrate.clearcoat.z, -0.95, 0.95);
    let hasAniso = abs(aniso) > 1e-3;
    let rot = substrate.clearcoat.w;
    let upRef = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(N.y) > 0.99);
    let T0 = normalize(cross(upRef, N));
    let B0 = cross(N, T0);
    let cRot = cos(rot);
    let sRot = sin(rot);
    let T = T0 * cRot + B0 * sRot;
    let B = -T0 * sRot + B0 * cRot;
    let at = max(0.001, a * (1.0 + aniso));
    let ab = max(0.001, a * (1.0 - aniso));

    let sssWeight = clamp(substrate.subsurface.x, 0.0, 1.0);
    let sssColor = srgbToLinear(substrate.subsurface.yzw);
    let sheenWeight = clamp(substrate.sheen.x, 0.0, 1.0);
    let sheenColor = srgbToLinear(substrate.sheen.yzw) * sheenWeight;
    let sheenAlpha = max(0.07, sheenRoughness * sheenRoughness);
    let iridWeight = clamp(substrate.iridescence.x, 0.0, 1.0);
    let iridThickness = max(100.0, substrate.iridescence.y);
    let iridIor = max(1.05, substrate.iridescence.z);

    var lo = vec3<f32>(0.0);
    let numLights = i32(lights.params.x);
    for (var i = 0; i < numLights; i++) {
        let ls = sampleLight(i, worldPos);
        if (!ls.valid) {
            continue;
        }
        let rawNdotL = dot(N, ls.L);
        let nDotL = max(rawNdotL, 0.0);
        if (nDotL <= 0.0 && sssWeight <= 0.001) {
            continue;
        }
        let light = directLights[i];
        let isRect = light.posType.w > 3.5;
        let specL = select(ls.L, rectRepresentativeDirection(light, worldPos, R, ls.L), isRect);
        let nDotLSpec = max(dot(N, specL), 1e-4);
        let H = normalize(specL + V);
        let nDotH = max(dot(N, H), 0.0);
        let vDotH = max(dot(V, H), 0.0);

        var D = 0.0;
        var Vis = 0.0;
        if (hasAniso) {
            let tDotH = dot(T, H);
            let bDotH = dot(B, H);
            let atb = at * ab;
            let vAniso = vec3<f32>(ab * tDotH, at * bDotH, atb * nDotH);
            let v2 = dot(vAniso, vAniso);
            let w2 = atb / max(v2, 1e-6);
            D = atb * w2 * w2 * (1.0 / PI);
            let tDotV = dot(T, V);
            let bDotV = dot(B, V);
            let tDotL = dot(T, specL);
            let bDotL = dot(B, specL);
            let lambdaV = nDotLSpec * length(vec3<f32>(at * tDotV, ab * bDotV, nDotV));
            let lambdaL = nDotV * length(vec3<f32>(at * tDotL, ab * bDotL, nDotLSpec));
            Vis = 0.5 / max(lambdaV + lambdaL, 1e-5);
        } else {
            var a2Spec = a2;
            var energyNorm = 1.0;
            if (isRect) {
                let rectSpan = sqrt(max(1.0, light.rectRight.w * light.rectUp.w));
                let centerDist = max(50.0, length(light.posType.xyz - worldPos));
                let aRect = clamp(a + 0.35 * (rectSpan / centerDist), 0.03, 1.0);
                a2Spec = aRect * aRect;
                energyNorm = clamp((a * a) / max(a2Spec, 1e-4), 0.15, 1.0);
            }
            let dDen = nDotH * nDotH * (a2Spec - 1.0) + 1.0;
            D = (a2Spec * energyNorm) / (PI * dDen * dDen);
            let gv = nDotLSpec * sqrt(nDotV * nDotV * (1.0 - a2) + a2);
            let gl = nDotV * sqrt(nDotLSpec * nDotLSpec * (1.0 - a2) + a2);
            Vis = 0.5 / max(gv + gl, 1e-5);
        }

        var F = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vDotH, 5.0);
        if (iridWeight > 0.001) {
            let fIrid = evalIridescence(vDotH, iridThickness, iridIor, f0);
            F = mix(F, fIrid, iridWeight);
        }

        let spec = select(vec3<f32>(0.0), D * Vis * F, nDotL > 0.0);
        let diff = (vec3<f32>(1.0) - F) * diffuseColor / PI;

        var directLobe = diff * nDotL + spec * select(0.0, nDotLSpec, nDotL > 0.0);

        // Subsurface wrap diffuse + terminator bleed + translucent back-scattering
        if (sssWeight > 0.001) {
            let wrap = 0.45 * sssWeight;
            let wrapNdotL = max(0.0, (rawNdotL + wrap) / ((1.0 + wrap) * (1.0 + wrap)));
            let terminator = smoothstep(0.0, wrap + 0.3, max(0.0, rawNdotL + wrap)) * (1.0 - nDotL);
            let wrapDiff = diffuseColor * wrapNdotL + sssColor * (diffuseColor * 0.6 + vec3<f32>(0.4)) * terminator * sssWeight * 0.55;
            let backL = normalize(ls.L + N * 0.35);
            // Light crossing a convex body travels far through its middle and
            // briefly near its silhouette: how closely the exit normal follows
            // the light's travel direction stands in for that chord length, so
            // back-lit solids glow at the rim and stay dense at the core.
            let chord = clamp(dot(N, -ls.L), 0.0, 1.0);
            let transmittance = exp(-chord * mix(6.0, 1.5, sssWeight));
            let backTrans = pow(clamp(dot(V, -backL), 0.0, 1.0), 3.0) * transmittance * sssWeight * 0.65;
            let sssContrib = (wrapDiff + sssColor * backTrans) / PI;
            directLobe = mix(diff * nDotL, sssContrib, sssWeight) + spec * select(0.0, nDotLSpec, nDotL > 0.0);
        }

        // Charlie cloth / velvet sheen lobe (Estevez & Kulla)
        if (sheenWeight > 0.001 && nDotL > 0.0) {
            let invR = 1.0 / sheenAlpha;
            let sin2h = max(1.0 - nDotH * nDotH, 1e-4);
            let dCharlie = (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
            let vCharlie = 1.0 / max(4.0 * (nDotL + nDotV - nDotL * nDotV), 1e-4);
            directLobe += sheenColor * dCharlie * vCharlie * nDotL;
        }

        // Clearcoat secondary dielectric varnish lobe (IOR 1.5 -> F0 = 0.04)
        if (cc > 0.001 && nDotL > 0.0) {
            let Fc = 0.04 + 0.96 * pow(1.0 - vDotH, 5.0);
            let ccDen = nDotH * nDotH * (ccA2 - 1.0) + 1.0;
            let Dc = ccA2 / (PI * ccDen * ccDen);
            let VisC = 0.25 / max(vDotH * vDotH, 1e-4);
            let clearcoatSpec = Dc * VisC * Fc * nDotLSpec;
            directLobe = directLobe * (1.0 - cc * Fc) + vec3<f32>(cc * clearcoatSpec);
        }

        let radiance = srgbToLinear(light.colorIntensity.rgb) * light.colorIntensity.w * ls.attenuation * PI;
        let shadow = select(1.0, shadowFactor(worldPos, N, i), nDotL > 0.0);
        lo += directLobe * radiance * shadow;
    }

    var R_ibl = R;
    if (hasAniso) {
        let anisoDir = select(B, T, aniso < 0.0);
        let anisoTangent = cross(anisoDir, V);
        let anisoNormal = cross(anisoTangent, anisoDir);
        let bentN = normalize(mix(N, normalize(anisoNormal), abs(aniso) * 0.6));
        R_ibl = reflect(-V, bentN);
    }

    var f0_ibl = f0;
    if (iridWeight > 0.001) {
        let fIridView = evalIridescence(nDotV, iridThickness, iridIor, f0);
        f0_ibl = mix(f0, fIridView, iridWeight);
    }

    let irradiance = envIrradiance(N) + lights.ambientLinear.rgb;
    var diffAmbient = diffuseColor * irradiance;
    if (sssWeight > 0.001) {
        let backIrradiance = envIrradiance(-N) * 0.35 + irradiance * 0.25;
        diffAmbient += sssColor * (diffuseColor * 0.5 + vec3<f32>(0.5)) * backIrradiance * sssWeight * 0.45;
    }
    let specEnv = envRadiance(R_ibl, r) * envBrdfApprox(f0_ibl, r, nDotV);
    var iblTotal = diffAmbient + specEnv;

    if (sheenWeight > 0.001) {
        // The Charlie lobe is broad and peaks at grazing angles rather than
        // around the mirror direction, so cloth gathers the environment's
        // irradiance, weighted by the lobe's grazing-heavy directional albedo.
        let sheenAlbedo = pow(1.0 - nDotV, 3.0) * 0.4 + 0.1 * (1.0 - sheenRoughness * 0.5);
        iblTotal += sheenColor * irradiance * sheenAlbedo;
    }

    if (cc > 0.001) {
        let Fc_ibl = 0.04 + 0.96 * pow(1.0 - nDotV, 5.0);
        let ccEnv = envRadiance(R, ccRough) * Fc_ibl * cc;
        iblTotal = iblTotal * (1.0 - cc * Fc_ibl) + ccEnv;
    }

    lo += iblTotal * ambientInt;
    return lo;
}

fn shadePhysical(worldPos: vec3<f32>, worldNormal: vec3<f32>, albedo: vec3<f32>, rough: f32, metal: f32, ambientInt: f32) -> vec3<f32> {
    return shadePhysicalSubstrate(worldPos, worldNormal, albedo, rough, metal, ambientInt, 0.5, defaultSubstrate());
}

struct Shaded {
    /** Display-encoded (sRGB) color for the color target. */
    display : vec3<f32>,
    /** Unclamped scene-referred linear radiance, for the bloom target. */
    hdr : vec3<f32>,
};

// Two-sided, art-directed diffuse lighting. Shares the full direct-light
// storage, range/spot attenuation and PCF shadows with the physical renderer.
fn shadeToon(worldPos: vec3<f32>, worldNormal: vec3<f32>, base: vec3<f32>, ambient: f32, shade: vec4<f32>, lightTint: vec4<f32>, params: vec4<f32>) -> vec3<f32> {
    if (lights.params.y < 0.5) { return base; }
    var N = normalize(worldNormal);
    let V = normalize(cam.cameraPos.xyz - worldPos);
    if (dot(N, V) < 0.0) { N = -N; }
    var illumination = lights.ambientColor.rgb * ambient * lightTint.rgb;
    var visibility = clamp(max(illumination.r, max(illumination.g, illumination.b)), 0.0, 1.0);
    for (var i = 0; i < i32(lights.params.x); i++) {
        let ls = sampleLight(i, worldPos);
        if (!ls.valid) { continue; }
        let cosine = dot(N, ls.L);
        let softness = max(params.x, 0.0001);
        let band = smoothstep(lightTint.w - softness * 0.5, lightTint.w + softness * 0.5, cosine);
        let light = directLights[i];
        let strength = band * ls.attenuation * light.colorIntensity.w * shadowFactor(worldPos, N, i);
        let contribution = light.colorIntensity.rgb * lightTint.rgb * strength * mix(1.0, max(cosine, 0.0), shade.w);
        // Remove the shadow floor only as actual modeled light arrives.
        // Using the pre-diffuse band here creates a dark ring between the
        // shadow floor and the lit region, which slides as a surface turns.
        let energy = max(contribution.r, max(contribution.g, contribution.b));
        visibility = max(visibility, clamp(energy, 0.0, 1.0));
        illumination += contribution;
    }
    return base * (shade.rgb * (1.0 - visibility) + illumination);
}

// The existing linear-depth attachment doubles as a geometry buffer:
// r = optical depth, gb = octahedral world normal, a = outline participation.
// Geometric normals deliberately ignore normal maps and texture seams.
fn geometryPixel(depth: f32, normal: vec3<f32>, outlined: f32) -> vec4<f32> {
    let n = normalize(normal);
    let p = n.xy / max(abs(n.x) + abs(n.y) + abs(n.z), 1e-6);
    let signs = select(vec2<f32>(-1.0), vec2<f32>(1.0), p >= vec2<f32>(0.0));
    let oct = select((1.0 - abs(p.yx)) * signs, p, n.z >= 0.0);
    return vec4<f32>(depth, oct * 0.5 + 0.5, outlined);
}

fn hasActiveSubstrate(s: SubstrateParams) -> bool {
    return s.clearcoat.x > 0.001 || abs(s.clearcoat.z) > 0.001 || s.subsurface.x > 0.001 || s.sheen.x > 0.001 || s.iridescence.x > 0.001;
}

/// Shades a surface with full Substrate multi-lobe material support.
fn shadeSurfaceSubstrate(
    worldPos: vec3<f32>,
    worldNormal: vec3<f32>,
    baseColor: vec3<f32>,
    material: vec4<f32>,
    pbr: vec4<f32>,
    emissive: vec4<f32>,
    toonShadow: vec4<f32>,
    toonLight: vec4<f32>,
    toonParams: vec4<f32>,
    substrate: SubstrateParams,
) -> Shaded {
    var out: Shaded;
    let usePhysical = lights.params.z >= 0.5 || (material.w >= 0.5 && material.w <= 1.5 && hasActiveSubstrate(substrate));
    if (!usePhysical) {
        var c = baseColor;
        if (material.w > 1.5) {
            c = shadeToon(worldPos, worldNormal, baseColor, material.z, toonShadow, toonLight, toonParams);
        } else if (material.w >= 0.5) {
            c = applyLighting3D(worldPos, worldNormal, baseColor, material);
        }
        c += emissive.rgb * emissive.w;
        out.display = c;
        out.hdr = srgbToLinear(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0))) * max(max(c.r, max(c.g, c.b)), 1.0);
        return out;
    }
    var radiance: vec3<f32>;
    if (material.w < 0.5) {
        radiance = srgbToLinear(baseColor);
    } else if (material.w > 1.5) {
        radiance = srgbToLinear(shadeToon(worldPos, worldNormal, baseColor, material.z, toonShadow, toonLight, toonParams));
    } else {
        let rough = select(pbr.x, 0.5, pbr.x < 0.0);
        let sheenRough = select(0.5, toonParams.z, toonParams.z > 0.01);
        radiance = shadePhysicalSubstrate(worldPos, worldNormal, srgbToLinear(baseColor), rough, clamp(pbr.y, 0.0, 1.0), material.z, sheenRough, substrate);
    }
    radiance += srgbToLinear(emissive.rgb) * emissive.w;
    var display: vec3<f32>;
    if (material.w < 0.5) {
        // Unlit layers keep their exact authored colors.
        display = clamp(radiance, vec3<f32>(0.0), vec3<f32>(1.0));
    } else if (lights.params.z >= 0.5) {
        display = toneMap(radiance);
    } else {
        display = toneMapNeutral(radiance);
    }
    var hdr = radiance * max(lights.ambientLinear.w, 1.0);
    if (lights.fog.w > 0.5) {
        let dist = distance(worldPos, cam.cameraPos.xyz);
        let f = smoothstep(lights.fogRange.x, max(lights.fogRange.y, lights.fogRange.x + 1.0), dist) * lights.fogRange.z;
        display = mix(display, lights.fog.rgb, f);
        hdr = hdr * (1.0 - f);
    }
    if (lights.floorParams.z > 0.5) {
        if (worldPos.y > lights.floorParams.x + 0.1) {
            discard;
        }
        if (lights.floorParams.y > 0.0) {
            let deltaY = max(0.0, lights.floorParams.x - worldPos.y);
            let fade = exp(-deltaY / lights.floorParams.y);
            display = display * fade;
            hdr = hdr * fade;
        }
    }
    out.display = linearToSrgb(display);
    out.hdr = hdr;
    return out;
}

/// Shades a surface for the scene's mode.
fn shadeSurfaceFull(worldPos: vec3<f32>, worldNormal: vec3<f32>, baseColor: vec3<f32>, material: vec4<f32>, pbr: vec4<f32>, emissive: vec4<f32>, toonShadow: vec4<f32>, toonLight: vec4<f32>, toonParams: vec4<f32>) -> Shaded {
    return shadeSurfaceSubstrate(worldPos, worldNormal, baseColor, material, pbr, emissive, toonShadow, toonLight, toonParams, defaultSubstrate());
}

`;

/** Group-3 bindings every lit 3D shader declares. */
export const lightsBindingsWgsl = `
@group(3) @binding(0) var<uniform> lights : LightsUniforms;
@group(3) @binding(1) var shadowMap : texture_depth_2d_array;
@group(3) @binding(2) var shadowSampler : sampler_comparison;
@group(3) @binding(3) var<storage, read> directLights : array<DirectLight>;
@group(3) @binding(4) var envMap : texture_cube<f32>;
@group(3) @binding(5) var envSampler : sampler;
`;
