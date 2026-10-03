import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const MAX_RADIUS = 50;
export const MAX_AMOUNT = 500;
export const MAX_THRESHOLD = 255;

export const unsharpMaskConfig = configBuilder()
	.field("amount", z.number().min(0).max(MAX_AMOUNT).default(100), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Amount Signal",
		description: "Sharpening intensity percentage (0–500%).",
	})
	.field("radius", z.number().min(0.1).max(MAX_RADIUS).default(1.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Radius Signal",
		description:
			"The Gaussian blur radius in pixels used to detect edge contrast.",
	})
	.field("threshold", z.number().int().min(0).max(MAX_THRESHOLD).default(3), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Threshold Signal",
		description:
			"Minimum tonal level difference (0–255) required before sharpening is applied to avoid amplifying noise.",
	})
	.build();

export const UnsharpMaskNodeConfigSchema = unsharpMaskConfig.schema;

export type UnsharpMaskNodeConfig = z.infer<typeof UnsharpMaskNodeConfigSchema>;

export const UnsharpMaskResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type UnsharpMaskResult = z.infer<typeof UnsharpMaskResultSchema>;

export const UNSHARP_MASK_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
