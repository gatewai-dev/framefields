/// <reference types="webgpu" />
import type { SignalData } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { signalRegistry } from "@gitframes/webgpu-renderers";
import { MAX_BLUR } from "../shared/config.js";

interface BlurOp {
	op: "Blur";
	blurType?:
		| "Gaussian"
		| "Box"
		| "Median"
		| "Motion"
		| "Bilateral"
		| "Edge-preserving"
		| "Radial"
		| "Zoom";
	strength?: number;
	angle?: number;
	sigmaColor?: number;
	centerX?: number;
	centerY?: number;
	partialBlur?: boolean;
	radius?: number;
	radiusY?: number;
	shape?: "ellipse" | "circle" | "rect";
	strengthHandleId?: string | null;
	sigmaColorHandleId?: string | null;
	centerXHandleId?: string | null;
	centerYHandleId?: string | null;
	radiusHandleId?: string | null;
	radiusYHandleId?: string | null;
	opacity?: number;
	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem: {
				type: string;
				data: unknown;
			} | null;
		}
	>;
}

type BlurSignalData = SignalData & { nodeId?: string };

const WGSL_BLUR_UNIFORMS = `
struct BlurUniforms {
	dirX            : f32,
	dirY            : f32,
	strength        : f32,
	angle           : f32,

	sigmaColor      : f32,
	centerX         : f32,
	centerY         : f32,
	radius          : f32,

	partialBlur     : f32,
	hasStrengthSig  : f32,
	hasSigmaColorSig: f32,
	hasCenterXSig   : f32,

	hasCenterYSig   : f32,
	hasRadiusSig    : f32,
	radiusY         : f32,
	shape           : f32,
};

@group(0) @binding(0) var<uniform> u          : BlurUniforms;
@group(1) @binding(0) var tex                 : texture_2d<f32>;
@group(1) @binding(1) var samp                : sampler;
@group(1) @binding(2) var origTex             : texture_2d<f32>;

@group(2) @binding(0) var strengthSigTex    : texture_2d<f32>;
@group(2) @binding(1) var sigmaColorSigTex  : texture_2d<f32>;
@group(2) @binding(2) var centerXSigTex     : texture_2d<f32>;
@group(2) @binding(3) var centerYSigTex     : texture_2d<f32>;
@group(2) @binding(4) var radiusSigTex      : texture_2d<f32>;
@group(2) @binding(5) var signalSamp        : sampler;

fn applyPartialBlur(blurred: vec4<f32>, uv: vec2<f32>, dimensions: vec2<f32>) -> vec4<f32> {
	if (u.partialBlur <= 0.5) {
		return blurred;
	}
	let orig = textureSampleLevel(origTex, samp, uv, 0.0);
	var centerX = u.centerX;
	if (u.hasCenterXSig > 0.5) {
		centerX = textureSampleLevel(centerXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var centerY = u.centerY;
	if (u.hasCenterYSig > 0.5) {
		centerY = textureSampleLevel(centerYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var radiusX = u.radius;
	if (u.hasRadiusSig > 0.5) {
		radiusX = textureSampleLevel(radiusSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var radiusY = u.radiusY;

	var mask = 0.0;
	if (radiusY <= 0.0) {
		let aspect = dimensions.x / dimensions.y;
		let diff = (uv - vec2<f32>(centerX, centerY)) * vec2<f32>(aspect, 1.0);
		let dist = length(diff);
		let feather = 0.05;
		mask = 1.0 - smoothstep(radiusX - feather, radiusX + feather, dist);
	} else {
		let diff = abs(uv - vec2<f32>(centerX, centerY));
		if (u.shape > 0.5) {
			let feather = 0.02;
			let edgeX = 1.0 - smoothstep(radiusX - feather, radiusX + feather, diff.x);
			let edgeY = 1.0 - smoothstep(radiusY - feather, radiusY + feather, diff.y);
			mask = edgeX * edgeY;
		} else {
			let normDist = length(vec2<f32>(diff.x / max(1e-4, radiusX), diff.y / max(1e-4, radiusY)));
			let feather = 0.08;
			mask = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, normDist);
		}
	}
	return mix(orig, blurred, mask);
}
`;

export const GAUSSIAN_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let c = textureSampleLevel(tex, samp, in.uv, 0.0);
	var spatial_sigma = u.strength;
	if (u.hasStrengthSig > 0.5) {
		spatial_sigma = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	if (spatial_sigma <= 0.0) {
		return applyPartialBlur(c, in.uv, dimensions);
	}

	let texelSize = 1.0 / dimensions;
	let stepScale = max(1.0, spatial_sigma / 20.0);
	let effectiveSigma = spatial_sigma / stepScale;
	let radius = min(i32(ceil(3.0 * effectiveSigma)), 64);
	
	let direction = vec2<f32>(u.dirX, u.dirY);
	
	var color = vec4<f32>(0.0);
	var totalWeight = 0.0;

	for (var i = -radius; i <= radius; i++) {
		let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
		let x = f32(i) * stepScale;
		let weight = exp(-0.5 * (x / spatial_sigma) * (x / spatial_sigma));
		color += textureSampleLevel(tex, samp, in.uv + offset, 0.0) * weight;
		totalWeight += weight;
	}

	let blurred = color / totalWeight;
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

export const BOX_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let c = textureSampleLevel(tex, samp, in.uv, 0.0);
	var strength = u.strength;
	if (u.hasStrengthSig > 0.5) {
		strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	let radius = i32(round(strength));
	if (radius <= 0) {
		return applyPartialBlur(c, in.uv, dimensions);
	}

	let texelSize = 1.0 / dimensions;
	let direction = vec2<f32>(u.dirX, u.dirY);
	
	var color = vec4<f32>(0.0);
	var count = 0.0;

	for (var i = -radius; i <= radius; i++) {
		let offset = vec2<f32>(f32(i)) * direction * texelSize;
		color += textureSampleLevel(tex, samp, in.uv + offset, 0.0);
		count += 1.0;
	}

	let blurred = color / count;
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

export const MEDIAN_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

struct Val {
	luma  : f32,
	color : vec4<f32>,
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
	let centerCol = textureSampleLevel(tex, samp, in.uv, 0.0);
	var strength = u.strength;
	if (u.hasStrengthSig > 0.5) {
		strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	let radius = min(i32(round(strength)), 16);
	if (radius <= 0) {
		return applyPartialBlur(centerCol, in.uv, dimensions);
	}

	let count = radius * 2 + 1;
	let texelSize = 1.0 / dimensions;
	let direction = vec2<f32>(u.dirX, u.dirY);

	var values : array<Val, 33>;

	for (var i = 0; i < 33; i++) {
		if (i >= count) { break; }
		let offset = vec2<f32>(f32(i - radius)) * direction * texelSize;
		let col = textureSampleLevel(tex, samp, in.uv + offset, 0.0);
		values[i] = Val(dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114)), col);
	}

	// Selection sort
	for (var i = 0; i < 33; i++) {
		if (i >= count - 1) { break; }
		var minIdx = i;
		for (var j = 0; j < 33; j++) {
			if (j <= i) { continue; }
			if (j >= count) { break; }
			if (values[j].luma < values[minIdx].luma) {
				minIdx = j;
			}
		}
		if (minIdx != i) {
			let temp = values[i];
			values[i] = values[minIdx];
			values[minIdx] = temp;
		}
	}

	let medianIdx = count / 2;
	return applyPartialBlur(values[medianIdx].color, in.uv, dimensions);
}
`;

export const MOTION_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let c = textureSampleLevel(tex, samp, in.uv, 0.0);
	var strength = u.strength;
	if (u.hasStrengthSig > 0.5) {
		strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	if (strength <= 0.0) {
		return applyPartialBlur(c, in.uv, dimensions);
	}

	let PI = 3.14159265359;
	let angleRad = u.angle * PI / 180.0;
	let dir = vec2<f32>(cos(angleRad), sin(angleRad));

	let texelSize = 1.0 / dimensions;
	let step = dir * texelSize;

	let numSamples = i32(clamp(strength, 1.0, 64.0));
	var color = vec4<f32>(0.0);
	
	for (var i = 0; i < 64; i++) {
		if (i >= numSamples) { break; }
		let offset = f32(i - numSamples / 2) * step;
		color += textureSampleLevel(tex, samp, in.uv + offset, 0.0);
	}

	let blurred = color / f32(numSamples);
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

export const BILATERAL_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let centerCol = textureSampleLevel(tex, samp, in.uv, 0.0);
	var spatial_sigma = u.strength;
	if (u.hasStrengthSig > 0.5) {
		spatial_sigma = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var sigmaColor = u.sigmaColor;
	if (u.hasSigmaColorSig > 0.5) {
		sigmaColor = textureSampleLevel(sigmaColorSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	if (spatial_sigma <= 0.0) {
		return applyPartialBlur(centerCol, in.uv, dimensions);
	}

	let texelSize = 1.0 / dimensions;
	let radius = min(i32(ceil(3.0 * spatial_sigma)), 32);
	let direction = vec2<f32>(u.dirX, u.dirY);
	
	var color = vec4<f32>(0.0);
	var totalWeight = 0.0;

	for (var i = -32; i <= 32; i++) {
		if (i < -radius || i > radius) { continue; }
		let offset = vec2<f32>(f32(i)) * direction * texelSize;
		let sampleCol = textureSampleLevel(tex, samp, in.uv + offset, 0.0);
		
		let spatialDistSq = f32(i * i);
		let spatialWeight = exp(-0.5 * spatialDistSq / (spatial_sigma * spatial_sigma));
		
		let diff = sampleCol - centerCol;
		let colorDistSq = dot(diff, diff);
		let rangeWeight = exp(-0.5 * colorDistSq / (sigmaColor * sigmaColor));
		
		let weight = spatialWeight * rangeWeight;
		color += sampleCol * weight;
		totalWeight += weight;
	}

	var blurred = centerCol;
	if (totalWeight > 0.0) {
		blurred = color / totalWeight;
	}
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

export const EDGE_PRESERVING_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let centerCol = textureSampleLevel(tex, samp, in.uv, 0.0);
	var strength = u.strength;
	if (u.hasStrengthSig > 0.5) {
		strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	// Map strength (1-10) to radius (1-6)
	let radius = i32(clamp(round(strength * 5.0 / 10.0) + 1.0, 1.0, 6.0));

	let dimensions = vec2<f32>(textureDimensions(tex));
	let texelSize = 1.0 / dimensions;

	var m0 = vec3<f32>(0.0); var m1 = vec3<f32>(0.0); var m2 = vec3<f32>(0.0); var m3 = vec3<f32>(0.0);
	var s0 = vec3<f32>(0.0); var s1 = vec3<f32>(0.0); var s2 = vec3<f32>(0.0); var s3 = vec3<f32>(0.0);

	let n = f32((radius + 1) * (radius + 1));

	for (var j = -6; j <= 6; j++) {
		if (j < -radius || j > radius) { continue; }
		for (var i = -6; i <= 6; i++) {
			if (i < -radius || i > radius) { continue; }
			
			let c = textureSampleLevel(tex, samp, in.uv + vec2<f32>(f32(i), f32(j)) * texelSize, 0.0).rgb;
			
			if (i <= 0 && j <= 0) {
				m0 += c;
				s0 += c * c;
			}
			if (i >= 0 && j <= 0) {
				m1 += c;
				s1 += c * c;
			}
			if (i <= 0 && j >= 0) {
				m2 += c;
				s2 += c * c;
			}
			if (i >= 0 && j >= 0) {
				m3 += c;
				s3 += c * c;
			}
		}
	}

	m0 = m0 / n; s0 = abs(s0 / n - m0 * m0);
	m1 = m1 / n; s1 = abs(s1 / n - m1 * m1);
	m2 = m2 / n; s2 = abs(s2 / n - m2 * m2);
	m3 = m3 / n; s3 = abs(s3 / n - m3 * m3);

	let v0 = s0.r + s0.g + s0.b;
	let v1 = s1.r + s1.g + s1.b;
	let v2 = s2.r + s2.g + s2.b;
	let v3 = s3.r + s3.g + s3.b;

	var minVar = v0;
	var finalCol = m0;

	if (v1 < minVar) {
		minVar = v1;
		finalCol = m1;
	}
	if (v2 < minVar) {
		minVar = v2;
		finalCol = m2;
	}
	if (v3 < minVar) {
		minVar = v3;
		finalCol = m3;
	}

	let blurred = vec4<f32>(finalCol, centerCol.a);
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

export const RADIAL_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let centerCol = textureSampleLevel(tex, samp, in.uv, 0.0);
	var strength = u.strength;
	if (u.hasStrengthSig > 0.5) {
		strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var centerX = u.centerX;
	if (u.hasCenterXSig > 0.5) {
		centerX = textureSampleLevel(centerXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var centerY = u.centerY;
	if (u.hasCenterYSig > 0.5) {
		centerY = textureSampleLevel(centerYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	if (strength <= 0.0) {
		return applyPartialBlur(centerCol, in.uv, dimensions);
	}

	let center = vec2<f32>(centerX, centerY);
	let toPixel = in.uv - center;
	let dist = length(toPixel);
	if (dist <= 0.0) {
		return applyPartialBlur(centerCol, in.uv, dimensions);
	}

	let dir = vec2<f32>(-toPixel.y, toPixel.x);
	let blurAmount = (strength / 100.0) * 0.1 * dist;

	let numSamples = 24;
	var color = vec4<f32>(0.0);
	let step = dir * (blurAmount / f32(numSamples));

	for (var i = 0; i < 24; i++) {
		let offset = step * f32(i - 12);
		color += textureSampleLevel(tex, samp, in.uv + offset, 0.0);
	}

	let blurred = color / 24.0;
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

export const ZOOM_BLUR_SHADER = `
${WGSL_BLUR_UNIFORMS}

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
	let centerCol = textureSampleLevel(tex, samp, in.uv, 0.0);
	var strength = u.strength;
	if (u.hasStrengthSig > 0.5) {
		strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var centerX = u.centerX;
	if (u.hasCenterXSig > 0.5) {
		centerX = textureSampleLevel(centerXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var centerY = u.centerY;
	if (u.hasCenterYSig > 0.5) {
		centerY = textureSampleLevel(centerYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let dimensions = vec2<f32>(textureDimensions(tex));
	if (strength <= 0.0) {
		return applyPartialBlur(centerCol, in.uv, dimensions);
	}

	let center = vec2<f32>(centerX, centerY);
	let toPixel = in.uv - center;
	let blurAmount = (strength / 100.0) * 0.15;

	let numSamples = 24;
	var color = vec4<f32>(0.0);
	let step = toPixel * (blurAmount / f32(numSamples));

	for (var i = 0; i < 24; i++) {
		let offset = step * f32(i - 12);
		color += textureSampleLevel(tex, samp, in.uv + offset, 0.0);
	}

	let blurred = color / 24.0;
	return applyPartialBlur(blurred, in.uv, dimensions);
}
`;

interface DeviceBlurResources {
	blurUniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceBlurResources>();

function getDeviceLayouts(device: GPUDevice): DeviceBlurResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const blurUniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const singleTextureLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
		],
	});

	const signalTextureLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 3,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 4,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 5,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		blurUniformLayout,
		singleTextureLayout,
		signalTextureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getBlurResources(
	device: GPUDevice,
	format: GPUTextureFormat,
	blurType: string,
) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `blur_${blurType}_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		let code = GAUSSIAN_BLUR_SHADER;
		if (blurType === "Box") {
			code = BOX_BLUR_SHADER;
		} else if (blurType === "Median") {
			code = MEDIAN_BLUR_SHADER;
		} else if (blurType === "Motion") {
			code = MOTION_BLUR_SHADER;
		} else if (blurType === "Bilateral") {
			code = BILATERAL_BLUR_SHADER;
		} else if (blurType === "Edge-preserving") {
			code = EDGE_PRESERVING_SHADER;
		} else if (blurType === "Radial") {
			code = RADIAL_BLUR_SHADER;
		} else if (blurType === "Zoom") {
			code = ZOOM_BLUR_SHADER;
		}

		const blurModule = device.createShaderModule({
			label: `blur_${blurType}_${format}.wgsl`,
			code,
		});

		pipeline = device.createRenderPipeline({
			label: `BlurPipeline_${blurType}_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.blurUniformLayout,
					layouts.singleTextureLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module: blurModule, entryPoint: "vs" },
			fragment: {
				module: blurModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		blurPipeline: pipeline,
		blurUniformLayout: layouts.blurUniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

export const BlurWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		encoder,
		pass,
		targetView,
		targetTexture,
		targetWidth,
		targetHeight,
		props,
		drawChild,
	} = args;
	const frame = props.frame ?? 0;
	const fps = props.fps || 30;
	const op = props.virtualMedia?.operation as BlurOp | undefined;
	if (op?.op !== "Blur" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the provided pass
	pass.end();

	const blurData = new Float32Array(16);

	const width = targetWidth;
	const height = targetHeight;

	const logicalWidth =
		props.containerWidth ??
		ctx.surface.width /
			(typeof window !== "undefined" ? window.devicePixelRatio : 1);
	const dpiScale = width / logicalWidth;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "blur_node";

	const resolveBindable = (
		configKey: "strength" | "sigmaColor" | "centerX" | "centerY" | "radius" | "radiusY",
		defaultValue: number,
		minVal: number,
		maxVal: number,
		scaleByDpi = false,
	) => {
		const handleIdKey = `${configKey}HandleId` as keyof BlurOp;
		const handleId = op[handleIdKey] as string | null | undefined;
		const input = handleId ? op.inputs?.[handleId] : null;

		const hasSignal = !!(
			input?.connectionValid &&
			(input.outputItem?.type === "Signal" ||
				input.outputItem?.type === "Numeric")
		);

		const sd =
			hasSignal && input?.outputItem?.data
				? (input.outputItem.data as BlurSignalData)
				: null;

		let val = defaultValue;
		let hasStaticSig = false;

		let gpuTextureView: GPUTextureView | undefined = undefined;

		if (!hasSignal) {
			if (input?.connectionValid && input.outputItem?.type === "Number") {
				const rawVal = Number(input.outputItem.data ?? defaultValue);
				val = Math.max(minVal, Math.min(maxVal, rawVal));
				if (scaleByDpi) val *= dpiScale;
			} else {
				let rawVal = op[configKey] as unknown;
				if (rawVal !== undefined && rawVal !== null) {
					if (typeof rawVal === "object") {
						if ("get" in (rawVal as Record<string, unknown>) && typeof (rawVal as Record<string, unknown>).get === "function") {
							rawVal = (rawVal as { get: (ctx: { frame: number; fps: number }) => unknown }).get({ frame, fps });
						} else if ("value" in (rawVal as Record<string, unknown>)) {
							const sig = rawVal as { value: unknown; gpuBinding?: { textureView?: GPUTextureView } };
							if (sig.gpuBinding?.textureView) {
								gpuTextureView = sig.gpuBinding.textureView;
								hasStaticSig = true;
							}
							rawVal = sig.value;
						}
					} else if (typeof rawVal === "function") {
						rawVal = (rawVal as (f: number, fps: number) => unknown)(frame, fps);
					}
				}
				const numVal = Number(rawVal ?? defaultValue);
				val = Math.max(minVal, Math.min(maxVal, isNaN(numVal) ? defaultValue : numVal));
				if (scaleByDpi) val *= dpiScale;
			}
		} else if (sd) {
			const rawVal = Number(sd.offset ?? 0.0);
			val = Math.max(minVal, Math.min(maxVal, rawVal));
			if (scaleByDpi) val *= dpiScale;
			hasStaticSig = true;
		}

		return { val, hasStaticSig, sd, gpuTextureView };
	};

	const strengthRes = resolveBindable("strength", 5, 0, MAX_BLUR, true);
	const sigmaColorRes = resolveBindable("sigmaColor", 0.1, 0.01, 1.0, false);
	const centerXRes = resolveBindable("centerX", 0.5, 0.0, 1.0, false);
	const centerYRes = resolveBindable("centerY", 0.5, 0.0, 1.0, false);
	const radiusRes = resolveBindable("radius", 0.3, 0.001, 1.0, false);
	const radiusYRes = resolveBindable("radiusY", 0.0, 0.0, 1.0, false);

	const tmpTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpView = tmpTex.createView();

	// Clear intermediate texture
	const childPass = ctx.renderer.beginFrame(
		encoder,
		tmpView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	childPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{ ...props, virtualMedia: childMedia },
		tmpView,
		tmpTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	const blurType = op.blurType ?? "Gaussian";
	const isSeparable =
		blurType === "Gaussian" ||
		blurType === "Box" ||
		blurType === "Median" ||
		blurType === "Bilateral";

	// Fetch static resources and compile pipeline once
	const {
		blurPipeline: pipeline,
		blurUniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getBlurResources(ctx.device, ctx.renderer.format, blurType);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Fetch dynamic signal texture views on-demand
	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	// Pre-extract audio features if any connected bindable signals use audio sources
	for (const bindableRes of [
		strengthRes,
		sigmaColorRes,
		centerXRes,
		centerYRes,
		radiusRes,
	]) {
		if (bindableRes.hasStaticSig && bindableRes.sd) {
			await signalRegistry.ensureAudioSourcesExtracted(
				ctx.device,
				bindableRes.sd,
				fps,
				props.renderId,
			);
		}
	}

	const getSignalView = (
		res: {
			val: number;
			hasStaticSig: boolean;
			sd: BlurSignalData | null;
			gpuTextureView?: GPUTextureView;
		},
		suffix: string,
	) => {
		if (res.gpuTextureView) {
			return res.gpuTextureView;
		}
		if (res.hasStaticSig && res.sd) {
			return signalRegistry.getOrCreate2DTextureView(
				ctx.device,
				encoder,
				res.sd.nodeId ?? `${nodeId}_${suffix}`,
				elapsedSeconds,
				durationSeconds,
				res.sd,
				width,
				height,
				props.renderId,
				frame,
				fps,
			);
		}
		return signalRegistry.getDummy1x1TextureView(ctx.device);
	};

	const strengthView = getSignalView(strengthRes, "strength_sig");
	const sigmaColorView = getSignalView(sigmaColorRes, "sigmacolor_sig");
	const centerXView = getSignalView(centerXRes, "centerx_sig");
	const centerYView = getSignalView(centerYRes, "centery_sig");
	const radiusView = getSignalView(radiusRes, "radius_sig");

	const createBlurBindGroup1 = (inputTex: GPUTexture, origTex: GPUTexture) =>
		ctx.device.createBindGroup({
			layout: tLayout,
			entries: [
				{ binding: 0, resource: inputTex.createView() },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: origTex.createView() },
			],
		});

	// Prepare uniform template (64 bytes / 16 floats)
	const isPartial = Boolean(
		op.partialBlur &&
		(op.partialBlur as unknown) !== "false" &&
		(op.partialBlur as unknown) !== 0,
	);
	blurData[2] = strengthRes.val;
	blurData[3] = Number(op.angle ?? 0.0);

	blurData[4] = sigmaColorRes.val;
	blurData[5] = centerXRes.val;
	blurData[6] = centerYRes.val;
	blurData[7] = radiusRes.val;

	blurData[8] = isPartial ? 1.0 : 0.0;
	blurData[9] = strengthRes.hasStaticSig ? 1.0 : 0.0;
	blurData[10] = sigmaColorRes.hasStaticSig ? 1.0 : 0.0;
	blurData[11] = centerXRes.hasStaticSig ? 1.0 : 0.0;

	blurData[12] = centerYRes.hasStaticSig ? 1.0 : 0.0;
	blurData[13] = radiusRes.hasStaticSig ? 1.0 : 0.0;
	blurData[14] = radiusYRes.val;
	blurData[15] = op.shape === "rect" ? 1.0 : 0.0;

	let outTex2: GPUTexture;

	if (isSeparable) {
		const outTex1 = ctx.renderer.getTemporaryTexture(width, height, [
			tmpTex,
			targetTexture,
			...(props.excludeTextures || []),
		]);
		outTex2 = ctx.renderer.getTemporaryTexture(width, height, [
			tmpTex,
			outTex1,
			targetTexture,
			...(props.excludeTextures || []),
		]);

		// Pass 1: Horizontal (full blur, partialBlur disabled)
		blurData[0] = 1.0;
		blurData[1] = 0.0;
		blurData[8] = 0.0;
		const hBuffer = ctx.renderer.getTemporaryBuffer(blurData);

		const hPass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: outTex1.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		hPass.setPipeline(pipeline);
		hPass.setBindGroup(
			0,
			ctx.device.createBindGroup({
				layout: uLayout,
				entries: [{ binding: 0, resource: { buffer: hBuffer } }],
			}),
		);
		hPass.setBindGroup(1, createBlurBindGroup1(tmpTex, tmpTex));
		hPass.setBindGroup(
			2,
			ctx.device.createBindGroup({
				layout: sigLayout,
				entries: [
					{ binding: 0, resource: strengthView },
					{ binding: 1, resource: sigmaColorView },
					{ binding: 2, resource: centerXView },
					{ binding: 3, resource: centerYView },
					{ binding: 4, resource: radiusView },
					{ binding: 5, resource: sampler },
				],
			}),
		);
		hPass.draw(4);
		hPass.end();

		// Pass 2: Vertical (applies partialBlur mask with original tmpTex)
		blurData[0] = 0.0;
		blurData[1] = 1.0;
		blurData[8] = isPartial ? 1.0 : 0.0;
		const vBuffer = ctx.renderer.getTemporaryBuffer(blurData);

		const vPass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: outTex2.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		vPass.setPipeline(pipeline);
		vPass.setBindGroup(
			0,
			ctx.device.createBindGroup({
				layout: uLayout,
				entries: [{ binding: 0, resource: { buffer: vBuffer } }],
			}),
		);
		vPass.setBindGroup(1, createBlurBindGroup1(outTex1, tmpTex));
		vPass.setBindGroup(
			2,
			ctx.device.createBindGroup({
				layout: sigLayout,
				entries: [
					{ binding: 0, resource: strengthView },
					{ binding: 1, resource: sigmaColorView },
					{ binding: 2, resource: centerXView },
					{ binding: 3, resource: centerYView },
					{ binding: 4, resource: radiusView },
					{ binding: 5, resource: sampler },
				],
			}),
		);
		vPass.draw(4);
		vPass.end();
	} else {
		// 1-Pass Filters (Motion, Edge-preserving, Radial, Zoom)
		outTex2 = ctx.renderer.getTemporaryTexture(width, height, [
			tmpTex,
			targetTexture,
			...(props.excludeTextures || []),
		]);

		blurData[0] = 0.0;
		blurData[1] = 0.0;
		blurData[8] = isPartial ? 1.0 : 0.0;
		const singleBuffer = ctx.renderer.getTemporaryBuffer(blurData);

		const singlePass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: outTex2.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		singlePass.setPipeline(pipeline);
		singlePass.setBindGroup(
			0,
			ctx.device.createBindGroup({
				layout: uLayout,
				entries: [{ binding: 0, resource: { buffer: singleBuffer } }],
			}),
		);
		singlePass.setBindGroup(1, createBlurBindGroup1(tmpTex, tmpTex));
		singlePass.setBindGroup(
			2,
			ctx.device.createBindGroup({
				layout: sigLayout,
				entries: [
					{ binding: 0, resource: strengthView },
					{ binding: 1, resource: sigmaColorView },
					{ binding: 2, resource: centerXView },
					{ binding: 3, resource: centerYView },
					{ binding: 4, resource: radiusView },
					{ binding: 5, resource: sampler },
				],
			}),
		);
		singlePass.draw(4);
		singlePass.end();
	}

	// Final Pass: Draw result to targetView using standard drawTexture for blending/opacity
	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);
	ctx.renderer.drawTexture(
		finalPass,
		outTex2,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: op.opacity ?? 1 },
	);

	args.pass = finalPass;
};
