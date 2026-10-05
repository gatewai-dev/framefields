import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const refractionCaustics3DConfig = configBuilder()
	.field("ior", z.number().min(1.0).max(2.5).default(1.52), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "IOR Signal",
		description:
			"Index of Refraction (1.0=Air, 1.33=Water, 1.52=Crown Glass, 2.42=Diamond). Controls ray bending according to Snell's Law.",
	})
	.field("dispersion", z.number().min(0.0).max(0.2).default(0.04), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Dispersion Signal",
		description:
			"Chromatic dispersion (RGB wavelength splitting) creating prismatic rainbow fringing.",
	})
	.field("refractionScale", z.number().min(0.0).max(2.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Refraction Scale Signal",
		description:
			"Depth displacement scale and effective glass thickness factor.",
	})
	.field("causticBrightness", z.number().min(0.0).max(2.0).default(0.6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Caustic Signal",
		description:
			"Brightness multiplier for photometric caustic light rays focusing through curved glass.",
	})
	.field("causticScale", z.number().min(0.1).max(5.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Caustic Scale Signal",
		description: "Spatial frequency scale of photometric caustic patterns.",
	})
	.field("fluidRipples", z.number().min(0.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Ripples Signal",
		description:
			"Dynamic liquid wave perturbation strength across the refractive surface.",
	})
	.field("rippleSpeed", z.number().min(0.0).max(5.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Ripple Speed Signal",
		description: "Speed of dynamic fluid wave animation.",
	})
	.field("roughness", z.number().min(0.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Roughness Signal",
		description:
			"Microfacet frosted glass roughness and optical diffusion blur.",
	})
	.field("specularIntensity", z.number().min(0.0).max(2.0).default(0.8), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Specular Signal",
		description: "Fresnel specular reflection gleam intensity.",
	})
	.field("lightPosX", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Light Pos X Signal",
		description:
			"Horizontal normalized coordinate (0.0 to 1.0) of incident light source.",
	})
	.field("lightPosY", z.number().min(0.0).max(1.0).default(0.2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Light Pos Y Signal",
		description:
			"Vertical normalized coordinate (0.0 to 1.0) of incident light source.",
	})
	.field("tintColor", z.string().default("#ffffff"), {
		bindable: false,
		label: "Glass Tint Color",
		description: "Internal glass color tint and absorption.",
	})
	.field("tintStrength", z.number().min(0.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Tint Strength Signal",
		description: "Strength of internal glass color tint absorption.",
	})
	.field("depthInvert", z.boolean().default(false), {
		bindable: false,
		label: "Invert Depth",
		description: "Invert depth polarity (white = near vs black = near).",
	})
	.field("depthScale", z.number().min(0.1).max(5.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Depth Scale Signal",
		description: "Height-field surface normal extrusion exaggeration.",
	})
	.build();

export const RefractionCaustics3DNodeConfigSchema =
	refractionCaustics3DConfig.schema;

export type RefractionCaustics3DNodeConfig = z.infer<
	typeof RefractionCaustics3DNodeConfigSchema
>;

export interface RefractionCausticsPreset {
	id: string;
	name: string;
	description: string;
	config: Partial<RefractionCaustics3DNodeConfig>;
}

export const REFRACTION_CAUSTICS_PRESETS: RefractionCausticsPreset[] = [
	{
		id: "CrownGlass",
		name: "Crown Glass (IOR 1.52)",
		description:
			"Standard architectural & optical glass with low dispersion and crisp clarity.",
		config: {
			ior: 1.52,
			dispersion: 0.03,
			refractionScale: 0.4,
			roughness: 0.0,
			fluidRipples: 0.0,
			causticBrightness: 0.4,
			specularIntensity: 0.8,
		},
	},
	{
		id: "Water",
		name: "Water & Liquid (IOR 1.33)",
		description: "Fluid wave refraction with dynamic ripple caustics.",
		config: {
			ior: 1.33,
			dispersion: 0.015,
			refractionScale: 0.35,
			roughness: 0.0,
			fluidRipples: 0.35,
			rippleSpeed: 1.0,
			causticBrightness: 0.6,
			specularIntensity: 0.7,
		},
	},
	{
		id: "Diamond",
		name: "Brilliant Diamond (IOR 2.42)",
		description: "Extreme index of refraction and fiery spectral dispersion.",
		config: {
			ior: 2.42,
			dispersion: 0.08,
			refractionScale: 0.5,
			roughness: 0.0,
			fluidRipples: 0.0,
			causticBrightness: 0.7,
			specularIntensity: 1.2,
		},
	},
	{
		id: "FlintGlass",
		name: "Dense Flint Glass (IOR 1.66)",
		description: "Heavy lead crystal with strong refractive bending.",
		config: {
			ior: 1.66,
			dispersion: 0.05,
			refractionScale: 0.45,
			roughness: 0.0,
			fluidRipples: 0.0,
			causticBrightness: 0.5,
			specularIntensity: 0.9,
		},
	},
	{
		id: "Ice",
		name: "Ice Crystal (IOR 1.31)",
		description: "Cold crystalline structure with subtle frosted microfacets.",
		config: {
			ior: 1.31,
			dispersion: 0.015,
			refractionScale: 0.3,
			roughness: 0.12,
			fluidRipples: 0.0,
			causticBrightness: 0.3,
			specularIntensity: 0.6,
		},
	},
	{
		id: "FrostedGlass",
		name: "Frosted Glass (Acid-Etched)",
		description: "Velvety microfacet diffusion and soft refraction.",
		config: {
			ior: 1.52,
			dispersion: 0.02,
			refractionScale: 0.35,
			roughness: 0.35,
			fluidRipples: 0.0,
			causticBrightness: 0.2,
			specularIntensity: 0.4,
		},
	},
	{
		id: "Prism",
		name: "Prism Rainbow (High Dispersion)",
		description: "Intense spectral rainbow chromatic dispersion.",
		config: {
			ior: 1.75,
			dispersion: 0.12,
			refractionScale: 0.6,
			roughness: 0.0,
			fluidRipples: 0.0,
			causticBrightness: 0.6,
			specularIntensity: 0.8,
		},
	},
];

/** Canonical default config — single source of truth for metadata, reset, and fallbacks. */
export const DEFAULT_REFRACTION_CAUSTICS_3D_CONFIG: RefractionCaustics3DNodeConfig =
	RefractionCaustics3DNodeConfigSchema.parse({
		ior: 1.52,
		dispersion: 0.03,
		refractionScale: 0.4,
		causticBrightness: 0.4,
		causticScale: 1.0,
		fluidRipples: 0.0,
		rippleSpeed: 1.0,
		roughness: 0.0,
		specularIntensity: 0.8,
		lightPosX: 0.5,
		lightPosY: 0.2,
		tintColor: "#ffffff",
		tintStrength: 0.0,
		depthInvert: false,
		depthScale: 1.0,
	});

export const RefractionCaustics3DResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type RefractionCaustics3DResult = z.infer<
	typeof RefractionCaustics3DResultSchema
>;

export const REFRACTION_CAUSTICS_3D_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
