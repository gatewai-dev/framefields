/**
 * Camera and light uniforms plus Blinn-Phong lighting shared by the 3D quad
 * and 3D text shaders, so text on a plane is lit exactly like a textured quad.
 * The including shader declares `cam : CameraUniforms` and
 * `lights : LightsUniforms`.
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
    colorIntensity : vec4<f32>, // rgb = linear color, w = intensity
    spotParams     : vec4<f32>, // x = cos(outer), y = cos(inner), z = decay, w = unused
};

struct LightsUniforms {
    ambientColor : vec4<f32>, // rgb = ambient color * intensity, w = unused
    params       : vec4<f32>, // x = numLights, y = hasLights (1.0 = lit, 0.0 = unlit), z = unused, w = unused
    lights       : array<GPULight, 8>,
};

fn applyLighting3D(worldPos: vec3<f32>, worldNormal: vec3<f32>, baseColor: vec3<f32>, material: vec4<f32>) -> vec3<f32> {
    // If no lights in scene or unlit material mode, return unlit base color
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
    
    // 1. Ambient component
    var totalIllumination = baseColor * (lights.ambientColor.rgb * ambientInt);
    
    let numLights = i32(lights.params.x);
    for (var i = 0; i < 8; i++) {
        if (i >= numLights) {
            break;
        }
        let light = lights.lights[i];
        let lightType = light.posType.w; // 1 = directional, 2 = point, 3 = spot
        let lightColor = light.colorIntensity.rgb;
        let intensity = light.colorIntensity.w;
        
        var L = vec3<f32>(0.0, 0.0, 1.0);
        var attenuation = 1.0;
        
        if (lightType > 0.5 && lightType < 1.5) {
            // Directional Light
            L = normalize(-light.dirRadius.xyz);
        } else if (lightType >= 1.5) {
            // Point or Spot Light
            let toLight = light.posType.xyz - worldPos;
            let dist = length(toLight);
            let radius = max(1.0, light.dirRadius.w);
            if (dist > radius) {
                continue;
            }
            L = normalize(toLight);
            
            // Distance attenuation
            let dNorm = clamp(dist / radius, 0.0, 1.0);
            let decay = max(0.5, light.spotParams.z);
            attenuation = pow(clamp(1.0 - dNorm, 0.0, 1.0), decay);
            
            if (lightType > 2.5) {
                // Spot Light cone angle and penumbra falloff
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
        
        // Diffuse Lambertian
        let NdotL = max(dot(N, L), 0.0);
        let diffuse = baseColor * lightColor * (NdotL * intensity * attenuation);
        
        // Specular Blinn-Phong
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
`;
