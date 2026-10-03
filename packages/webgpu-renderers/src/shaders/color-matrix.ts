export const colorMatrixWgsl = `
struct ColorMatrixUniforms {
	row0  : vec4<f32>,
	row1  : vec4<f32>,
	row2  : vec4<f32>,
	row3  : vec4<f32>,
	trans : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : ColorMatrixUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

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

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let c = textureSample(tex, samp, in.uv);
	var rgba = vec4<f32>(c.rgb, c.a);
	if (c.a > 0.0) {
		rgba = vec4<f32>(c.rgb / c.a, c.a);
	}

	let r = dot(u.row0, rgba) + u.trans.x;
	let g = dot(u.row1, rgba) + u.trans.y;
	let b = dot(u.row2, rgba) + u.trans.z;
	let a = dot(u.row3, rgba) + u.trans.w;

	let outAlpha = clamp(a, 0.0, 1.0);
	let outRgb = clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0)) * outAlpha;

	return vec4<f32>(outRgb, outAlpha);
}
`;
