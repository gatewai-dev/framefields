export const pathWgsl = `
struct Uniforms {
    transformCol0 : vec4<f32>,
    transformCol1 : vec4<f32>,
    transformCol2 : vec4<f32>,
    params        : vec4<f32>, // x = opacity, y = surfaceWidth, z = surfaceHeight, w = strokeWidth
    color         : vec4<f32>,
    style         : vec4<f32>, // x = capType (0 = round, 1 = butt, 2 = square)
    p0            : vec2<f32>,
    p1            : vec2<f32>,
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

fn sdSegmentWithCap(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, radius: f32, capType: f32) -> f32 {
    let ba = b - a;
    let len = length(ba);
    if (len < 1e-6) {
        return length(p - a) - radius;
    }
    let dir = ba / len;
    let normal = vec2<f32>(-dir.y, dir.x);
    let pa = p - a;
    
    let proj = dot(pa, dir);
    let perp = abs(dot(pa, normal));
    
    if (capType > 0.5 && capType < 1.5) {
        // Butt cap: terminates strictly at endpoints a and b
        let dx = max(-proj, proj - len);
        let dy = perp - radius;
        let outside = length(max(vec2<f32>(dx, dy), vec2<f32>(0.0, 0.0)));
        let inside = min(max(dx, dy), 0.0);
        return outside + inside;
    } else if (capType >= 1.5) {
        // Square cap: extends past endpoints a and b by radius
        let dx = max(-proj - radius, proj - (len + radius));
        let dy = perp - radius;
        let outside = length(max(vec2<f32>(dx, dy), vec2<f32>(0.0, 0.0)));
        let inside = min(max(dx, dy), 0.0);
        return outside + inside;
    } else {
        // Round cap (default)
        let h = clamp(proj / len, 0.0, 1.0);
        return length(pa - ba * h) - radius;
    }
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let radius = u.params.w * 0.5;
    let d = sdSegmentWithCap(in.localPos, u.p0, u.p1, radius, u.style.x);
    
    let fw = max(fwidth(d), 1e-5);
    let edgeAlpha = clamp(0.5 - d / fw, 0.0, 1.0);
    let alpha = u.color.a * u.params.x * edgeAlpha;
    if (alpha <= 0.0) {
        discard;
    }
    
    return vec4<f32>(u.color.rgb * alpha, alpha);
}
`;
