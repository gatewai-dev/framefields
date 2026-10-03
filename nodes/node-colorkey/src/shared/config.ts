import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const colorKeyConfig = configBuilder()
	.field(
		"keyColor",
		z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#00ff00"),
		{
			bindable: false,
			label: "Key Color",
		},
	)
	.field("similarity", z.number().min(0).max(1).default(0.4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Similarity",
		description: "How close the color must be to the Key Color to be removed.",
	})
	.field("smoothness", z.number().min(0).max(1).default(0.1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Smoothness",
		description: "The softness of the transparency edge.",
	})
	.field("spillSuppression", z.number().min(0).max(1).default(0.2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Spill Suppression",
		description: "Amount of key color spill to remove from foreground edges.",
	})
	.field("colorSpace", z.enum(["YUV", "RGB"]).default("YUV"), {
		bindable: false,
		label: "Color Space",
		description: "Color space used to calculate similarity distance.",
	})
	.field(
		"spillSuppressionType",
		z.enum(["Desaturate", "Neutralize", "None"]).default("Desaturate"),
		{
			bindable: false,
			label: "Spill Style",
			description: "How key color spill is suppressed on foreground edges.",
		},
	)
	.build();

export const ColorKeyNodeConfigSchema = colorKeyConfig.schema;
export type ColorKeyNodeConfig = z.infer<typeof ColorKeyNodeConfigSchema>;

export const ColorKeyResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);
export type ColorKeyResult = z.infer<typeof ColorKeyResultSchema>;

export const COLORKEY_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
