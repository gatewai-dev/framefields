export const quadWgsl = `
struct Uniforms {
	transformCol0 : vec4<f32>,
	transformCol1 : vec4<f32>,
	transformCol2 : vec4<f32>,
	params        : vec4<f32>, // x = opacity, y = surfaceWidth, z = surfaceHeight, w = blurAmount
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

@vertex fn vs(@location(0) xy : vec2<f32>, @location(1) uv : vec2<f32>) -> VSOut {
	let transform = mat3x3<f32>(u.transformCol0.xyz, u.transformCol1.xyz, u.transformCol2.xyz);
	let p = transform * vec3<f32>(xy, 1.0);
	
	let surfaceSize = u.params.yz;
	let clipX = (p.x / surfaceSize.x) * 2.0 - 1.0;
	let clipY = 1.0 - (p.y / surfaceSize.y) * 2.0;

	return VSOut(vec4<f32>(clipX, clipY, 0.0, 1.0), uv);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let opacity = u.params.x;
	let blurAmount = u.params.w;

	if (blurAmount > 0.01) {
		let fdx = dpdx(in.uv);
		let fdy = dpdy(in.uv);
		let fw = max(max(abs(fdx), abs(fdy)), vec2<f32>(0.000001));
		let step = fw * blurAmount * 0.3;

		var color = vec4<f32>(0.0);
		var totalWeight = 0.0;
		for (var y_offset = -1.0; y_offset <= 1.0; y_offset = y_offset + 1.0) {
			for (var x_offset = -1.0; x_offset <= 1.0; x_offset = x_offset + 1.0) {
				let offset = vec2<f32>(x_offset, y_offset) * step;
				let sampleColor = textureSample(tex, samp, in.uv + offset);
				color = color + sampleColor;
				totalWeight = totalWeight + 1.0;
			}
		}
		return (color / totalWeight) * opacity;
	} else {
		let color = textureSample(tex, samp, in.uv);
		return color * opacity;
	}
}
`;
