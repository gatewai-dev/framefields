import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const MAX_RADIUS = 250;

export const highPassConfig = configBuilder()
	.field("radius", z.number().min(0.1).max(MAX_RADIUS).default(3.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Radius Signal",
		description:
			"The cutoff radius in pixels. Frequencies smaller than this radius are preserved.",
	})
	.field(
		"contrastBoost",
		z.number().multipleOf(0.01).min(1.0).max(10.0).default(1.0),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Contrast Boost Signal",
			description:
				"Multiplier applied to the extracted high-frequency detail delta.",
		},
	)
	.field("monochrome", z.boolean().default(true), {
		description:
			"When enabled, high-pass delta is converted to luminance before centering on 50% neutral gray.",
	})
	.build();

export const HighPassNodeConfigSchema = highPassConfig.schema;

export type HighPassNodeConfig = z.infer<typeof HighPassNodeConfigSchema>;

export const HighPassResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type HighPassResult = z.infer<typeof HighPassResultSchema>;

export const HIGH_PASS_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
