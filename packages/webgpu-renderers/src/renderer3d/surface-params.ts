import type { ToonShading } from "@framefields/core";
import { parseColor } from "../color.js";
import type { Color } from "../renderer2d/index.js";

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
}

/** Shared model uniforms: PBR, emissive, and three art-direction vec4s. */
export const SURFACE_PARAMS_FLOATS = 20;

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
	out.set(
		[data.toon?.softness ?? 0.25, data.outline === false ? 0 : 1, 0, 0],
		offset + 16,
	);
	const e = data.emissive;
	if (e === undefined || e === null) {
		out.fill(0, offset + 4, offset + 8);
		return;
	}
	let rgb: [number, number, number];
	if (Array.isArray(e)) {
		rgb = [e[0], e[1], e[2]];
	} else {
		const c = parseColor(e as string | Color);
		rgb = [c.r * c.a, c.g * c.a, c.b * c.a];
	}
	out[offset + 4] = rgb[0];
	out[offset + 5] = rgb[1];
	out[offset + 6] = rgb[2];
	out[offset + 7] = data.emissiveIntensity ?? 1;
}
