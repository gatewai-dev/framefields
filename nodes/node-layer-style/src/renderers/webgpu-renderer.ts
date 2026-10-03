/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import {
	computeLayerStylePadding,
	type LayerStyleNodeConfig,
} from "../shared/config.js";

interface LayerStyleOp extends LayerStyleNodeConfig {
	op: "LayerStyle";
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

export function hexToRgba(
	hex?: string | null,
): [number, number, number, number] {
	if (!hex) return [1, 1, 1, 1];
	let cleaned = hex.trim().replace(/^#/, "");
	if (cleaned.length === 3) {
		cleaned =
			cleaned
				.split("")
				.map((c) => c + c)
				.join("") + "ff";
	} else if (cleaned.length === 6) {
		cleaned = cleaned + "ff";
	} else if (cleaned.length === 8) {
		// already 8 chars
	} else {
		return [1, 1, 1, 1];
	}

	const r = parseInt(cleaned.slice(0, 2), 16) / 255;
	const g = parseInt(cleaned.slice(2, 4), 16) / 255;
	const b = parseInt(cleaned.slice(4, 6), 16) / 255;
	const a = parseInt(cleaned.slice(6, 8), 16) / 255;

	return [
		Number.isFinite(r) ? r : 1,
		Number.isFinite(g) ? g : 1,
		Number.isFinite(b) ? b : 1,
		Number.isFinite(a) ? a : 1,
	];
}

const BLEND_MODE_MAP: Record<string, number> = {
	normal: 0,
	"source-over": 0,
	multiply: 1,
	screen: 2,
	overlay: 3,
	darken: 4,
	lighten: 5,
	"color-dodge": 6,
	"color-burn": 7,
	"hard-light": 8,
	"soft-light": 9,
	difference: 10,
	exclusion: 11,
	hue: 12,
	saturation: 13,
	color: 14,
	luminosity: 15,
	"mask-in": 16,
	"destination-in": 16,
	"mask-out": 17,
	"destination-out": 17,
	"source-in": 18,
	"source-out": 19,
	"source-atop": 20,
	"destination-over": 21,
	"destination-atop": 22,
	lighter: 23,
	copy: 24,
	xor: 25,
};

const BEVEL_STYLE_MAP: Record<string, number> = {
	InnerBevel: 0,
	OuterBevel: 1,
	Emboss: 2,
	PillowEmboss: 3,
};

const BEVEL_TECHNIQUE_MAP: Record<string, number> = {
	Smooth: 0,
	ChiselHard: 1,
	ChiselSoft: 2,
};

const STROKE_POS_MAP: Record<string, number> = {
	outside: 0,
	center: 1,
	inside: 2,
};

const WGSL_LAYER_STYLE_SHADER = `
struct LayerStyleUniforms {
	// Drop Shadow (vec4 x 3)
	dropShadowColor     : vec4<f32>,
	dropShadowParams    : vec4<f32>, // x: enabled, y: opacity, z: angle(rad), w: distance
	dropShadowParams2   : vec4<f32>, // x: spread, y: size, z: blendMode, w: pad

	// Inner Shadow (vec4 x 3)
	innerShadowColor    : vec4<f32>,
	innerShadowParams   : vec4<f32>, // x: enabled, y: opacity, z: angle(rad), w: distance
	innerShadowParams2  : vec4<f32>, // x: choke, y: size, z: blendMode, w: pad

	// Outer Glow (vec4 x 3)
	outerGlowColor      : vec4<f32>,
	outerGlowParams     : vec4<f32>, // x: enabled, y: opacity, z: size, w: spread
	outerGlowParams2    : vec4<f32>, // x: blendMode, yzw: pad

	// Inner Glow (vec4 x 3)
	innerGlowColor      : vec4<f32>,
	innerGlowParams     : vec4<f32>, // x: enabled, y: opacity, z: size, w: spread
	innerGlowParams2    : vec4<f32>, // x: blendMode, yzw: pad

	// Stroke (vec4 x 3)
	strokeColor         : vec4<f32>,
	strokeParams        : vec4<f32>, // x: enabled, y: size, z: position(0:out,1:center,2:in), w: opacity
	strokeParams2       : vec4<f32>, // x: blendMode, yzw: pad

	// Bevel & Emboss (vec4 x 5)
	bevelHighlightColor : vec4<f32>,
	bevelShadowColor    : vec4<f32>,
	bevelParams1        : vec4<f32>, // x: enabled, y: style, z: technique, w: depth
	bevelParams2        : vec4<f32>, // x: direction(1:up, -1:down), y: size, z: soften, w: angle(rad)
	bevelParams3        : vec4<f32>, // x: altitude(rad), y: hlOpacity, z: shOpacity, w: pad

	// Color Overlay (vec4 x 2)
	colorOverlayColor   : vec4<f32>,
	colorOverlayParams  : vec4<f32>, // x: enabled, y: opacity, z: blendMode, w: pad
};

@group(0) @binding(0) var<uniform> u : LayerStyleUniforms;
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

fn sampleAlpha(uv: vec2<f32>) -> f32 {
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		return 0.0;
	}
	return textureSampleLevel(tex, samp, uv, 0.0).a;
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
		res = l + (((res - l) * l) / max(l - n, 1e-5));
	}
	if (x > 1.0) {
		res = l + (((res - l) * (1.0 - l)) / max(x - l, 1e-5));
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
	return (c - vec3<f32>(c_min)) * s / max(c_max - c_min, 1e-5);
}

fn blendRgb(d_rgb: vec3<f32>, s_rgb: vec3<f32>, mode: u32) -> vec3<f32> {
	switch (mode) {
		case 1u: { // multiply
			return d_rgb * s_rgb;
		}
		case 2u: { // screen
			return d_rgb + s_rgb - d_rgb * s_rgb;
		}
		case 3u: { // overlay
			return select(
				1.0 - 2.0 * (1.0 - d_rgb) * (1.0 - s_rgb),
				2.0 * d_rgb * s_rgb,
				d_rgb < vec3<f32>(0.5)
			);
		}
		case 4u: { // darken
			return min(d_rgb, s_rgb);
		}
		case 5u: { // lighten
			return max(d_rgb, s_rgb);
		}
		case 6u: { // color-dodge
			return select(min(d_rgb / max(1.0 - s_rgb, vec3<f32>(1e-4)), vec3<f32>(1.0)), vec3<f32>(1.0), s_rgb >= vec3<f32>(0.999));
		}
		case 7u: { // color-burn
			return select(1.0 - min((1.0 - d_rgb) / max(s_rgb, vec3<f32>(1e-4)), vec3<f32>(1.0)), vec3<f32>(0.0), s_rgb <= vec3<f32>(0.001));
		}
		case 8u: { // hard-light
			return select(
				1.0 - 2.0 * (1.0 - d_rgb) * (1.0 - s_rgb),
				2.0 * d_rgb * s_rgb,
				s_rgb < vec3<f32>(0.5)
			);
		}
		case 9u: { // soft-light
			return select(
				d_rgb + (2.0 * s_rgb - 1.0) * (sqrt(d_rgb) - d_rgb),
				d_rgb - (1.0 - 2.0 * s_rgb) * d_rgb * (1.0 - d_rgb),
				s_rgb <= vec3<f32>(0.5)
			);
		}
		case 10u: { // difference
			return abs(d_rgb - s_rgb);
		}
		case 11u: { // exclusion
			return d_rgb + s_rgb - 2.0 * d_rgb * s_rgb;
		}
		case 12u: { // hue
			return set_lum(set_sat(s_rgb, sat(d_rgb)), lum(d_rgb));
		}
		case 13u: { // saturation
			return set_lum(set_sat(d_rgb, sat(s_rgb)), lum(d_rgb));
		}
		case 14u: { // color
			return set_lum(s_rgb, lum(d_rgb));
		}
		case 15u: { // luminosity
			return set_lum(d_rgb, lum(s_rgb));
		}
		default: { // normal / source-over
			return s_rgb;
		}
	}
}

fn compositeLayer(dst: vec4<f32>, src: vec4<f32>, blendMode: u32) -> vec4<f32> {
	let sa = clamp(src.a, 0.0, 1.0);
	if (sa <= 0.0001) {
		return dst;
	}
	let da = clamp(dst.a, 0.0, 1.0);
	if (da <= 0.0001) {
		return src;
	}

	switch (blendMode) {
		case 16u: { return dst * sa; } // mask-in / destination-in
		case 17u: { return dst * (1.0 - sa); } // mask-out / destination-out
		case 18u: { return src * da; } // source-in
		case 19u: { return src * (1.0 - da); } // source-out
		case 20u: { return src * da + dst * (1.0 - sa); } // source-atop
		case 21u: { return dst + src * (1.0 - da); } // destination-over
		case 22u: { return dst * sa + src * (1.0 - da); } // destination-atop
		case 23u: { return src + dst; } // lighter / add
		case 24u: { return src; } // copy
		case 25u: { return src * (1.0 - da) + dst * (1.0 - sa); } // xor
		default: {}
	}

	let b_rgb = blendRgb(dst.rgb, src.rgb, blendMode);
	let out_a = sa + da * (1.0 - sa);
	let out_rgb = select(
		((1.0 - da) * src.rgb + (1.0 - sa) * dst.rgb + sa * da * b_rgb) / max(out_a, 1e-5),
		b_rgb,
		out_a <= 1e-4
	);

	return vec4<f32>(out_rgb, out_a);
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	let dimensions = vec2<f32>(textureDimensions(tex));
	let texelSize = 1.0 / max(dimensions, vec2<f32>(1.0, 1.0));
	let origColor = textureSampleLevel(tex, samp, in.uv, 0.0);
	let origA = origColor.a;

	var result = vec4<f32>(0.0);

	// =========================================================================
	// 1. DROP SHADOW (Bottom Layer)
	// =========================================================================
	if (u.dropShadowParams.x > 0.5) {
		let opacity = u.dropShadowParams.y;
		let angle = u.dropShadowParams.z;
		let distance = u.dropShadowParams.w;
		let spread = u.dropShadowParams2.x;
		let size = u.dropShadowParams2.y;
		let blendMode = u32(u.dropShadowParams2.z);

		let shadowOffset = vec2<f32>(-cos(angle), sin(angle)) * distance * texelSize;
		let shadowCenterUv = in.uv - shadowOffset;

		var shadowAccum = 0.0;
		var shadowWeightSum = 0.0;

		let sigma = max(0.5, size * 0.4);
		let sampleRadius = min(i32(ceil(size)), 24);

		if (size <= 0.5) {
			shadowAccum = sampleAlpha(shadowCenterUv);
			shadowWeightSum = 1.0;
		} else {
			let stepVal = max(1, sampleRadius / 8);
			for (var y = -sampleRadius; y <= sampleRadius; y += stepVal) {
				for (var x = -sampleRadius; x <= sampleRadius; x += stepVal) {
					let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
					let distSq = f32(x * x + y * y);
					let weight = exp(-0.5 * distSq / (sigma * sigma));
					shadowAccum += sampleAlpha(shadowCenterUv + offset) * weight;
					shadowWeightSum += weight;
				}
			}
		}

		let blurredShadow = shadowAccum / max(shadowWeightSum, 1e-4);
		let spreadFactor = spread / 100.0;
		let finalShadowAlpha = clamp(blurredShadow / max(1.0 - spreadFactor * 0.95, 0.01), 0.0, 1.0) * opacity;

		if (finalShadowAlpha > 0.001) {
			let shadowCol = vec4<f32>(u.dropShadowColor.rgb, finalShadowAlpha);
			result = compositeLayer(result, shadowCol, blendMode);
		}
	}

	// =========================================================================
	// 2. OUTER GLOW
	// =========================================================================
	if (u.outerGlowParams.x > 0.5) {
		let opacity = u.outerGlowParams.y;
		let size = u.outerGlowParams.z;
		let spread = u.outerGlowParams.w;
		let blendMode = u32(u.outerGlowParams2.x);

		var glowAccum = 0.0;
		var glowWeightSum = 0.0;
		let sigma = max(0.5, size * 0.4);
		let sampleRadius = min(i32(ceil(size)), 24);

		if (size <= 0.5) {
			glowAccum = origA;
			glowWeightSum = 1.0;
		} else {
			let stepVal = max(1, sampleRadius / 8);
			for (var y = -sampleRadius; y <= sampleRadius; y += stepVal) {
				for (var x = -sampleRadius; x <= sampleRadius; x += stepVal) {
					let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
					let distSq = f32(x * x + y * y);
					let weight = exp(-0.5 * distSq / (sigma * sigma));
					glowAccum += sampleAlpha(in.uv + offset) * weight;
					glowWeightSum += weight;
				}
			}
		}

		let blurredGlow = glowAccum / max(glowWeightSum, 1e-4);
		let spreadFactor = spread / 100.0;
		let spreadGlow = clamp(blurredGlow / max(1.0 - spreadFactor * 0.95, 0.01), 0.0, 1.0);
		let finalGlowAlpha = max(0.0, spreadGlow - origA) * opacity;

		if (finalGlowAlpha > 0.001) {
			let glowCol = vec4<f32>(u.outerGlowColor.rgb, finalGlowAlpha);
			result = compositeLayer(result, glowCol, blendMode);
		}
	}

	// =========================================================================
	// 3. OUTSIDE STROKE
	// =========================================================================
	if (u.strokeParams.x > 0.5 && u.strokeParams.z < 0.5) { // position == 0: outside
		let size = u.strokeParams.y;
		let opacity = u.strokeParams.w;
		let blendMode = u32(u.strokeParams2.x);

		var maxAlpha = 0.0;
		let sampleRadius = min(i32(ceil(size)), 24);
		let sizeSq = size * size;

		for (var y = -sampleRadius; y <= sampleRadius; y++) {
			for (var x = -sampleRadius; x <= sampleRadius; x++) {
				let distSq = f32(x * x + y * y);
				if (distSq <= sizeSq) {
					let sAlpha = sampleAlpha(in.uv + vec2<f32>(f32(x), f32(y)) * texelSize);
					maxAlpha = max(maxAlpha, sAlpha);
				}
			}
		}

		let strokeAlpha = clamp(maxAlpha - origA, 0.0, 1.0) * opacity;
		if (strokeAlpha > 0.001) {
			let strokeCol = vec4<f32>(u.strokeColor.rgb, strokeAlpha);
			result = compositeLayer(result, strokeCol, blendMode);
		}
	}

	// =========================================================================
	// 4. BASE IMAGE LAYER (with Color Overlay, Bevel & Emboss, Inner Glow/Shadow)
	// =========================================================================
	if (origA > 0.001) {
		var baseRgb = origColor.rgb;

		// Color Overlay
		if (u.colorOverlayParams.x > 0.5) {
			let overlayOpacity = u.colorOverlayParams.y;
			let overlayBlendMode = u32(u.colorOverlayParams.z);
			let blendedOverlay = blendRgb(baseRgb, u.colorOverlayColor.rgb, overlayBlendMode);
			baseRgb = mix(baseRgb, blendedOverlay, overlayOpacity);
		}

		// Bevel & Emboss
		if (u.bevelParams1.x > 0.5) {
			let style = u.bevelParams1.y;
			let technique = u.bevelParams1.z;
			let depth = u.bevelParams1.w / 100.0;
			let direction = u.bevelParams2.x;
			let bevelSize = max(0.5, u.bevelParams2.y);
			let soften = u.bevelParams2.z;
			let lightAngle = u.bevelParams2.w;
			let lightAltitude = u.bevelParams3.x;
			let hlOpacity = u.bevelParams3.y;
			let shOpacity = u.bevelParams3.z;

			let lightDir = normalize(vec3<f32>(
				-cos(lightAngle) * cos(lightAltitude),
				sin(lightAngle) * cos(lightAltitude),
				sin(lightAltitude)
			));

			let stepSize = max(1.0, bevelSize * 0.5 + soften) * texelSize;
			let aL = sampleAlpha(in.uv - vec2<f32>(stepSize.x, 0.0));
			let aR = sampleAlpha(in.uv + vec2<f32>(stepSize.x, 0.0));
			let aT = sampleAlpha(in.uv - vec2<f32>(0.0, stepSize.y));
			let aB = sampleAlpha(in.uv + vec2<f32>(0.0, stepSize.y));

			var dx = (aR - aL) * depth * direction;
			var dy = (aB - aT) * depth * direction;

			if (technique > 0.5) { // ChiselHard or ChiselSoft
				let rampFactor = select(2.0, 1.5, technique > 1.5);
				dx = clamp(dx * rampFactor, -1.0, 1.0);
				dy = clamp(dy * rampFactor, -1.0, 1.0);
			}

			let normal = normalize(vec3<f32>(-dx, -dy, 1.0));
			let nDotL = dot(normal, lightDir);

			let highlightAmount = max(0.0, nDotL) * hlOpacity;
			let shadowAmount = max(0.0, -nDotL) * shOpacity;

			let hlColor = mix(baseRgb, u.bevelHighlightColor.rgb + baseRgb, highlightAmount);
			let shColor = mix(baseRgb, baseRgb * (1.0 - shadowAmount) + u.bevelShadowColor.rgb * shadowAmount, shadowAmount);
			baseRgb = mix(shColor, hlColor, clamp(nDotL * 0.5 + 0.5, 0.0, 1.0));
		}

		// Inner Glow
		if (u.innerGlowParams.x > 0.5) {
			let igOpacity = u.innerGlowParams.y;
			let igSize = u.innerGlowParams.z;
			let igSpread = u.innerGlowParams.w;
			let igBlendMode = u32(u.innerGlowParams2.x);

			var innerAccum = 0.0;
			var innerWeight = 0.0;
			let sigma = max(0.5, igSize * 0.4);
			let sampleRadius = min(i32(ceil(igSize)), 16);
			let stepVal = max(1, sampleRadius / 6);

			for (var y = -sampleRadius; y <= sampleRadius; y += stepVal) {
				for (var x = -sampleRadius; x <= sampleRadius; x += stepVal) {
					let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
					let weight = exp(-0.5 * f32(x * x + y * y) / (sigma * sigma));
					innerAccum += sampleAlpha(in.uv + offset) * weight;
					innerWeight += weight;
				}
			}

			let blurredInner = innerAccum / max(innerWeight, 1e-4);
			let innerGlowMask = max(0.0, origA - blurredInner);
			let spreadFactor = igSpread / 100.0;
			let finalInnerGlowAlpha = clamp(innerGlowMask / max(1.0 - spreadFactor * 0.95, 0.01), 0.0, 1.0) * igOpacity;

			if (finalInnerGlowAlpha > 0.001) {
				let igBlended = blendRgb(baseRgb, u.innerGlowColor.rgb, igBlendMode);
				baseRgb = mix(baseRgb, igBlended, finalInnerGlowAlpha);
			}
		}

		// Inner Shadow
		if (u.innerShadowParams.x > 0.5) {
			let isOpacity = u.innerShadowParams.y;
			let isAngle = u.innerShadowParams.z;
			let isDistance = u.innerShadowParams.w;
			let isChoke = u.innerShadowParams2.x;
			let isSize = u.innerShadowParams2.y;
			let isBlendMode = u32(u.innerShadowParams2.z);

			let isOffset = vec2<f32>(-cos(isAngle), sin(isAngle)) * isDistance * texelSize;
			let shiftedA = sampleAlpha(in.uv + isOffset);

			var isAccum = 0.0;
			var isWeight = 0.0;
			let sigma = max(0.5, isSize * 0.4);
			let sampleRadius = min(i32(ceil(isSize)), 16);
			let stepVal = max(1, sampleRadius / 6);

			for (var y = -sampleRadius; y <= sampleRadius; y += stepVal) {
				for (var x = -sampleRadius; x <= sampleRadius; x += stepVal) {
					let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
					let weight = exp(-0.5 * f32(x * x + y * y) / (sigma * sigma));
					let sShifted = sampleAlpha(in.uv + isOffset + offset);
					let sOrig = sampleAlpha(in.uv + offset);
					isAccum += max(0.0, sOrig - sShifted) * weight;
					isWeight += weight;
				}
			}

			let blurredIS = isAccum / max(isWeight, 1e-4);
			let chokeFactor = isChoke / 100.0;
			let finalISAlpha = clamp(blurredIS / max(1.0 - chokeFactor * 0.95, 0.01), 0.0, 1.0) * isOpacity;

			if (finalISAlpha > 0.001) {
				let isBlended = blendRgb(baseRgb, u.innerShadowColor.rgb, isBlendMode);
				baseRgb = mix(baseRgb, isBlended, finalISAlpha);
			}
		}

		// Inside Stroke
		if (u.strokeParams.x > 0.5 && u.strokeParams.z > 1.5) { // position == 2: inside
			let size = u.strokeParams.y;
			let opacity = u.strokeParams.w;
			let blendMode = u32(u.strokeParams2.x);

			var minAlpha = 1.0;
			let sampleRadius = min(i32(ceil(size)), 24);
			let sizeSq = size * size;

			for (var y = -sampleRadius; y <= sampleRadius; y++) {
				for (var x = -sampleRadius; x <= sampleRadius; x++) {
					let distSq = f32(x * x + y * y);
					if (distSq <= sizeSq) {
						let sAlpha = sampleAlpha(in.uv + vec2<f32>(f32(x), f32(y)) * texelSize);
						minAlpha = min(minAlpha, sAlpha);
					}
				}
			}

			let insideStrokeAlpha = clamp(origA - minAlpha, 0.0, 1.0) * opacity;
			if (insideStrokeAlpha > 0.001) {
				let sBlended = blendRgb(baseRgb, u.strokeColor.rgb, blendMode);
				baseRgb = mix(baseRgb, sBlended, insideStrokeAlpha);
			}
		}

		let baseLayer = vec4<f32>(baseRgb, origA);
		result = compositeLayer(result, baseLayer, 0u);
	}

	// =========================================================================
	// 5. CENTER STROKE
	// =========================================================================
	if (u.strokeParams.x > 0.5 && u.strokeParams.z >= 0.5 && u.strokeParams.z <= 1.5) { // position == 1: center
		let size = u.strokeParams.y;
		let opacity = u.strokeParams.w;
		let blendMode = u32(u.strokeParams2.x);

		var maxAlpha = 0.0;
		var minAlpha = 1.0;
		let halfSize = max(0.5, size * 0.5);
		let sampleRadius = min(i32(ceil(halfSize)), 24);
		let halfSizeSq = halfSize * halfSize;

		for (var y = -sampleRadius; y <= sampleRadius; y++) {
			for (var x = -sampleRadius; x <= sampleRadius; x++) {
				let distSq = f32(x * x + y * y);
				if (distSq <= halfSizeSq) {
					let sAlpha = sampleAlpha(in.uv + vec2<f32>(f32(x), f32(y)) * texelSize);
					maxAlpha = max(maxAlpha, sAlpha);
					minAlpha = min(minAlpha, sAlpha);
				}
			}
		}

		let centerStrokeAlpha = clamp(maxAlpha - minAlpha, 0.0, 1.0) * opacity;
		if (centerStrokeAlpha > 0.001) {
			let strokeCol = vec4<f32>(u.strokeColor.rgb, centerStrokeAlpha);
			result = compositeLayer(result, strokeCol, blendMode);
		}
	}

	// Output premultiplied alpha for QuadPipeline / WebGPU rendering
	return vec4<f32>(result.rgb * result.a, result.a);
}
`;

interface LayerStyleResources {
	pipeline: GPURenderPipeline;
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
}

const resourcesCache = new WeakMap<GPUDevice, LayerStyleResources>();

function getLayerStyleResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): LayerStyleResources {
	let res = resourcesCache.get(device);
	if (res) return res;

	const module = device.createShaderModule({
		code: WGSL_LAYER_STYLE_SHADER,
	});

	const uniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const textureLayout = device.createBindGroupLayout({
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
		],
	});

	const pipelineLayout = device.createPipelineLayout({
		bindGroupLayouts: [uniformLayout, textureLayout],
	});

	const pipeline = device.createRenderPipeline({
		layout: pipelineLayout,
		vertex: {
			module,
			entryPoint: "vs",
		},
		fragment: {
			module,
			entryPoint: "fs",
			targets: [
				{
					format,
					blend: {
						color: {
							srcFactor: "one",
							dstFactor: "one-minus-src-alpha",
							operation: "add",
						},
						alpha: {
							srcFactor: "one",
							dstFactor: "one-minus-src-alpha",
							operation: "add",
						},
					},
				},
			],
		},
		primitive: {
			topology: "triangle-strip",
		},
	});

	res = { pipeline, uniformLayout, textureLayout };
	resourcesCache.set(device, res);
	return res;
}

const uniformBufferData = new Float32Array(88);

export const WebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as unknown as
		| LayerStyleOp
		| undefined;
	if (op?.op !== "LayerStyle" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const elapsedSeconds =
		props.elapsedMs !== undefined
			? props.elapsedMs / 1000
			: (props.frame ?? 0) / (props.fps || 30);

	// Resolve connected signal or numeric inputs
	const resolveField = (
		handleId: string | null | undefined,
		fallbackVal: number,
		clampMin = 0,
		clampMax = 1000,
	): number => {
		if (handleId && op.inputs?.[handleId]?.connectionValid) {
			const outputItem = op.inputs[handleId].outputItem;
			if (!outputItem)
				return Math.max(clampMin, Math.min(clampMax, fallbackVal));

			if (outputItem.type === "Number") {
				const numVal =
					typeof outputItem.data === "number"
						? outputItem.data
						: ((outputItem.data as { value?: number })?.value ?? fallbackVal);
				return Math.max(clampMin, Math.min(clampMax, numVal));
			}

			if (outputItem.type === "Signal") {
				const data = outputItem.data as
					| {
							value?: number;
							amplitude?: number;
							frequency?: number;
							offset?: number;
							phase?: number;
					  }
					| number
					| null;

				if (typeof data === "number") {
					return Math.max(clampMin, Math.min(clampMax, data));
				}
				if (data && typeof data === "object") {
					if (typeof data.value === "number") {
						return Math.max(clampMin, Math.min(clampMax, data.value));
					}
					const amp = typeof data.amplitude === "number" ? data.amplitude : 1;
					const freq = typeof data.frequency === "number" ? data.frequency : 1;
					const phase = typeof data.phase === "number" ? data.phase : 0;
					const offset =
						typeof data.offset === "number" ? data.offset : fallbackVal;
					const t = elapsedSeconds;
					const computed =
						offset + amp * Math.sin(2 * Math.PI * freq * t + phase);
					return Math.max(clampMin, Math.min(clampMax, computed));
				}
			}
		}
		return Math.max(clampMin, Math.min(clampMax, fallbackVal));
	};

	// 1. Render child media into temporary texture at its natural size and draw centered with padding
	const padding = computeLayerStylePadding(op);
	const padX = padding.padX;
	const padY = padding.padY;

	const childW = Math.max(1, width - padX * 2);
	const childH = Math.max(1, height - padY * 2);

	const childTex = ctx.renderer.getTemporaryTexture(childW, childH, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const childView = childTex.createView();

	const childPass = ctx.renderer.beginFrame(
		encoder,
		childView,
		{ r: 0, g: 0, b: 0, a: 0 },
		childW,
		childH,
		"clear",
	);
	childPass.end();

	await drawChild(
		childMedia,
		{
			...props,
			virtualMedia: childMedia,
			containerWidth: childW,
			containerHeight: childH,
		},
		childView,
		childTex,
		childW,
		childH,
	);

	const inputTex = ctx.renderer.getTemporaryTexture(width, height, [
		childTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);
	const inputView = inputTex.createView();

	const inputPass = ctx.renderer.beginFrame(
		encoder,
		inputView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);

	ctx.renderer.drawTexture(
		inputPass,
		childTex,
		{ x: padX, y: padY, width: childW, height: childH },
		{ opacity: 1 },
	);
	inputPass.end();

	// 2. Fetch resources & pack uniform buffer
	const { pipeline, uniformLayout, textureLayout } = getLayerStyleResources(
		ctx.device,
		ctx.renderer.format,
	);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const ds = op.dropShadow ?? {};
	const is = op.innerShadow ?? {};
	const og = op.outerGlow ?? {};
	const ig = op.innerGlow ?? {};
	const st = op.stroke ?? {};
	const be = op.bevelEmboss ?? {};
	const co = op.colorOverlay ?? {};

	const dsCol = hexToRgba(ds.color ?? "#000000");
	const dsOpacity = resolveField(
		op.dropShadowOpacityHandleId,
		ds.opacity ?? 0.75,
		0,
		1,
	);
	const dsAngle =
		(resolveField(op.dropShadowAngleHandleId, ds.angle ?? 120, 0, 360) *
			Math.PI) /
		180;
	const dsDist = resolveField(
		op.dropShadowDistanceHandleId,
		ds.distance ?? 10,
		0,
		500,
	);
	const dsSpread = resolveField(
		op.dropShadowSpreadHandleId,
		ds.spread ?? 0,
		0,
		100,
	);
	const dsSize = resolveField(op.dropShadowSizeHandleId, ds.size ?? 10, 0, 250);
	const dsBlend = BLEND_MODE_MAP[ds.blendMode ?? "multiply"] ?? 1;

	const isCol = hexToRgba(is.color ?? "#000000");
	const isOpacity = resolveField(
		op.innerShadowOpacityHandleId,
		is.opacity ?? 0.75,
		0,
		1,
	);
	const isAngle =
		(resolveField(op.innerShadowAngleHandleId, is.angle ?? 120, 0, 360) *
			Math.PI) /
		180;
	const isDist = resolveField(
		op.innerShadowDistanceHandleId,
		is.distance ?? 5,
		0,
		500,
	);
	const isChoke = resolveField(
		op.innerShadowChokeHandleId,
		is.choke ?? 0,
		0,
		100,
	);
	const isSize = resolveField(op.innerShadowSizeHandleId, is.size ?? 5, 0, 250);
	const isBlend = BLEND_MODE_MAP[is.blendMode ?? "multiply"] ?? 1;

	const ogCol = hexToRgba(og.color ?? "#ffffff");
	const ogOpacity = resolveField(
		op.outerGlowOpacityHandleId,
		og.opacity ?? 0.75,
		0,
		1,
	);
	const ogSize = resolveField(op.outerGlowSizeHandleId, og.size ?? 15, 0, 250);
	const ogSpread = resolveField(
		op.outerGlowSpreadHandleId,
		og.spread ?? 0,
		0,
		100,
	);
	const ogBlend = BLEND_MODE_MAP[og.blendMode ?? "screen"] ?? 2;

	const igCol = hexToRgba(ig.color ?? "#ffffff");
	const igOpacity = resolveField(
		op.innerGlowOpacityHandleId,
		ig.opacity ?? 0.75,
		0,
		1,
	);
	const igSize = resolveField(op.innerGlowSizeHandleId, ig.size ?? 15, 0, 250);
	const igSpread = resolveField(
		op.innerGlowSpreadHandleId,
		ig.spread ?? 0,
		0,
		100,
	);
	const igBlend = BLEND_MODE_MAP[ig.blendMode ?? "screen"] ?? 2;

	const stCol = hexToRgba(st.color ?? "#ffffff");
	const stSize = resolveField(op.strokeSizeHandleId, st.size ?? 2, 0, 100);
	const stPos = STROKE_POS_MAP[st.position ?? "outside"] ?? 0;
	const stOpacity = resolveField(
		op.strokeOpacityHandleId,
		st.opacity ?? 1.0,
		0,
		1,
	);
	const stBlend = BLEND_MODE_MAP[st.blendMode ?? "normal"] ?? 0;

	const beHlCol = hexToRgba(be.highlightColor ?? "#ffffff");
	const beShCol = hexToRgba(be.shadowColor ?? "#000000");
	const beStyle = BEVEL_STYLE_MAP[be.style ?? "InnerBevel"] ?? 0;
	const beTech = BEVEL_TECHNIQUE_MAP[be.technique ?? "Smooth"] ?? 0;
	const beDepth = resolveField(
		op.bevelEmbossDepthHandleId,
		be.depth ?? 100,
		1,
		1000,
	);
	const beDir = be.direction === "Down" ? -1.0 : 1.0;
	const beSize = resolveField(op.bevelEmbossSizeHandleId, be.size ?? 5, 0, 250);
	const beSoften = resolveField(
		op.bevelEmbossSoftenHandleId,
		be.soften ?? 0,
		0,
		50,
	);
	const beAngle =
		(resolveField(op.bevelEmbossAngleHandleId, be.angle ?? 120, 0, 360) *
			Math.PI) /
		180;
	const beAltitude =
		(resolveField(op.bevelEmbossAltitudeHandleId, be.altitude ?? 30, 0, 90) *
			Math.PI) /
		180;
	const beHlOpacity = resolveField(
		op.bevelEmbossHighlightOpacityHandleId,
		be.highlightOpacity ?? 0.75,
		0,
		1,
	);
	const beShOpacity = resolveField(
		op.bevelEmbossShadowOpacityHandleId,
		be.shadowOpacity ?? 0.75,
		0,
		1,
	);

	const coCol = hexToRgba(co.color ?? "#ff0000");
	const coOpacity = resolveField(
		op.colorOverlayOpacityHandleId,
		co.opacity ?? 1.0,
		0,
		1,
	);
	const coBlend = BLEND_MODE_MAP[co.blendMode ?? "normal"] ?? 0;

	uniformBufferData.fill(0);

	// Drop Shadow (0..11)
	uniformBufferData[0] = dsCol[0];
	uniformBufferData[1] = dsCol[1];
	uniformBufferData[2] = dsCol[2];
	uniformBufferData[3] = dsCol[3];
	uniformBufferData[4] = ds.enabled ? 1.0 : 0.0;
	uniformBufferData[5] = dsOpacity;
	uniformBufferData[6] = dsAngle;
	uniformBufferData[7] = dsDist;
	uniformBufferData[8] = dsSpread;
	uniformBufferData[9] = dsSize;
	uniformBufferData[10] = dsBlend;
	uniformBufferData[11] = 0;

	// Inner Shadow (12..23)
	uniformBufferData[12] = isCol[0];
	uniformBufferData[13] = isCol[1];
	uniformBufferData[14] = isCol[2];
	uniformBufferData[15] = isCol[3];
	uniformBufferData[16] = is.enabled ? 1.0 : 0.0;
	uniformBufferData[17] = isOpacity;
	uniformBufferData[18] = isAngle;
	uniformBufferData[19] = isDist;
	uniformBufferData[20] = isChoke;
	uniformBufferData[21] = isSize;
	uniformBufferData[22] = isBlend;
	uniformBufferData[23] = 0;

	// Outer Glow (24..35)
	uniformBufferData[24] = ogCol[0];
	uniformBufferData[25] = ogCol[1];
	uniformBufferData[26] = ogCol[2];
	uniformBufferData[27] = ogCol[3];
	uniformBufferData[28] = og.enabled ? 1.0 : 0.0;
	uniformBufferData[29] = ogOpacity;
	uniformBufferData[30] = ogSize;
	uniformBufferData[31] = ogSpread;
	uniformBufferData[32] = ogBlend;
	uniformBufferData[33] = 0;
	uniformBufferData[34] = 0;
	uniformBufferData[35] = 0;

	// Inner Glow (36..47)
	uniformBufferData[36] = igCol[0];
	uniformBufferData[37] = igCol[1];
	uniformBufferData[38] = igCol[2];
	uniformBufferData[39] = igCol[3];
	uniformBufferData[40] = ig.enabled ? 1.0 : 0.0;
	uniformBufferData[41] = igOpacity;
	uniformBufferData[42] = igSize;
	uniformBufferData[43] = igSpread;
	uniformBufferData[44] = igBlend;
	uniformBufferData[45] = 0;
	uniformBufferData[46] = 0;
	uniformBufferData[47] = 0;

	// Stroke (48..59)
	uniformBufferData[48] = stCol[0];
	uniformBufferData[49] = stCol[1];
	uniformBufferData[50] = stCol[2];
	uniformBufferData[51] = stCol[3];
	uniformBufferData[52] = st.enabled ? 1.0 : 0.0;
	uniformBufferData[53] = stSize;
	uniformBufferData[54] = stPos;
	uniformBufferData[55] = stOpacity;
	uniformBufferData[56] = stBlend;
	uniformBufferData[57] = 0;
	uniformBufferData[58] = 0;
	uniformBufferData[59] = 0;

	// Bevel & Emboss (60..79)
	uniformBufferData[60] = beHlCol[0];
	uniformBufferData[61] = beHlCol[1];
	uniformBufferData[62] = beHlCol[2];
	uniformBufferData[63] = beHlCol[3];
	uniformBufferData[64] = beShCol[0];
	uniformBufferData[65] = beShCol[1];
	uniformBufferData[66] = beShCol[2];
	uniformBufferData[67] = beShCol[3];
	uniformBufferData[68] = be.enabled ? 1.0 : 0.0;
	uniformBufferData[69] = beStyle;
	uniformBufferData[70] = beTech;
	uniformBufferData[71] = beDepth;
	uniformBufferData[72] = beDir;
	uniformBufferData[73] = beSize;
	uniformBufferData[74] = beSoften;
	uniformBufferData[75] = beAngle;
	uniformBufferData[76] = beAltitude;
	uniformBufferData[77] = beHlOpacity;
	uniformBufferData[78] = beShOpacity;
	uniformBufferData[79] = 0;

	// Color Overlay (80..87)
	uniformBufferData[80] = coCol[0];
	uniformBufferData[81] = coCol[1];
	uniformBufferData[82] = coCol[2];
	uniformBufferData[83] = coCol[3];
	uniformBufferData[84] = co.enabled ? 1.0 : 0.0;
	uniformBufferData[85] = coOpacity;
	uniformBufferData[86] = coBlend;
	uniformBufferData[87] = 0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformBufferData);

	const uBindGroup = ctx.device.createBindGroup({
		layout: uniformLayout,
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	const tBindGroup = ctx.device.createBindGroup({
		layout: textureLayout,
		entries: [
			{ binding: 0, resource: inputView },
			{ binding: 1, resource: sampler },
		],
	});

	// Render into targetView
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		inputTex,
		childTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	const renderPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	renderPass.setPipeline(pipeline);
	renderPass.setBindGroup(0, uBindGroup);
	renderPass.setBindGroup(1, tBindGroup);
	renderPass.draw(4);
	renderPass.end();

	// Blit to targetView
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
		outTex,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: op.opacity ?? 1.0 },
	);

	args.pass = finalPass;
};
