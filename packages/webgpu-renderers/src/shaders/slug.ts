/**
 * Slug glyph coverage (Lengyel, "GPU-Centered Font Rendering Directly from
 * Glyph Outlines", 2017), shared by the 2D and 3D text shaders. Coverage is
 * computed per screen pixel from the outline itself, so it stays crisp at any
 * scale or projection as long as the caller supplies the pixel footprint.
 *
 * The including shader declares `curvesTex : texture_2d<f32>` and
 * `bandsTex : texture_2d<u32>`.
 */
export const slugCoverageWgsl = `
struct SlugGlyph {
	glyphScale     : vec2<f32>,
	bandScale      : vec2<f32>,
	bandMax        : vec2<u32>,
	bandsTexCoords : vec2<u32>,
};

const epsilon : f32 = 0.0001;

// One quadratic curve against the ray from the sample toward +x. Returns the
// signed coverage (x) and the ray's weight (y): how close a crossing passes the
// sample, in pixels. A ray running along an edge never crosses it near the
// sample, weighs nothing, and so cannot impose its hard 0/1 answer.
fn TraceRayCurveH(p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, pixelsPerEm: f32) -> vec2<f32> {
	if (max(max(p1.x, p2.x), p3.x) * pixelsPerEm < -0.5) {
		return vec2<f32>(0.0);
	}

	var cond1: u32 = 0u;
	if (p1.y > 0.0) { cond1 = 2u; }
	var cond2: u32 = 0u;
	if (p2.y > 0.0) { cond2 = 4u; }
	var cond3: u32 = 0u;
	if (p3.y > 0.0) { cond3 = 8u; }

	let shift = cond1 + cond2 + cond3;
	let code = (0x2E74u >> shift) & 3u;
	if (code == 0u) {
		return vec2<f32>(0.0);
	}

	let a = p1 - p2 * 2.0 + p3;
	let b = p1 - p2;
	let c = p1.y;
	let ayr = 1.0 / a.y;
	let d = sqrt(max(b.y * b.y - a.y * c, 0.0));
	var t1 = (b.y - d) * ayr;
	var t2 = (b.y + d) * ayr;

	if (abs(a.y) < epsilon) {
		let val = c / (2.0 * b.y);
		t1 = val;
		t2 = val;
	}

	var result = vec2<f32>(0.0);

	if ((code & 1u) != 0u) {
		let x1 = ((a.x * t1 - b.x * 2.0) * t1 + p1.x) * pixelsPerEm;
		result.x = result.x + clamp(x1 + 0.5, 0.0, 1.0);
		result.y = max(result.y, clamp(1.0 - abs(x1) * 2.0, 0.0, 1.0));
	}

	if (code > 1u) {
		let x2 = ((a.x * t2 - b.x * 2.0) * t2 + p1.x) * pixelsPerEm;
		result.x = result.x - clamp(x2 + 0.5, 0.0, 1.0);
		result.y = max(result.y, clamp(1.0 - abs(x2) * 2.0, 0.0, 1.0));
	}

	return result;
}

fn TraceRayBandH(bandData: vec2<u32>, pixelsPerEm: f32, glyphScale: vec2<f32>, uv: vec2<f32>) -> vec2<f32> {
	var coverage = vec2<f32>(0.0);
	for (var curve: u32 = 0u; curve < bandData.x; curve = curve + 1u) {
		let curveOffset = bandData.y + curve;
		let coord = vec2<i32>(i32(curveOffset & 0xFFFu), i32(curveOffset >> 12u));
		let curveLoc = vec2<i32>(textureLoad(bandsTex, coord, 0).xy);

		let p12 = textureLoad(curvesTex, curveLoc, 0) / vec4<f32>(glyphScale, glyphScale) - vec4<f32>(uv, uv);
		let p3 = textureLoad(curvesTex, vec2<i32>(curveLoc.x + 1, curveLoc.y), 0).xy / glyphScale - uv;

		let max_x = max(max(p12.x, p12.z), p3.x);
		if (max_x * pixelsPerEm < -0.5) {
			break;
		}

		let hit = TraceRayCurveH(p12.xy, p12.zw, p3.xy, pixelsPerEm);
		coverage = vec2<f32>(coverage.x + hit.x, max(coverage.y, hit.y));
	}
	return coverage;
}

fn TraceRayBandV(bandData: vec2<u32>, pixelsPerEm: f32, glyphScale: vec2<f32>, uv: vec2<f32>) -> vec2<f32> {
	var coverage = vec2<f32>(0.0);
	for (var curve: u32 = 0u; curve < bandData.x; curve = curve + 1u) {
		let curveOffset = bandData.y + curve;
		let coord = vec2<i32>(i32(curveOffset & 0xFFFu), i32(curveOffset >> 12u));
		let curveLoc = vec2<i32>(textureLoad(bandsTex, coord, 0).xy);

		let p12 = textureLoad(curvesTex, curveLoc, 0) / vec4<f32>(glyphScale, glyphScale) - vec4<f32>(uv, uv);
		let p3 = textureLoad(curvesTex, vec2<i32>(curveLoc.x + 1, curveLoc.y), 0).xy / glyphScale - uv;

		let max_y = max(max(p12.y, p12.w), p3.y);
		if (max_y * pixelsPerEm < -0.5) {
			break;
		}

		let hit = TraceRayCurveH(p12.yx, p12.wz, p3.yx, pixelsPerEm);
		coverage = vec2<f32>(coverage.x + hit.x, max(coverage.y, hit.y));
	}
	return coverage;
}

fn sampleSlugCoverage(sampleUV: vec2<f32>, g: SlugGlyph, pixelsPerEm: vec2<f32>) -> f32 {
	let bandIndex = vec2<u32>(clamp(vec2<u32>(sampleUV * g.bandScale), vec2<u32>(0u), g.bandMax));
	let hBandOffset = g.bandsTexCoords.y * 4096u + g.bandsTexCoords.x + bandIndex.y;
	let hCoord = vec2<i32>(i32(hBandOffset & 0xFFFu), i32(hBandOffset >> 12u));
	let hBandData = textureLoad(bandsTex, hCoord, 0).xy;

	let vBandOffset = g.bandsTexCoords.y * 4096u + g.bandsTexCoords.x + g.bandMax.y + 1u + bandIndex.x;
	let vCoord = vec2<i32>(i32(vBandOffset & 0xFFFu), i32(vBandOffset >> 12u));
	let vBandData = textureLoad(bandsTex, vCoord, 0).xy;

	let x = TraceRayBandH(hBandData, pixelsPerEm.x, g.glyphScale, sampleUV);
	let y = TraceRayBandV(vBandData, pixelsPerEm.y, g.glyphScale, sampleUV);

	// Each ray's coverage counts by how near it crosses an edge; where neither
	// does (deep inside or outside), the smaller answer is the safe one.
	let covX = min(abs(x.x), 1.0);
	let covY = min(abs(y.x), 1.0);
	let weighted = (covX * x.y + covY * y.y) / max(x.y + y.y, 1.0 / 65536.0);
	return clamp(max(weighted, min(covX, covY)), 0.0, 1.0);
}

// The glyph's premultiplied colour at uv; alpha 0 means discard. fw is the
// pixel footprint in glyph uv, |d/dx| + |d/dy| (fwidth): the caller takes it in
// uniform control flow. On a turned or foreshortened glyph it is wider than one
// pixel along an axis, so that axis gets the soft ramp a box filter gives.
fn shadeSlugGlyph(
	uv: vec2<f32>,
	fw: vec2<f32>,
	fragXY: vec2<f32>,
	g: SlugGlyph,
	color: vec4<f32>,
	opacity: f32,
	blurAmount: f32,
	chromaticShift: f32,
	dissolveProgress: f32,
) -> vec4<f32> {
	if (dissolveProgress > 0.001) {
		let pCoord = uv * 320.0 + fragXY * 2.3;
		let pNoise = fract(sin(dot(pCoord, vec2<f32>(12.9898, 78.233))) * 43758.5453);
		if (pNoise < dissolveProgress) {
			return vec4<f32>(0.0);
		}
	}

	let pixelsPerEm = max(vec2<f32>(1.0) / fw, vec2<f32>(1.0));
	let ppem = min(pixelsPerEm.x, pixelsPerEm.y);
	let gain = mix(1.0, 1.25, clamp((48.0 - ppem) / 36.0, 0.0, 1.0));

	if (abs(chromaticShift) > 0.001) {
		let shiftUV = vec2<f32>(chromaticShift * 0.002, 0.0);
		let rCov = sampleSlugCoverage(uv + shiftUV, g, pixelsPerEm);
		let gCov = sampleSlugCoverage(uv, g, pixelsPerEm);
		let bCov = sampleSlugCoverage(uv - shiftUV, g, pixelsPerEm);

		let maxCov = max(max(rCov, gCov), bCov);
		let cov = pow(clamp(maxCov, 0.0, 1.0), 1.0 / gain);
		let alpha = color.a * opacity * cov;
		let finalR = color.r * pow(clamp(rCov, 0.0, 1.0), 1.0 / gain);
		let finalG = color.g * pow(clamp(gCov, 0.0, 1.0), 1.0 / gain);
		let finalB = color.b * pow(clamp(bCov, 0.0, 1.0), 1.0 / gain);
		return vec4<f32>(vec3<f32>(finalR, finalG, finalB) * (opacity * color.a), alpha);
	}

	var slugAlpha = 0.0;
	if (blurAmount > 0.01) {
		let step = fw * blurAmount * 0.3;
		for (var y_offset = -1.0; y_offset <= 1.0; y_offset = y_offset + 1.0) {
			for (var x_offset = -1.0; x_offset <= 1.0; x_offset = x_offset + 1.0) {
				let offset = vec2<f32>(x_offset, y_offset) * step;
				slugAlpha = slugAlpha + sampleSlugCoverage(uv + offset, g, pixelsPerEm);
			}
		}
		slugAlpha = slugAlpha / 9.0;
	} else {
		slugAlpha = sampleSlugCoverage(uv, g, pixelsPerEm);
	}

	let cov = pow(clamp(slugAlpha, 0.0, 1.0), 1.0 / gain);
	let alpha = color.a * opacity * cov;
	return vec4<f32>(color.rgb * alpha, alpha);
}
`;

export const slugWgsl = `
struct Uniforms {
	transformCol0 : vec4<f32>,
	transformCol1 : vec4<f32>,
	transformCol2 : vec4<f32>,
	params        : vec4<f32>, // x = opacity, y = surfaceWidth, z = surfaceHeight, w = slant
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(1) @binding(0) var curvesTex : texture_2d<f32>;
@group(1) @binding(1) var bandsTex : texture_2d<u32>;

${slugCoverageWgsl}

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
	@location(1) @interpolate(flat) glyphScale : vec2<f32>,
	@location(2) @interpolate(flat) bandScale  : vec2<f32>,
	@location(3) @interpolate(flat) bandMax    : vec2<u32>,
	@location(4) @interpolate(flat) bandsTexCoords : vec2<u32>,
	@location(5) color     : vec4<f32>,
	@location(6) @interpolate(flat) blurAmount : f32,
	@location(7) @interpolate(flat) chromaticShift : f32,
	@location(8) @interpolate(flat) dissolveProgress : f32,
	@location(9) @interpolate(flat) vfxParam : f32,
};

var<private> pos : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
	vec2<f32>(-1.0, -1.0),
	vec2<f32>(1.0, 1.0),
	vec2<f32>(-1.0, 1.0),
	vec2<f32>(-1.0, -1.0),
	vec2<f32>(1.0, -1.0),
	vec2<f32>(1.0, 1.0)
);

@vertex fn vs(
	@builtin(vertex_index) vertex_index : u32,
	@location(0) aScaleBias : vec4<f32>,
	@location(1) aGlyphBandScale : vec4<f32>,
	@location(2) aBandMaxTexCoords : vec4<f32>,
	@location(3) aAnim : vec4<f32>, // x = rotation, y = scale_mult, zw = translation
	@location(4) aColor : vec4<f32>,
	@location(5) aExtraParams : vec4<f32>,
) -> VSOut {
	let quad_pos = pos[vertex_index];

	let angle = aAnim.x;
	let scale_mult = aAnim.y;
	let translation = aAnim.zw;

	// Dilate the glyph's quad by one screen pixel each side (Slug's dynamic
	// dilation): coverage ramps half a pixel past the outline, and pixels whose
	// centres fall just outside the bounding box must still be shaded, or a
	// turned glyph's edges are cut into a staircase.
	let transform2 = mat2x2<f32>(u.transformCol0.xy, u.transformCol1.xy);
	let pixelsPerUnit = sqrt(max(abs(determinant(transform2)), 1e-8));
	let halfSize = max(abs(aScaleBias.xy * scale_mult), vec2<f32>(1e-4));
	let grow = vec2<f32>(1.0) + (1.0 / pixelsPerUnit) / halfSize;
	let uv = vec2<f32>(
		quad_pos.x * grow.x * 0.5 + 0.5,
		1.0 - (quad_pos.y * grow.y * 0.5 + 0.5),
	);

	let local_pos = quad_pos * aScaleBias.xy * scale_mult * grow;
	let slant = u.params.w;
	let slanted_pos = vec2<f32>(
		local_pos.x - local_pos.y * slant,
		local_pos.y
	);
	let rotated = vec2<f32>(
		slanted_pos.x * cos(angle) - slanted_pos.y * sin(angle),
		slanted_pos.x * sin(angle) + slanted_pos.y * cos(angle)
	);

	let transformed = rotated + aScaleBias.zw + translation;

	let transform = mat3x3<f32>(u.transformCol0.xyz, u.transformCol1.xyz, u.transformCol2.xyz);
	let p = transform * vec3<f32>(transformed, 1.0);

	let surfaceSize = u.params.yz;
	let clipX = (p.x / surfaceSize.x) * 2.0 - 1.0;
	let clipY = 1.0 - (p.y / surfaceSize.y) * 2.0;

	var out : VSOut;
	out.pos = vec4<f32>(clipX, clipY, 0.0, 1.0);
	out.uv = uv;
	out.glyphScale = aGlyphBandScale.xy;
	out.bandScale = aGlyphBandScale.zw;
	out.bandMax = vec2<u32>(aBandMaxTexCoords.xy);
	out.bandsTexCoords = vec2<u32>(aBandMaxTexCoords.zw);
	out.color = aColor;
	out.blurAmount = aExtraParams.x;
	out.chromaticShift = aExtraParams.y;
	out.dissolveProgress = aExtraParams.z;
	out.vfxParam = aExtraParams.w;

	return out;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let fw = max(abs(dpdx(in.uv)) + abs(dpdy(in.uv)), vec2<f32>(0.000001));
	let glyph = SlugGlyph(in.glyphScale, in.bandScale, in.bandMax, in.bandsTexCoords);
	let shaded = shadeSlugGlyph(
		in.uv,
		fw,
		in.pos.xy,
		glyph,
		in.color,
		u.params.x,
		in.blurAmount,
		in.chromaticShift,
		in.dissolveProgress,
	);
	if (shaded.a < 0.0001) {
		discard;
	}
	return shaded;
}
`;
