import { gradientWgsl } from "./gradient.js";

export const solidWgsl = `
${gradientWgsl}

struct Uniforms {
    transformCol0 : vec4<f32>,
    transformCol1 : vec4<f32>,
    transformCol2 : vec4<f32>,
    params        : vec4<f32>, // x = opacity, y = surfaceWidth, z = surfaceHeight, w = cornerRadius
    color         : vec4<f32>,
    rect          : vec4<f32>, // x, y, width, height
    gradient      : GradientUniforms, // info.x = 0: solid \`color\`
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

fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let center = u.rect.xy + u.rect.zw * 0.5;
    let halfSize = u.rect.zw * 0.5;
    let radius = u.params.w;
    
    let d = sdRoundedRect(in.localPos - center, halfSize, radius);
    // Rounded shapes: one device pixel of coverage centred on the edge (the
    // quad has room for its outer half). Square ones keep their exact edge.
    let fw = max(fwidth(d), 1e-4);
    var edgeAlpha = 1.0 - smoothstep(0.0, 1.0, d);
    if (radius > 0.0) {
        edgeAlpha = clamp(0.5 - d / fw, 0.0, 1.0);
    }
    var fill = u.color;
    if (u.gradient.info.x > 0.5) {
        fill = evalGradient(u.gradient, in.localPos);
    }
    let alpha = fill.a * u.params.x * edgeAlpha;
    if (alpha <= 0.0) {
        discard;
    }
    
    return vec4<f32>(fill.rgb * alpha, alpha);
}
`;
