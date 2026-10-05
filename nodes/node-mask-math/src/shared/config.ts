import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const MAX_RADIUS = 200;

export const MaskOperationEnum = z.enum([
	"Union",
	"Intersect",
	"Subtract",
	"Difference",
	"Invert",
	"Dilate",
	"Erode",
	"Choke",
	"Feather",
]);

export type MaskOperation = z.infer<typeof MaskOperationEnum>;

export const MaskChannelEnum = z.enum([
	"Alpha",
	"Luminance",
	"Red",
	"Green",
	"Blue",
]);

export type MaskChannel = z.infer<typeof MaskChannelEnum>;

export const MaskOutputFormatEnum = z.enum([
	"WhiteWithAlpha",
	"GrayscaleRGB",
	"AlphaOnly",
	"PassthroughRGB",
]);

export type MaskOutputFormat = z.infer<typeof MaskOutputFormatEnum>;

export const maskMathConfig = configBuilder()
	.field("operation", MaskOperationEnum.default("Union"), {
		label: "Operation",
		description:
			"Morphological or Boolean set operation applied to input alpha masks.",
	})
	.field("radius", z.number().min(0).max(MAX_RADIUS).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Radius / Width (px)",
		description:
			"Kernel radius in pixels for Dilate, Erode, Choke, or Feather operations.",
	})
	.field(
		"threshold",
		z.number().multipleOf(0.01).min(0.0).max(1.0).default(0.5),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Threshold",
			description:
				"Cutoff threshold level (0.0–1.0) for binarization step or non-linear choke.",
		},
	)
	.field(
		"clampMin",
		z.number().multipleOf(0.01).min(0.0).max(1.0).default(0.0),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Clamp Min",
			description: "Minimum alpha matte cutoff limit (0.0–1.0).",
		},
	)
	.field(
		"clampMax",
		z.number().multipleOf(0.01).min(0.0).max(1.0).default(1.0),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Clamp Max",
			description: "Maximum alpha matte cutoff limit (0.0–1.0).",
		},
	)
	.field("channelA", MaskChannelEnum.default("Alpha"), {
		label: "Mask A Channel",
		description:
			"Source channel to extract mask from Mask A (Alpha, Luminance, Red, Green, Blue).",
	})
	.field("channelB", MaskChannelEnum.default("Alpha"), {
		label: "Mask B Channel",
		description:
			"Source channel to extract mask from Mask B (Alpha, Luminance, Red, Green, Blue).",
	})
	.field("binarize", z.boolean().default(false), {
		label: "Binarize",
		description:
			"When enabled, outputs crisp 1-bit binary matte based on threshold.",
	})
	.field("invertResult", z.boolean().default(false), {
		label: "Invert Result",
		description: "Inverts final matte output.",
	})
	.field("outputFormat", MaskOutputFormatEnum.default("WhiteWithAlpha"), {
		label: "Output Format",
		description:
			"WhiteWithAlpha (rgba(1,1,1,a)), GrayscaleRGB (rgba(a,a,a,1)), AlphaOnly (rgba(0,0,0,a)), PassthroughRGB (Mask A RGB with new alpha).",
	})
	.build();

export const MaskMathNodeConfigSchema = maskMathConfig.schema;

export type MaskMathNodeConfig = z.infer<typeof MaskMathNodeConfigSchema>;

export const MaskMathResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type MaskMathResult = z.infer<typeof MaskMathResultSchema>;

export const MASK_MATH_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
