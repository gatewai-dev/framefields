import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const MAX_STRENGTH = 100;

export const vignetteConfig = configBuilder()
	.field("strength", z.number().min(0).max(MAX_STRENGTH).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Strength Signal",
		description:
			"The intensity of the vignette darkening effect. 0 = no vignette.",
	})
	.field("radius", z.number().min(0.1).max(2.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Radius Signal",
		description: "The extent/size of the vignette.",
	})
	.field("softness", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Softness Signal",
		description: "The softness of the vignette transition edge.",
	})
	.field("roundness", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Roundness Signal",
		description: "0.0 matches the image aspect ratio, 1.0 is a perfect circle.",
	})
	.field("centerX", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Center X Signal",
		description: "The X coordinate of the vignette center.",
	})
	.field("centerY", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Center Y Signal",
		description: "The Y coordinate of the vignette center.",
	})
	.build();

export const VignetteNodeConfigSchema = vignetteConfig.schema;

export type VignetteNodeConfig = z.infer<typeof VignetteNodeConfigSchema>;

export const VignetteResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type VignetteResult = z.infer<typeof VignetteResultSchema>;

export const VIGNETTE_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
