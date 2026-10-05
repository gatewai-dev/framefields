import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const MAX_RADIUS = 250;
export const MIN_RADIUS = 1;
export const MAX_AMOUNT = 100;

export const shadowsHighlightsConfig = configBuilder()
	.field("shadowAmount", z.number().min(0).max(100).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Shadow Boost (%)",
		description:
			"Percentage to lift and recover crushed shadow details (0–100%).",
	})
	.field("shadowTonalWidth", z.number().min(0).max(100).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Shadow Range (%)",
		description: "Range of dark tones affected by shadow adjustments (0–100%).",
	})
	.field("shadowRadius", z.number().min(1).max(250).default(30), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Shadow Radius (px)",
		description:
			"Local neighborhood radius in pixels to determine shadow illumination (1–250px).",
	})
	.field("highlightAmount", z.number().min(0).max(100).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Highlight Suppression (%)",
		description:
			"Percentage to suppress and recover blown highlight details (0–100%).",
	})
	.field("highlightTonalWidth", z.number().min(0).max(100).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Highlight Range (%)",
		description:
			"Range of bright tones affected by highlight adjustments (0–100%).",
	})
	.field("highlightRadius", z.number().min(1).max(250).default(30), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Highlight Radius (px)",
		description:
			"Local neighborhood radius in pixels to determine highlight exposure (1–250px).",
	})
	.field("colorCorrection", z.number().min(-100).max(100).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Color Correction (%)",
		description:
			"Fine-tunes color saturation in recovered shadow/highlight zones (-100 to +100%).",
	})
	.field("midtoneContrast", z.number().min(-100).max(100).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Midtone Contrast (%)",
		description: "Adjusts contrast centered on the midtones (-100 to +100%).",
	})
	.build();

export const ShadowsHighlightsNodeConfigSchema = shadowsHighlightsConfig.schema;

export type ShadowsHighlightsNodeConfig = z.infer<
	typeof ShadowsHighlightsNodeConfigSchema
>;

export const ShadowsHighlightsResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type ShadowsHighlightsResult = z.infer<
	typeof ShadowsHighlightsResultSchema
>;

export const ShadowsHighlightsOperationSchema =
	ShadowsHighlightsNodeConfigSchema.extend({
		op: z.literal("ShadowsHighlights"),
		metadata: z.unknown().optional(),
	});

export type ShadowsHighlightsOperation = z.infer<
	typeof ShadowsHighlightsOperationSchema
>;

export const defaultShadowsHighlightsConfig: ShadowsHighlightsNodeConfig =
	ShadowsHighlightsNodeConfigSchema.parse({});

export interface ShadowsHighlightsPreset {
	id: string;
	name: string;
	description: string;
	config: Partial<ShadowsHighlightsNodeConfig>;
}

export const SHADOWS_HIGHLIGHTS_PRESETS: ShadowsHighlightsPreset[] = [
	{
		id: "default",
		name: "Default (Neutral)",
		description: "Zero adjustments across dynamic range",
		config: {
			shadowAmount: 0,
			shadowTonalWidth: 50,
			shadowRadius: 30,
			highlightAmount: 0,
			highlightTonalWidth: 50,
			highlightRadius: 30,
			colorCorrection: 0,
			midtoneContrast: 0,
		},
	},
	{
		id: "shadow-lift",
		name: "Shadow Detail Lift",
		description:
			"Gently opens up underexposed shadows without bleaching midtones",
		config: {
			shadowAmount: 40,
			shadowTonalWidth: 50,
			shadowRadius: 35,
			highlightAmount: 0,
			highlightTonalWidth: 50,
			highlightRadius: 30,
			colorCorrection: 10,
			midtoneContrast: 0,
		},
	},
	{
		id: "highlight-recovery",
		name: "Highlight Recovery",
		description: "Pulls back blown sky, cloud, and specular highlight clipping",
		config: {
			shadowAmount: 0,
			shadowTonalWidth: 50,
			shadowRadius: 30,
			highlightAmount: 45,
			highlightTonalWidth: 40,
			highlightRadius: 30,
			colorCorrection: -5,
			midtoneContrast: 0,
		},
	},
	{
		id: "hdr-balance",
		name: "HDR Dynamic Range",
		description:
			"Balanced recovery expanding visible dynamic range in high contrast scenes",
		config: {
			shadowAmount: 35,
			shadowTonalWidth: 50,
			shadowRadius: 40,
			highlightAmount: 35,
			highlightTonalWidth: 50,
			highlightRadius: 40,
			colorCorrection: 15,
			midtoneContrast: 10,
		},
	},
	{
		id: "backlight-correction",
		name: "Backlight Correction",
		description:
			"Compensates for harsh backlighting illuminating silhouetted subjects",
		config: {
			shadowAmount: 60,
			shadowTonalWidth: 60,
			shadowRadius: 50,
			highlightAmount: 20,
			highlightTonalWidth: 35,
			highlightRadius: 30,
			colorCorrection: 20,
			midtoneContrast: 5,
		},
	},
	{
		id: "dramatic-punch",
		name: "Dramatic Contrast & Clarity",
		description:
			"Deepens shadows, compresses highlights, and boosts midtone punch",
		config: {
			shadowAmount: 10,
			shadowTonalWidth: 30,
			shadowRadius: 25,
			highlightAmount: 30,
			highlightTonalWidth: 55,
			highlightRadius: 25,
			colorCorrection: 5,
			midtoneContrast: 25,
		},
	},
	{
		id: "gentle-fill",
		name: "Gentle Fill Light",
		description:
			"Subtle lift to low-light areas preserving photographic atmosphere",
		config: {
			shadowAmount: 20,
			shadowTonalWidth: 40,
			shadowRadius: 30,
			highlightAmount: 15,
			highlightTonalWidth: 40,
			highlightRadius: 30,
			colorCorrection: 5,
			midtoneContrast: 0,
		},
	},
];

export const SHADOWS_HIGHLIGHTS_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
