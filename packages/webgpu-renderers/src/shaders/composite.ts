export const compositeWgsl = `
struct CompositeUniforms {
	blendMode : u32,
	padding1  : u32,
	padding2  : u32,
	padding3  : u32,
};

@group(0) @binding(0) var<uniform> u : CompositeUniforms;
@group(1) @binding(0) var baseTex    : texture_2d<f32>;
@group(1) @binding(1) var overlayTex : texture_2d<f32>;
@group(1) @binding(2) var samp       : sampler;

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
	var pos = array<vec2<f32>, 4>(
		vec2<f32>(-1.0, 1.0),
		vec2<f32>(1.0, 1.0),
		vec2<f32>(-1.0, -1.0),
		vec2<f32>(1.0, -1.0)
	);
	var uv = array<vec2<f32>, 4>(
		vec2<f32>(0.0, 0.0),
		vec2<f32>(1.0, 0.0),
		vec2<f32>(0.0, 1.0),
		vec2<f32>(1.0, 1.0)
	);
	return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

fn lum(c: vec3<f32>) -> f32 {
	return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
}

fn clip_color(c: vec3<f32>) -> vec3<f32> {
	let l = lum(c);
	let n = min(min(c.r, c.g), c.b);
	let x = max(max(c.r, c.g), c.b);
	var res = c;
	if (n < 0.0) {
		res = l + (((res - l) * l) / (l - n));
	}
	if (x > 1.0) {
		res = l + (((res - l) * (1.0 - l)) / (x - l));
	}
	return res;
}

fn set_lum(c: vec3<f32>, l: f32) -> vec3<f32> {
	let diff = l - lum(c);
	return clip_color(c + vec3<f32>(diff));
}

fn sat(c: vec3<f32>) -> f32 {
	return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

fn set_sat(c: vec3<f32>, s: f32) -> vec3<f32> {
	let c_min = min(min(c.r, c.g), c.b);
	let c_max = max(max(c.r, c.g), c.b);
	if (c_max <= c_min) {
		return vec3<f32>(0.0);
	}
	return (c - vec3<f32>(c_min)) * s / (c_max - c_min);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let d = textureSample(baseTex, samp, in.uv);
	let s = textureSample(overlayTex, samp, in.uv);
	let sa = s.a;
	let da = d.a;
	
	switch (u.blendMode) {
		case 16u: { return d * sa; } // mask-in / destination-in
		case 17u: { return d * (1.0 - sa); } // mask-out / destination-out
		case 18u: { return s * da; } // source-in
		case 19u: { return s * (1.0 - da); } // source-out
		case 20u: { return s * da + d * (1.0 - sa); } // source-atop
		case 21u: { return d + s * (1.0 - da); } // destination-over
		case 22u: { return d * sa + s * (1.0 - da); } // destination-atop
		case 23u: { return s + d; } // lighter
		case 24u: { return s; } // copy
		case 25u: { return s * (1.0 - da) + d * (1.0 - sa); } // xor
		default: {
			if (sa <= 0.0) { return d; }
			if (da <= 0.0) { return s; }
		}
	}

	let s_rgb = select(s.rgb / sa, vec3<f32>(0.0), sa < 0.001);
	let d_rgb = select(d.rgb / da, vec3<f32>(0.0), da < 0.001);

	var b_rgb = s_rgb;

	switch (u.blendMode) {
		case 1u: { b_rgb = s_rgb * d_rgb; } // multiply
		case 2u: { b_rgb = s_rgb + d_rgb - s_rgb * d_rgb; } // screen
		case 3u: { // overlay
			b_rgb = select(1.0 - 2.0 * (1.0 - s_rgb) * (1.0 - d_rgb), 2.0 * s_rgb * d_rgb, d_rgb < vec3<f32>(0.5));
		}
		case 4u: { b_rgb = min(s_rgb, d_rgb); } // darken
		case 5u: { b_rgb = max(s_rgb, d_rgb); } // lighten
		case 6u: { // color-dodge
			b_rgb = select(min(d_rgb / (1.0 - s_rgb), vec3<f32>(1.0)), vec3<f32>(0.0), s_rgb == vec3<f32>(1.0));
		}
		case 7u: { // color-burn
			b_rgb = select(1.0 - min((1.0 - d_rgb) / s_rgb, vec3<f32>(1.0)), vec3<f32>(1.0), s_rgb == vec3<f32>(0.0));
		}
		case 8u: { // hard-light
			b_rgb = select(1.0 - 2.0 * (1.0 - s_rgb) * (1.0 - d_rgb), 2.0 * s_rgb * d_rgb, s_rgb < vec3<f32>(0.5));
		}
		case 9u: { // soft-light
			b_rgb = select(
				d_rgb + (2.0 * s_rgb - 1.0) * (sqrt(d_rgb) - d_rgb),
				d_rgb - (1.0 - 2.0 * s_rgb) * d_rgb * (1.0 - d_rgb),
				s_rgb <= vec3<f32>(0.5)
			);
		}
		case 10u: { b_rgb = abs(d_rgb - s_rgb); } // difference
		case 11u: { b_rgb = s_rgb + d_rgb - 2.0 * s_rgb * d_rgb; } // exclusion
		case 12u: { b_rgb = set_lum(set_sat(s_rgb, sat(d_rgb)), lum(d_rgb)); } // hue
		case 13u: { b_rgb = set_lum(set_sat(d_rgb, sat(s_rgb)), lum(d_rgb)); } // saturation
		case 14u: { b_rgb = set_lum(s_rgb, lum(d_rgb)); } // color
		case 15u: { b_rgb = set_lum(d_rgb, lum(s_rgb)); } // luminosity
		case 16u: { return d * s.a; } // mask-in
		case 17u: { return d * (1.0 - s.a); } // mask-out
		default:  { b_rgb = s_rgb; } // normal
	}

	let out_a = sa + da * (1.0 - sa);
	let out_rgb = (1.0 - da) * s.rgb + (1.0 - sa) * d.rgb + sa * da * b_rgb;

	return vec4<f32>(out_rgb, out_a);
}
`;
