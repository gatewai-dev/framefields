/**
 * Slug glyphs drawn straight into the 3D scene: each glyph quad is placed on
 * its layer's plane by the camera's view-projection, and coverage is solved
 * per screen pixel from the outline. Text stays sharp at any distance or
 * angle, with no intermediate texture to magnify or minify.
 */

import { lighting3dWgsl } from "./lighting3d.js";
import { slugCoverageWgsl } from "./slug.js";

export const slug3dWgsl = `
${lighting3dWgsl}

struct TextModelUniforms {
	modelMatrix    : mat4x4<f32>, // paragraph px -> world
	normalMatrix   : mat4x4<f32>,
	params         : vec4<f32>, // x = opacity, y = slant, z = twoSided (1.0 = yes), w = pull toward the eye
	materialParams : vec4<f32>, // x = shininess, y = specularIntensity, z = ambientIntensity, w = materialMode (0=unlit, 1=lit)
};

@group(0) @binding(0) var<uniform> cam    : CameraUniforms;
@group(1) @binding(0) var<uniform> model  : TextModelUniforms;
@group(2) @binding(0) var curvesTex       : texture_2d<f32>;
@group(2) @binding(1) var bandsTex        : texture_2d<u32>;
@group(3) @binding(0) var<uniform> lights : LightsUniforms;

${slugCoverageWgsl}

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
	@location(1) @interpolate(flat) glyphScale : vec2<f32>,
	@location(2) @interpolate(flat) bandScale  : vec2<f32>,
	@location(3) @interpolate(flat) bandMax    : vec2<u32>,
	@location(4) @interpolate(flat) bandsTexCoords : vec2<u32>,
	@location(5) color     : vec4<f32>,
	@location(6) @interpolate(flat) fx : vec4<f32>, // x = blur, y = chromatic shift, z = dissolve, w = vfx
	@location(7) worldPos  : vec3<f32>,
	@location(8) @interpolate(flat) worldNormal : vec3<f32>,
	@location(9) linearDepth : f32,
};

var<private> pos : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
	vec2<f32>(-1.0, -1.0),
	vec2<f32>(1.0, 1.0),
	vec2<f32>(-1.0, 1.0),
	vec2<f32>(-1.0, -1.0),
	vec2<f32>(1.0, -1.0),
	vec2<f32>(1.0, 1.0)
);

// Screen pixels moved per paragraph unit along the axis whose clip-space step
// is dc, at clip position c: the derivative of the perspective divide.
fn pixelsPerUnitAlong(c: vec4<f32>, dc: vec4<f32>) -> vec2<f32> {
	let w = max(c.w, 1e-4);
	return (dc.xy * w - c.xy * dc.w) / (w * w) * 0.5 * cam.screenParams.xy;
}

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
	let origin = aScaleBias.zw + aAnim.zw;
	let slant = model.params.y;
	let rot = mat2x2<f32>(cos(angle), sin(angle), -sin(angle), cos(angle));
	let shear = mat2x2<f32>(1.0, 0.0, -slant, 1.0);
	let glyphToParagraph = rot * shear;

	let clipFromParagraph = cam.viewProjMatrix * model.modelMatrix;

	// Slug's dynamic dilation, under perspective: grow the quad by one screen
	// pixel so edge pixels whose centres fall just outside the outline's box
	// are still shaded. The pixel is measured at this corner through the
	// projection's Jacobian, along the paragraph direction that gets the fewest
	// pixels (its smallest singular value), so foreshortened sides are covered.
	let corner = origin + glyphToParagraph * (quad_pos * aScaleBias.xy * scale_mult);
	let cornerClip = clipFromParagraph * vec4<f32>(corner, 0.0, 1.0);
	let jx = pixelsPerUnitAlong(cornerClip, clipFromParagraph[0]);
	let jy = pixelsPerUnitAlong(cornerClip, clipFromParagraph[1]);
	let e = dot(jx, jx) + dot(jy, jy);
	let det = jx.x * jy.y - jx.y * jy.x;
	let minPixelsPerUnit = sqrt(max(0.5 * (e - sqrt(max(e * e - 4.0 * det * det, 0.0))), 0.0));
	let halfSize = max(abs(aScaleBias.xy * scale_mult), vec2<f32>(1e-4));
	// Bounded at three times the glyph: seen nearly edge-on a pixel spans
	// most of the paragraph, and the glyph is a sliver either way.
	let dilation = min(vec2<f32>(1.0 / max(minPixelsPerUnit, 1e-6)), halfSize * 2.0);
	let grow = vec2<f32>(1.0) + dilation / halfSize;

	let paragraphPos = origin + glyphToParagraph * (quad_pos * aScaleBias.xy * scale_mult * grow);
	let world4 = model.modelMatrix * vec4<f32>(paragraphPos, 0.0, 1.0);
	// Slide toward the eye along the view ray: the same pixel, a nearer depth.
	// Passes stacked on one plane (shadow, stroke, fill, a backdrop) resolve
	// by draw order instead of z-fighting.
	let world = world4.xyz + (cam.cameraPos.xyz - world4.xyz) * model.params.w;

	var out : VSOut;
	out.pos = cam.viewProjMatrix * vec4<f32>(world, 1.0);
	out.uv = vec2<f32>(
		quad_pos.x * grow.x * 0.5 + 0.5,
		1.0 - (quad_pos.y * grow.y * 0.5 + 0.5),
	);
	out.glyphScale = aGlyphBandScale.xy;
	out.bandScale = aGlyphBandScale.zw;
	out.bandMax = vec2<u32>(aBandMaxTexCoords.xy);
	out.bandsTexCoords = vec2<u32>(aBandMaxTexCoords.zw);
	out.color = aColor;
	out.fx = aExtraParams;
	out.worldPos = world4.xyz;
	out.worldNormal = normalize((model.normalMatrix * vec4<f32>(0.0, 0.0, -1.0, 0.0)).xyz);
	out.linearDepth = dot(world4.xyz - cam.cameraPos.xyz, cam.cameraDir.xyz);
	return out;
}

// Lit, premultiplied glyph colour; alpha 0 means discard.
fn shadeText(in : VSOut, fw : vec2<f32>) -> vec4<f32> {
	// One-sided text culls against its plane's normal, as one-sided quads do.
	if (model.params.z < 0.5 && dot(in.worldNormal, cam.cameraPos.xyz - in.worldPos) < 0.0) {
		return vec4<f32>(0.0);
	}
	let glyph = SlugGlyph(in.glyphScale, in.bandScale, in.bandMax, in.bandsTexCoords);
	let shaded = shadeSlugGlyph(
		in.uv,
		fw,
		in.pos.xy,
		glyph,
		in.color,
		model.params.x,
		in.fx.x,
		in.fx.y,
		in.fx.z,
	);
	if (shaded.a < 0.0001) {
		return vec4<f32>(0.0);
	}
	let lit = applyLighting3D(in.worldPos, in.worldNormal, shaded.rgb / shaded.a, model.materialParams);
	return vec4<f32>(lit * shaded.a, shaded.a);
}

@fragment fn fs_single(in : VSOut) -> @location(0) vec4<f32> {
	let fw = max(abs(dpdx(in.uv)) + abs(dpdy(in.uv)), vec2<f32>(0.000001));
	let color = shadeText(in, fw);
	if (color.a < 0.0001) {
		discard;
	}
	return color;
}

struct MrtOutput {
	@location(0) color : vec4<f32>,
	@location(1) depth : vec4<f32>,
};

@fragment fn fs_mrt(in : VSOut) -> MrtOutput {
	let fw = max(abs(dpdx(in.uv)) + abs(dpdy(in.uv)), vec2<f32>(0.000001));
	let color = shadeText(in, fw);
	if (color.a < 0.0001) {
		discard;
	}
	var out : MrtOutput;
	out.color = color;
	out.depth = vec4<f32>(in.linearDepth, 0.0, 0.0, 1.0);
	return out;
}
`;
