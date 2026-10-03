import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const relight3DConfig = configBuilder()
	.field(
		"lightType",
		z.enum(["Point", "Spot", "Directional", "Rim"]).default("Point"),
		{
			bindable: false,
			label: "Light Type",
		},
	)
	.field("intensity", z.number().min(0).max(10).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Intensity Signal",
		description:
			"Brightness multiplier for the injected 3D light. Can be modulated by a static number or dynamic signal.",
	})
	.field("lightPosX", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Light Pos X Signal",
		description:
			"Horizontal light position across the frame (0.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("lightPosY", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Light Pos Y Signal",
		description:
			"Vertical light position across the frame (0.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("lightPosZ", z.number().min(-2.0).max(2.0).default(0.3), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Light Pos Z Signal",
		description:
			"Depth distance of the light in 3D space (-2.0 to 2.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("lightRadius", z.number().min(0.01).max(5.0).default(0.8), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Light Radius Signal",
		description:
			"Spatial throw / attenuation radius of the light. Can be modulated by a static number or dynamic signal.",
	})
	.field("spotConeAngle", z.number().min(5).max(90).default(45), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Spot Cone Angle Signal",
		description:
			"Spread angle in degrees for Spot light. Can be modulated by a static number or dynamic signal.",
	})
	.field("specularRoughness", z.number().min(0.01).max(1.0).default(0.35), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Roughness Signal",
		description:
			"Microfacet roughness (lower = sharper specular glint). Can be modulated by a static number or dynamic signal.",
	})
	.field("specularStrength", z.number().min(0.0).max(3.0).default(0.7), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Specular Strength Signal",
		description:
			"Direct specular highlight intensity. Can be modulated by a static number or dynamic signal.",
	})
	.field("metallic", z.number().min(0.0).max(1.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Metallic Signal",
		description:
			"Conductor reflectance (tints specular highlights with albedo color).",
	})
	.field("ambientIntensity", z.number().min(0.0).max(2.0).default(0.4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Ambient Intensity Signal",
		description:
			"Base scene ambient fill illumination. Can be modulated by a static number or dynamic signal.",
	})
	.field("volumetricDensity", z.number().min(0.0).max(1.0).default(0.2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Volumetric Density Signal",
		description:
			"Density of atmospheric fog scattering light beams / god rays.",
	})
	.field("depthScale", z.number().min(0.1).max(10.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Depth Scale Signal",
		description:
			"Normal depth relief exaggeration multiplier. Can be modulated by a static number or dynamic signal.",
	})
	.field("depthInvert", z.boolean().default(false), {
		bindable: false,
		label: "Invert Depth",
		description: "Invert depth polarity (white = near vs black = near).",
	})
	.field("lightColor", z.string().default("#ffffff"), {
		bindable: false,
		label: "Light Color",
		description: "Hex color for the emitted light source.",
	})
	.field("ambientColor", z.string().default("#ffffff"), {
		bindable: false,
		label: "Ambient Color",
		description: "Hex color for ambient scene shadows.",
	})
	.build();

export const Relight3DNodeConfigSchema = relight3DConfig.schema;

export type Relight3DNodeConfig = z.infer<typeof Relight3DNodeConfigSchema>;

/** Canonical default config — single source of truth for metadata, reset, and fallbacks. */
export const DEFAULT_RELIGHT_3D_CONFIG: Relight3DNodeConfig =
	Relight3DNodeConfigSchema.parse({
		lightType: "Point",
		intensity: 1.0,
		lightPosX: 0.5,
		lightPosY: 0.5,
		lightPosZ: 0.3,
		lightRadius: 0.8,
		spotConeAngle: 45,
		specularRoughness: 0.35,
		specularStrength: 0.7,
		metallic: 0.0,
		ambientIntensity: 0.4,
		volumetricDensity: 0.2,
		depthScale: 1.0,
		depthInvert: false,
		lightColor: "#ffffff",
		ambientColor: "#ffffff",
	});

export const Relight3DResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type Relight3DResult = z.infer<typeof Relight3DResultSchema>;

export const RELIGHT_3D_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
