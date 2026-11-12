/**
 * Scene-wide "world" settings for physically based 3D: a procedural studio
 * environment (image-based light), exposure, tone mapping and fog. A scene
 * with an environment is shaded physically; one without keeps the original
 * Blinn-Phong look.
 */
import { type GeometryOutlineOptions, parseCssColor } from "@framefields/core";
import type { PathTraceOptions } from "../pathtracer/quality.js";

/**
 * "neutral" (default, Khronos PBR Neutral): colors as authored, highlights
 * rolled off: right for products, brands and UI. "agx": filmic, desaturates
 * hot highlights gracefully. "aces": punchy film contrast, shifts hues.
 */
export type ToneMapping = "neutral" | "agx" | "aces" | "none";

export type EnvironmentPreset =
	| "studio"
	| "soft"
	| "warm"
	| "sunset"
	| "night"
	| "neon"
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

export interface Environment3DVolumetricFogNoise {
	/** World-space noise frequency (1 / period in px). Default 0.003. */
	scale?: number;
	/** Density modulation depth 0..1. Default 0.45. */
	strength?: number;
	/** Wind drift velocity [vx, vy, vz] in world px/sec. Default [20, -8, 12]. */
	speed?: [number, number, number];
	/** FBM octaves 1..3. Default 2. */
	octaves?: number;
}

export interface Environment3DVolumetricFog {
	/** Base extinction/scattering density (typical range 0.002..0.15, default 0.02). */
	density?: number;
	/** In-scattering albedo tint (default: environment horizon color). */
	color?: string;
	/** Henyey-Greenstein forward/back scatter asymmetry g in (-0.95..0.95). Default 0.55. */
	anisotropy?: number;
	/** Exponential height falloff rate (0 = uniform, >0 = ground mist). Default 0.0015. */
	heightFalloff?: number;
	/** Reference world Y height for ground fog (px, y down). Default 540. */
	baseHeight?: number;
	/** Raymarch step count per half-res pixel (8..64, default 28). */
	steps?: number;
	/** Maximum raymarch distance from camera in world px. Default 2800. */
	maxDistance?: number;
	/** Multiplier on direct-light in-scattering / god rays. Default 1.5. */
	lightIntensity?: number;
	/** Multiplier on ambient / sky in-scattering. Default 0.35. */
	ambientIntensity?: number;
	/** Optional 3D procedural FBM turbulence in the fog medium. */
	noise?: boolean | Environment3DVolumetricFogNoise;
}

/** Screen-space reflections: glossy surfaces reflect what the camera sees. */
export interface Environment3DSsrOptions {
	/** How fully a found reflection replaces the environment's, 0..1. Default 0.85. */
	intensity?: number;
	/** Roughest surface that traces reflections (0..1); rougher ones keep the environment. Default 0.6. */
	maxRoughness?: number;
	/** How far behind a surface, in world px, a ray still counts as hitting it. Default 120. */
	thickness?: number;
	/** Hi-Z march iterations per ray (16..64). Default 32. */
	steps?: number;
}

/** Screen-space diffuse GI: ambient occlusion plus one bounce of visible light. */
export interface Environment3DGiOptions {
	/** Strength of the bounced light, 0..4. Default 1. */
	intensity?: number;
	/** Gather radius in world px. Default 400. */
	radius?: number;
	/** Horizon-scan directions per pixel (4..16). Default 6. */
	samples?: number;
}

export interface Environment3DOptions {
	preset?: EnvironmentPreset;
	/** Equirectangular panorama for real HDRI IBL: a `.hdr` (Radiance RGBE) or `.exr` (OpenEXR) path, or the file's bytes. */
	hdri?: string | Uint8Array;
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
	outlines?: boolean | GeometryOutlineOptions;
	/** Froxel-style volumetric participating media & shadowed light shafts (god rays). */
	volumetricFog?: boolean | Environment3DVolumetricFog;
	/** Screen-space reflections of nearby geometry and emissives on glossy surfaces. */
	ssr?: boolean | Environment3DSsrOptions;
	/** Screen-space diffuse GI: occlusion and color bleeding from visible surfaces. */
	gi?: boolean | Environment3DGiOptions;
	/**
	 * Path trace the scene's 3D batch instead of rasterizing it: shadows,
	 * reflections, refraction, occlusion and bounce light are traced. `true`
	 * or settings (quality preset, samples, bounces, denoise).
	 */
	pathTrace?: boolean | PathTraceOptions;
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
	/** Warm tungsten studio with golden key and amber bounce. */
	warm: {
		top: "#f4d7b5",
		horizon: "#c99768",
		bottom: "#3d281c",
		softboxes: 2.6,
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
	/** Cyberpunk neon studio with electric cyan top and magenta horizon. */
	neon: {
		top: "#26b0ff",
		horizon: "#d926a9",
		bottom: "#090414",
		softboxes: 2.8,
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

export interface ResolvedVolumetricFog {
	density: number;
	color: [number, number, number];
	anisotropy: number;
	heightFalloff: number;
	baseHeight: number;
	steps: number;
	maxDistance: number;
	lightIntensity: number;
	ambientIntensity: number;
	noiseScale: number;
	noiseStrength: number;
	noiseSpeed: [number, number, number];
	noiseOctaves: number;
}

export interface ResolvedEnvironment {
	top: [number, number, number];
	horizon: [number, number, number];
	bottom: [number, number, number];
	softboxes: number;
	intensity: number;
	hdri?: string | Uint8Array;
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
	volumetricFog?: ResolvedVolumetricFog;
	ssr?: ResolvedSsr;
	gi?: ResolvedGi;
}

export interface ResolvedSsr {
	intensity: number;
	maxRoughness: number;
	thickness: number;
	steps: number;
}

export interface ResolvedGi {
	intensity: number;
	radius: number;
	samples: number;
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v));

export function resolveSsr(
	ssr: boolean | Environment3DSsrOptions | undefined,
): ResolvedSsr | undefined {
	if (!ssr) return undefined;
	const cfg: Environment3DSsrOptions = ssr === true ? {} : ssr;
	return {
		intensity: clamp(cfg.intensity ?? 0.85, 0, 1),
		maxRoughness: clamp(cfg.maxRoughness ?? 0.6, 0, 1),
		thickness: Math.max(1, cfg.thickness ?? 120),
		steps: Math.round(clamp(cfg.steps ?? 32, 16, 64)),
	};
}

export function resolveGi(
	gi: boolean | Environment3DGiOptions | undefined,
): ResolvedGi | undefined {
	if (!gi) return undefined;
	const cfg: Environment3DGiOptions = gi === true ? {} : gi;
	return {
		intensity: clamp(cfg.intensity ?? 1, 0, 4),
		radius: Math.max(1, cfg.radius ?? 400),
		samples: Math.round(clamp(cfg.samples ?? 6, 4, 16)),
	};
}

export function resolveVolumetricFog(
	vf: boolean | Environment3DVolumetricFog | undefined,
	defaultColor: [number, number, number],
): ResolvedVolumetricFog | undefined {
	if (!vf) return undefined;
	const cfg: Environment3DVolumetricFog = vf === true ? {} : vf;
	const noiseCfg: Environment3DVolumetricFogNoise | undefined =
		cfg.noise === true
			? {}
			: cfg.noise && typeof cfg.noise === "object"
				? cfg.noise
				: undefined;
	return {
		density: Math.max(0, cfg.density ?? 0.02),
		color: cfg.color ? linearRgb(cfg.color) : defaultColor,
		anisotropy: Math.max(-0.95, Math.min(0.95, cfg.anisotropy ?? 0.55)),
		heightFalloff: Math.max(0, cfg.heightFalloff ?? 0.0015),
		baseHeight: cfg.baseHeight ?? 540,
		steps: Math.max(8, Math.min(64, Math.round(cfg.steps ?? 28))),
		maxDistance: Math.max(100, cfg.maxDistance ?? 2800),
		lightIntensity: Math.max(0, cfg.lightIntensity ?? 1.5),
		ambientIntensity: Math.max(0, cfg.ambientIntensity ?? 0.35),
		noiseScale: Math.max(0.0001, noiseCfg?.scale ?? 0.003),
		noiseStrength: noiseCfg
			? Math.max(0, Math.min(1, noiseCfg.strength ?? 0.45))
			: 0,
		noiseSpeed: noiseCfg?.speed ?? [20, -8, 12],
		noiseOctaves: noiseCfg
			? Math.max(1, Math.min(3, Math.round(noiseCfg.octaves ?? 2)))
			: 0,
	};
}

/** Linear radiance and shader codes for an environment. */
export function resolveEnvironment(
	opts: Environment3DOptions,
): ResolvedEnvironment {
	const preset =
		ENVIRONMENT_PRESETS[opts.preset ?? "studio"] ?? ENVIRONMENT_PRESETS.studio;
	const k = opts.intensity ?? 1;
	const scale = (c: [number, number, number]): [number, number, number] => [
		c[0] * k,
		c[1] * k,
		c[2] * k,
	];
	const horizonLinear = linearRgb(opts.horizon ?? preset.horizon);
	return {
		top: scale(linearRgb(opts.top ?? preset.top)),
		horizon: scale(horizonLinear),
		bottom: scale(linearRgb(opts.bottom ?? preset.bottom)),
		softboxes: (opts.softboxes ?? preset.softboxes) * k,
		intensity: k,
		...(opts.hdri !== undefined && { hdri: opts.hdri }),
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
		volumetricFog: resolveVolumetricFog(opts.volumetricFog, horizonLinear),
		ssr: resolveSsr(opts.ssr),
		gi: resolveGi(opts.gi),
	};
}

/** Where a shadow-casting light's depth map lives, for the lit shaders. */
export interface ShadowUniformInfo {
	/** Light view-projection (world → shadow clip). For omnidirectional point shadows, element [0] stores far plane. */
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
	/** Starting layer index in the shadow depth 2D array texture. */
	baseLayer?: number;
	/** Number of array layers consumed by this shadow entry (1 for directional/spot/rect, 6 for point). */
	layerCount?: number;
	/** Shadow projection mode: 1 = 2D frustum, 2 = 6-face omnidirectional cube. */
	mode?: 1 | 2;
	/** Near plane distance in world px (used by mode=2 omnidirectional point shadows). */
	near?: number;
	/** Far plane distance in world px (used by mode=2 omnidirectional point shadows). */
	far?: number;
}
