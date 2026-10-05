import {
	createOutputItemSchema,
	VirtualMediaDataSchema,
} from "@framefields/core";
import { MultiOutputGenericSchema } from "@framefields/node-sdk";
import { z } from "zod";

export const ResizerScalerNodeConfigSchema = z
	.object({
		aspectRatioPreset: z
			.enum(["9:16", "16:9", "1:1", "4:5", "21:9", "custom"])
			.default("16:9"),
		resolutionPreset: z
			.enum(["4k", "1080p", "720p", "480p", "custom"])
			.default("1080p"),

		// Custom dimensions (active only when custom preset is selected)
		targetWidth: z.number().int().min(1).max(8192).default(1920),
		targetHeight: z.number().int().min(1).max(8192).default(1080),

		fitMode: z
			.enum(["cover", "contain", "stretch", "manual"])
			.default("contain"),

		// Manual offsets (active only under "manual" fitMode)
		zoom: z.number().int().min(1).max(1000).default(100), // percentage: 1% to 1000%
		offsetX: z.number().int().min(-8192).max(8192).default(0), // in pixels
		offsetY: z.number().int().min(-8192).max(8192).default(0), // in pixels

		// Background config (active under "contain" or "manual" fitMode)
		backgroundMode: z
			.enum(["solid", "blurred", "gradient", "transparent"])
			.default("solid"),
		backgroundColor: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#000000FF"),
		backgroundColor2: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#000000FF"),

		// Blurred background specific parameters
		blurRadius: z.number().int().min(0).max(100).default(40),
		backgroundBrightness: z.number().min(0).max(1).default(0.6), // darkens background

		// Anchoring/Alignment presets
		anchorX: z.enum(["left", "center", "right"]).default("center"),
		anchorY: z.enum(["top", "center", "bottom"]).default("center"),
	})
	.strict();

export type ResizerScalerNodeConfig = z.infer<
	typeof ResizerScalerNodeConfigSchema
>;

export const ResizerScalerResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);

export type ResizerScalerResult = z.infer<typeof ResizerScalerResultSchema>;

export const RESIZER_SCALER_OUTPUT_TYPE_MAP: Record<string, string> = {
	Image: "Image",
	Video: "Video",
	GIF: "GIF",
	SVG: "Image",
	Lottie: "Video",
};

export const RESOLUTION_PRESETS: Record<
	string,
	Record<string, { w: number; h: number }>
> = {
	"16:9": {
		"4k": { w: 3840, h: 2160 },
		"1080p": { w: 1920, h: 1080 },
		"720p": { w: 1280, h: 720 },
		"480p": { w: 854, h: 480 },
	},
	"9:16": {
		"4k": { w: 2160, h: 3840 },
		"1080p": { w: 1080, h: 1920 },
		"720p": { w: 720, h: 1280 },
		"480p": { w: 480, h: 854 },
	},
	"1:1": {
		"4k": { w: 2160, h: 2160 },
		"1080p": { w: 1080, h: 1080 },
		"720p": { w: 720, h: 720 },
		"480p": { w: 480, h: 480 },
	},
	"4:5": {
		"4k": { w: 2160, h: 2700 },
		"1080p": { w: 1080, h: 1350 },
		"720p": { w: 720, h: 900 },
		"480p": { w: 480, h: 600 },
	},
	"21:9": {
		"4k": { w: 3840, h: 1646 },
		"1080p": { w: 2560, h: 1080 },
		"720p": { w: 1706, h: 720 },
		"480p": { w: 1136, h: 480 },
	},
};

export function resolveTargetDimensions(config: {
	aspectRatioPreset: string;
	resolutionPreset: string;
	targetWidth: number;
	targetHeight: number;
}): { width: number; height: number } {
	if (
		config.aspectRatioPreset === "custom" ||
		config.resolutionPreset === "custom"
	) {
		const w = Math.round(config.targetWidth);
		const h = Math.round(config.targetHeight);
		return {
			width: w % 2 === 0 ? w : w + 1,
			height: h % 2 === 0 ? h : h + 1,
		};
	}
	const preset =
		RESOLUTION_PRESETS[config.aspectRatioPreset]?.[config.resolutionPreset];
	if (preset) {
		return {
			width: preset.w % 2 === 0 ? preset.w : preset.w + 1,
			height: preset.h % 2 === 0 ? preset.h : preset.h + 1,
		};
	}
	return { width: 1920, height: 1080 };
}
