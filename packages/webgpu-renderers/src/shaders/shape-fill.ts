export const shapeFillWgsl = `
struct Uniforms {
    transformCol0 : vec4<f32>,
    transformCol1 : vec4<f32>,
    transformCol2 : vec4<f32>,
    params        : vec4<f32>, // x = opacity, y = surfaceWidth, z = surfaceHeight, w = fillType (0=solid, 1=linear, 2=radial)
    color         : vec4<f32>, // solid color or gradient start
    color2        : vec4<f32>, // gradient end
    gradCoords    : vec4<f32>, // linear: (x0, y0, x1, y1), radial: (cx, cy, radius, unused)
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) localPos  : vec2<f32>,
};

@vertex fn vs(@location(0) xy : vec2<f32>) -> VSOut {
    let transform = mat3x3<f32>(u.transformCol0.xyz, u.transformCol1.xyz, u.transformCol2.xyz);
    let p = transform * vec3<f32>(xy, 1.0);
    
    let surfaceSize = u.params.yz;
    let clipX = (p.x / surfaceSize.x) * 2.0 - 1.0;
    let clipY = 1.0 - (p.y / surfaceSize.y) * 2.0;

    return VSOut(vec4<f32>(clipX, clipY, 0.0, 1.0), xy);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    var outColor = u.color;
    let fillType = u.params.w;
    
    if (fillType > 0.5 && fillType < 1.5) {
        // Linear gradient between p0 and p1
        let p0 = u.gradCoords.xy;
        let p1 = u.gradCoords.zw;
        let d = p1 - p0;
        let lenSq = dot(d, d);
        let t = clamp(dot(in.localPos - p0, d) / max(lenSq, 1e-6), 0.0, 1.0);
        outColor = mix(u.color, u.color2, t);
    } else if (fillType >= 1.5) {
        // Radial gradient from center out to radius
        let center = u.gradCoords.xy;
        let radius = max(u.gradCoords.z, 1e-6);
        let dist = length(in.localPos - center);
        let t = clamp(dist / radius, 0.0, 1.0);
        outColor = mix(u.color, u.color2, t);
    }
    
    let alpha = outColor.a * u.params.x;
    if (alpha <= 0.0) {
        discard;
    }
    
    return vec4<f32>(outColor.rgb * alpha, alpha);
}
`;
