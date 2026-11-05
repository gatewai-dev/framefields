import type { ToonShading } from "@framefields/core";
import { parseColor } from "../color.js";
import type { Color } from "../renderer2d/index.js";

export interface IridescenceOptions {
	/** Thin-film interference blend intensity 0..1 (default 1 when object is passed). */
	intensity?: number;
	/** Thin-film thickness in nanometers 100..1000 (default 400). */
	thickness?: number;
	/** Thin-film refractive index 1.05..2.5 (default 1.3). */
	ior?: number;
}

export interface TriplanarOptions {
	/** Tiling scale (repeats per 256 world px, or raw UV/px if < 0.05; default 1). */
	scale?: number;
	/** Normal blend exponent across projection axes 1..16 (default 4). */
	sharpness?: number;
}

/** Physically based surface inputs every 3D draw (quad, text, mesh) accepts. */
export interface SurfaceParams {
	toon?: ToonShading;
	outline?: boolean;
	/** Microsurface roughness 0 (mirror) .. 1 (chalk). Physical scenes default to 0.5. */
	roughness?: number;
	/** 0 = dielectric (plastic, paint, wood), 1 = metal. */
	metallic?: number;
	/** Light the surface gives off (a CSS color), added on top of lighting. */
	emissive?: string | Color | [number, number, number];
	/** Emissive multiplier; values above 1 glow past white and feed bloom. Default 1. */
	emissiveIntensity?: number;
	/** Casts into a `castShadow` light's shadow map (meshes default on, quads off). */
	castShadow?: boolean;
	/** Secondary dielectric clearcoat/varnish lobe 0..1 (car paint, wet coats, polished lacquer). */
	clearcoat?: number;
	/** Roughness of the clearcoat layer 0..1 (default 0.08). */
	clearcoatRoughness?: number;
	/** Anisotropic GGX highlight stretch -1..1 (brushed metal, satin, hair; 0 = isotropic). */
	anisotropy?: number;
	/** Brush tangent rotation in degrees around the surface normal (default 0). */
	anisotropyRotation?: number;
	/** Subsurface wrap diffuse and translucent back-scattering 0..1 (wax, jade, skin, foliage). */
	subsurface?: number;
	/** Subsurface scatter & transmission tint color (default "#ff6b4a"). */
	subsurfaceColor?: string | Color | [number, number, number];
	/** Charlie cloth / velvet grazing retro-reflection lobe 0..1. */
	sheen?: number;
	/** Cloth sheen tint color (default "#ffffff"). */
	sheenColor?: string | Color | [number, number, number];
	/** Cloth sheen microfiber roughness 0.05..1 (default 0.5). */
	sheenRoughness?: number;
	/** Thin-film spectral iridescence 0..1 or `{ intensity, thickness, ior }`. */
	iridescence?: number | IridescenceOptions;
	/** Thin-film thickness in nanometers 100..1000 (default 400). */
	iridescenceThickness?: number;
	/** Thin-film refractive index 1.05..2.5 (default 1.3). */
	iridescenceIor?: number;
	/** Seamless world-space triplanar texture projection for UV-less or procedural meshes. */
	triplanar?: boolean | TriplanarOptions;
	/** World-space triplanar tiling scale (repeats per 256 world px; >0 enables triplanar). */
	triplanarScale?: number;
	/** World-space triplanar axis blend sharpness 1..16 (default 4). */
	triplanarSharpness?: number;
}

/** Shared model uniforms: PBR, emissive, three art-direction vec4s, and four Substrate multi-lobe vec4s. */
export const SURFACE_PARAMS_FLOATS = 36;

function parseRgbTriplet(
	input: string | Color | [number, number, number] | undefined,
	fallback: [number, number, number],
): [number, number, number] {
	if (input === undefined || input === null) return fallback;
	if (Array.isArray(input)) {
		return [
			input[0] ?? fallback[0],
			input[1] ?? fallback[1],
			input[2] ?? fallback[2],
		];
	}
	const c = parseColor(input as string | Color);
	return [c.r * c.a, c.g * c.a, c.b * c.a];
}

function resolveTriplanarParams(data: SurfaceParams): [number, number] {
	const tri = data.triplanar;
	const rawScale =
		data.triplanarScale ??
		(typeof tri === "object" && tri !== null
			? (tri.scale ?? 1)
			: tri === true
				? 1
				: 0);
	const sharpness = Math.max(
		1,
		Math.min(
			16,
			data.triplanarSharpness ??
				(typeof tri === "object" && tri !== null ? (tri.sharpness ?? 4) : 4),
		),
	);
	if (rawScale <= 0) return [0, sharpness];
	const uvFreq = rawScale < 0.05 ? rawScale : rawScale / 256;
	return [uvFreq, sharpness];
}

function resolveIridescenceParams(
	data: SurfaceParams,
): [number, number, number] {
	const irid = data.iridescence;
	const intensity =
		typeof irid === "number"
			? irid
			: irid && typeof irid === "object"
				? (irid.intensity ?? 1)
				: 0;
	const thickness =
		data.iridescenceThickness ??
		(irid && typeof irid === "object" ? irid.thickness : undefined) ??
		400;
	const ior =
		data.iridescenceIor ??
		(irid && typeof irid === "object" ? irid.ior : undefined) ??
		1.3;
	return [
		Math.max(0, Math.min(1, intensity)),
		Math.max(100, Math.min(1200, thickness)),
		Math.max(1.05, Math.min(2.5, ior)),
	];
}

export function packSurfaceParams(
	data: SurfaceParams,
	out: Float32Array,
	offset: number,
	modelShade?: [number, number, number],
): void {
	out[offset] = data.roughness ?? -1;
	out[offset + 1] = data.metallic ?? 0;
	out[offset + 2] = 0;
	out[offset + 3] = 0;

	const e = data.emissive;
	if (e === undefined || e === null) {
		out.fill(0, offset + 4, offset + 8);
	} else {
		const rgb = parseRgbTriplet(e, [0, 0, 0]);
		out[offset + 4] = rgb[0];
		out[offset + 5] = rgb[1];
		out[offset + 6] = rgb[2];
		out[offset + 7] = data.emissiveIntensity ?? 1;
	}

	const shadow = data.toon?.shadowColor
		? parseColor(data.toon.shadowColor)
		: null;
	out.set(
		shadow ? [shadow.r, shadow.g, shadow.b] : (modelShade ?? [0.5, 0.5, 0.55]),
		offset + 8,
	);
	out[offset + 11] = data.toon?.diffuse ?? 0;
	const light = parseColor(data.toon?.lightColor ?? "#ffffff");
	out.set(
		[light.r, light.g, light.b, data.toon?.threshold ?? 0.075],
		offset + 12,
	);
	const [triplanarFreq, triplanarSharpness] = resolveTriplanarParams(data);
	const sheenRoughness = Math.max(
		0.05,
		Math.min(1, data.sheenRoughness ?? 0.5),
	);
	out.set(
		[
			data.toon?.softness ?? 0.25,
			data.outline === false ? 0 : 1,
			sheenRoughness,
			triplanarSharpness,
		],
		offset + 16,
	);

	// offset + 20: substrateClearcoatAniso [clearcoat, clearcoatRoughness, anisotropy, anisotropyRotationRad]
	out[offset + 20] = Math.max(0, Math.min(1, data.clearcoat ?? 0));
	out[offset + 21] = Math.max(
		0.03,
		Math.min(1, data.clearcoatRoughness ?? 0.08),
	);
	out[offset + 22] = Math.max(-1, Math.min(1, data.anisotropy ?? 0));
	out[offset + 23] = ((data.anisotropyRotation ?? 0) * Math.PI) / 180;

	// offset + 24: substrateSubsurface [subsurface, r, g, b]
	const sssRgb = parseRgbTriplet(data.subsurfaceColor, [1.0, 0.42, 0.29]);
	out[offset + 24] = Math.max(0, Math.min(1, data.subsurface ?? 0));
	out[offset + 25] = sssRgb[0];
	out[offset + 26] = sssRgb[1];
	out[offset + 27] = sssRgb[2];

	// offset + 28: substrateSheen [sheen, r, g, b]
	const sheenRgb = parseRgbTriplet(data.sheenColor, [1, 1, 1]);
	out[offset + 28] = Math.max(0, Math.min(1, data.sheen ?? 0));
	out[offset + 29] = sheenRgb[0];
	out[offset + 30] = sheenRgb[1];
	out[offset + 31] = sheenRgb[2];

	// offset + 32: substrateIridescence [intensity, thicknessNm, ior, triplanarUvFreq]
	const [iridInt, iridThick, iridIor] = resolveIridescenceParams(data);
	out[offset + 32] = iridInt;
	out[offset + 33] = iridThick;
	out[offset + 34] = iridIor;
	out[offset + 35] = triplanarFreq;
}
