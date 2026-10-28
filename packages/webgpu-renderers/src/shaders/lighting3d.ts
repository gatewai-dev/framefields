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
    floorParams   : vec4<f32>, // x = floorY, y = fadeDistance, z = isReflectionPass, w = unused
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

/// 1 = fully lit, 0 = fully shadowed, for light index i.
fn shadowFactor(worldPos: vec3<f32>, N: vec3<f32>, i: i32) -> f32 {
    if (lights.shadowParams.x < 0.5 || i32(lights.shadowParams.y) != i) {
        return 1.0;
    }
    let p = worldPos + N * lights.shadowBias.y;
    let lp = lights.shadowMatrix * vec4<f32>(p, 1.0);
    let ndc = lp.xyz / lp.w;
    let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (lp.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) {
        return 1.0;
    }
    let texel = 1.0 / max(lights.shadowParams.w, 1.0);
    let radius = lights.shadowParams.z * texel;
    let depthRef = ndc.z - lights.shadowBias.x;
    var lit = 0.0;
    for (var k = 0; k < 12; k++) {
        lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + POISSON[k] * radius, depthRef);
    }
    lit = lit / 12.0;
    return mix(1.0, lit, lights.shadowBias.z);
}

// ── Lights ────────────────────────────────────────────────────────────

struct LightSample {
    L : vec3<f32>,
    attenuation : f32,
    valid : bool,
};

fn sampleLight(i: i32, worldPos: vec3<f32>) -> LightSample {
    var out = LightSample(vec3<f32>(0.0, 0.0, 1.0), 1.0, false);
    let light = lights.lights[i];
    let lightType = light.posType.w;
    if (lightType > 0.5 && lightType < 1.5) {
        out.L = normalize(-light.dirRadius.xyz);
        out.valid = true;
        return out;
    }
    if (lightType < 1.5) {
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
    let shininess = max(1.0, material.x);
    let specularInt = material.y;
    let ambientInt = material.z;

    var totalIllumination = baseColor * (lights.ambientColor.rgb * ambientInt);
    let numLights = i32(lights.params.x);
    for (var i = 0; i < 8; i++) {
        if (i >= numLights) {
            break;
        }
        let ls = sampleLight(i, worldPos);
        if (!ls.valid) {
            continue;
        }
        let light = lights.lights[i];
        let lightColor = light.colorIntensity.rgb;
        let intensity = light.colorIntensity.w;
        let NdotL = max(dot(N, ls.L), 0.0);
        let diffuse = baseColor * lightColor * (NdotL * intensity * ls.attenuation);
        var specular = vec3<f32>(0.0);
        if (NdotL > 0.0 && specularInt > 0.001) {
            let H = normalize(ls.L + V);
            let NdotH = max(dot(N, H), 0.0);
            specular = lightColor * (pow(NdotH, shininess) * specularInt * intensity * ls.attenuation);
        }
        totalIllumination += (diffuse + specular) * shadowFactor(worldPos, N, i);
    }
    return totalIllumination;
}

// GGX / Smith-correlated / Schlick, image-based light from envRadiance.
// Returns linear scene radiance (unbounded).
fn shadePhysical(worldPos: vec3<f32>, worldNormal: vec3<f32>, albedo: vec3<f32>, rough: f32, metal: f32, ambientInt: f32) -> vec3<f32> {
    var N = normalize(worldNormal);
    let V = normalize(cam.cameraPos.xyz - worldPos);
    if (dot(N, V) < 0.0) {
        N = -N;
    }
    let nDotV = max(dot(N, V), 1e-4);
    let r = clamp(rough, 0.03, 1.0);
    let a = r * r;
    let a2 = a * a;
    let f0 = mix(vec3<f32>(0.04), albedo, metal);
    let diffuseColor = albedo * (1.0 - metal);

    var lo = vec3<f32>(0.0);
    let numLights = i32(lights.params.x);
    for (var i = 0; i < 8; i++) {
        if (i >= numLights) {
            break;
        }
        let ls = sampleLight(i, worldPos);
        if (!ls.valid) {
            continue;
        }
        let light = lights.lights[i];
        let nDotL = max(dot(N, ls.L), 0.0);
        if (nDotL <= 0.0) {
            continue;
        }
        let H = normalize(ls.L + V);
        let nDotH = max(dot(N, H), 0.0);
        let vDotH = max(dot(V, H), 0.0);
        let dDen = nDotH * nDotH * (a2 - 1.0) + 1.0;
        let D = a2 / (PI * dDen * dDen);
        let gv = nDotL * sqrt(nDotV * nDotV * (1.0 - a2) + a2);
        let gl = nDotV * sqrt(nDotL * nDotL * (1.0 - a2) + a2);
        let Vis = 0.5 / max(gv + gl, 1e-5);
        let F = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vDotH, 5.0);
        let spec = D * Vis * F;
        let diff = (vec3<f32>(1.0) - F) * diffuseColor / PI;
        // x PI so a white light of intensity 1 lights a white wall about as
        // brightly as the legacy shading does.
        let radiance = srgbToLinear(light.colorIntensity.rgb) * light.colorIntensity.w * ls.attenuation * PI;
        lo += (diff + spec) * radiance * nDotL * shadowFactor(worldPos, N, i);
    }

    let R = reflect(-V, N);
    let irradiance = envRadiance(N, 1.0) + lights.ambientLinear.rgb;
    let specEnv = envRadiance(R, r) * envBrdfApprox(f0, r, nDotV);
    lo += (diffuseColor * irradiance + specEnv) * ambientInt;
    return lo;
}

struct Shaded {
    /** Display-encoded (sRGB) color for the color target. */
    display : vec3<f32>,
    /** Unclamped scene-referred linear radiance, for the bloom target. */
    hdr : vec3<f32>,
};

/// Shades a surface for the scene's mode.
/// material: x shininess, y specularIntensity, z ambientIntensity, w mode (0 unlit).
/// pbr: x roughness (<0 = default), y metallic, z/w unused.
/// emissive: rgb sRGB color, w strength.
fn shadeSurfaceFull(worldPos: vec3<f32>, worldNormal: vec3<f32>, baseColor: vec3<f32>, material: vec4<f32>, pbr: vec4<f32>, emissive: vec4<f32>) -> Shaded {
    var out: Shaded;
    if (lights.params.z < 0.5) {
        var c = baseColor;
        if (material.w >= 0.5) {
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
    } else {
        let rough = select(pbr.x, 0.5, pbr.x < 0.0);
        radiance = shadePhysical(worldPos, worldNormal, srgbToLinear(baseColor), rough, clamp(pbr.y, 0.0, 1.0), material.z);
    }
    radiance += srgbToLinear(emissive.rgb) * emissive.w;
    var display: vec3<f32>;
    if (material.w < 0.5) {
        // Unlit layers keep their exact authored colors.
        display = clamp(radiance, vec3<f32>(0.0), vec3<f32>(1.0));
    } else {
        display = toneMap(radiance);
    }
    var hdr = radiance * lights.ambientLinear.w;
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

fn shadeSurface(worldPos: vec3<f32>, worldNormal: vec3<f32>, baseColor: vec3<f32>, material: vec4<f32>, pbr: vec4<f32>, emissive: vec4<f32>) -> vec3<f32> {
    return shadeSurfaceFull(worldPos, worldNormal, baseColor, material, pbr, emissive).display;
}
`;

/** Group-3 bindings every lit 3D shader declares. */
export const lightsBindingsWgsl = `
@group(3) @binding(0) var<uniform> lights : LightsUniforms;
@group(3) @binding(1) var shadowMap : texture_depth_2d;
@group(3) @binding(2) var shadowSampler : sampler_comparison;
`;
