/**
 * Scene-wide "world" settings for physically based 3D: a procedural studio
 * environment (image-based light), exposure, tone mapping and fog. A scene
 * with an environment is shaded physically; one without keeps the original
 * Blinn-Phong look.
 */
import { parseCssColor } from "@framefields/core";

/**
 * "neutral" (default, Khronos PBR Neutral): colors as authored, highlights
 * rolled off: right for products, brands and UI. "agx": filmic, desaturates
 * hot highlights gracefully. "aces": punchy film contrast, shifts hues.
 */
export type ToneMapping = "neutral" | "agx" | "aces" | "none";

export type EnvironmentPreset =
	| "studio"
	| "soft"
	| "sunset"
	| "night"
	| "neutral";

export interface Environment3DFog {
	/** Display color surfaces fade into; match the background for a seamless horizon. */
	color: string;
	/** Distance from the camera (px) where fog starts. */
	start: number;
	/** Distance where fog reaches `opacity`. */
	end: number;
	/** Max fog coverage 0..1. Default 1. */
	opacity?: number;
}

export interface Environment3DFloor {
	/** World Y coordinate of the floor plane (px, y down). */
	y: number;
	/** Base floor surface color (default "#08070a"). */
	color?: string;
	/** Mirror reflectivity at normal incidence / Fresnel scale, 0..1 (default 0.35). */
	reflectivity?: number;
	/** Surface roughness 0..1: controls anisotropic vertical/horizontal reflection blur (default 0.35). */
	roughness?: number;
	/** Reflection fade-out distance from the floor plane in world Y px (default 900). */
	fadeDistance?: number;
	/** Optional overall opacity of the floor plane, 0..1 (default 1; 0 draws only the additive reflection over background). */
	opacity?: number;
}

export interface Environment3DOptions {
	preset?: EnvironmentPreset;
	/** Overrides the preset's sky (above), horizon and ground colors. */
	top?: string;
	horizon?: string;
	bottom?: string;
	/** Scales the whole environment's light. Default 1. */
	intensity?: number;
	/** Strength of the studio softboxes reflected in glossy surfaces. */
	softboxes?: number;
	/** Turns the environment around the vertical axis, degrees. */
	rotation?: number;
	/** Exposure in stops: +1 doubles brightness. Default 0. */
	exposure?: number;
	/** Default "neutral". */
	toneMapping?: ToneMapping;
	fog?: Environment3DFog;
	floor?: Environment3DFloor;
}

interface PresetDef {
	top: string;
	horizon: string;
	bottom: string;
	softboxes: number;
}

export const ENVIRONMENT_PRESETS: Record<EnvironmentPreset, PresetDef> = {
	/** Neutral photo studio: bright overhead softbox, grey sweep, dark floor bounce. */
	studio: {
		top: "#9da3ad",
		horizon: "#5d626b",
		bottom: "#202226",
		softboxes: 3.5,
	},
	/** Bright, low-contrast daylight room. */
	soft: {
		top: "#f1efea",
		horizon: "#cfcac1",
		bottom: "#77726a",
		softboxes: 1.2,
	},
	/** Warm horizon, cool sky. */
	sunset: {
		top: "#4d63a3",
		horizon: "#ff9a5c",
		bottom: "#3b2a28",
		softboxes: 1.0,
	},
	/** Deep blue night with faint highlights; pair with emissive and point lights. */
	night: {
		top: "#121a3a",
		horizon: "#1f2950",
		bottom: "#05060b",
		softboxes: 0.5,
	},
	/** Flat grey: image-based light without studio reflections. */
	neutral: {
		top: "#9a9a9a",
		horizon: "#808080",
		bottom: "#5c5c5c",
		softboxes: 0,
	},
};

const TONE_MAPPING_CODE: Record<ToneMapping, number> = {
	none: 0,
	aces: 1,
	agx: 2,
	neutral: 3,
};

export function linearRgb(color: string): [number, number, number] {
	const c = parseCssColor(color) ?? [0, 0, 0, 1];
	const lin = (v: number) =>
		v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	return [lin(c[0]), lin(c[1]), lin(c[2])];
}

export interface ResolvedEnvironment {
	top: [number, number, number];
	horizon: [number, number, number];
	bottom: [number, number, number];
	softboxes: number;
	rotationRad: number;
	exposureMultiplier: number;
	toneMapping: number;
	fog?: {
		color: [number, number, number];
		start: number;
		end: number;
		opacity: number;
	};
	floor?: {
		y: number;
		color: [number, number, number];
		reflectivity: number;
		roughness: number;
		fadeDistance: number;
		opacity: number;
	};
}

/** Linear radiance and shader codes for an environment. */
export function resolveEnvironment(
	opts: Environment3DOptions,
): ResolvedEnvironment {
	const preset = ENVIRONMENT_PRESETS[opts.preset ?? "studio"];
	const k = opts.intensity ?? 1;
	const scale = (c: [number, number, number]): [number, number, number] => [
		c[0] * k,
		c[1] * k,
		c[2] * k,
	];
	return {
		top: scale(linearRgb(opts.top ?? preset.top)),
		horizon: scale(linearRgb(opts.horizon ?? preset.horizon)),
		bottom: scale(linearRgb(opts.bottom ?? preset.bottom)),
		softboxes: (opts.softboxes ?? preset.softboxes) * k,
		rotationRad: ((opts.rotation ?? 0) * Math.PI) / 180,
		exposureMultiplier: 2 ** (opts.exposure ?? 0),
		toneMapping: TONE_MAPPING_CODE[opts.toneMapping ?? "neutral"],
		fog: opts.fog
			? {
					color: linearRgb(opts.fog.color),
					start: opts.fog.start,
					end: opts.fog.end,
					opacity: Math.max(0, Math.min(1, opts.fog.opacity ?? 1)),
				}
			: undefined,
		floor: opts.floor
			? {
					y: opts.floor.y,
					color: linearRgb(opts.floor.color ?? "#08070a"),
					reflectivity: Math.max(
						0,
						Math.min(1, opts.floor.reflectivity ?? 0.35),
					),
					roughness: Math.max(0, Math.min(1, opts.floor.roughness ?? 0.35)),
					fadeDistance: Math.max(0, opts.floor.fadeDistance ?? 900),
					opacity: Math.max(0, Math.min(1, opts.floor.opacity ?? 1.0)),
				}
			: undefined,
	};
}

/** Where a shadow-casting light's depth map lives, for the lit shaders. */
export interface ShadowUniformInfo {
	/** Light view-projection (world → shadow clip). */
	matrix: ArrayLike<number>;
	/** Index of the casting light among the packed (non-ambient) lights. */
	lightIndex: number;
	/** Shadow map size in texels. */
	mapSize: number;
	/** Blur radius in texels. */
	softness: number;
	/** Depth bias in NDC. */
	bias: number;
	/** Pushes the lookup along the normal, world px. */
	normalOffset: number;
	/** 0 = invisible shadows, 1 = fully dark. */
	darkness: number;
}
