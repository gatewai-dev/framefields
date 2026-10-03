import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const TonalShiftSchema = z
	.object({
		cyanRed: z.number().min(-100).max(100).default(0),
		magentaGreen: z.number().min(-100).max(100).default(0),
		yellowBlue: z.number().min(-100).max(100).default(0),
	})
	// `title` names the interface the effects generator emits for this object.
	.meta({ title: "TonalShift" });

export type TonalShift = z.infer<typeof TonalShiftSchema>;

export type TonalRangeKey = "shadows" | "midtones" | "highlights";

export const defaultTonalShift: TonalShift = {
	cyanRed: 0,
	magentaGreen: 0,
	yellowBlue: 0,
};

export const colorBalanceConfig = configBuilder({ strict: false })
	.field("shadows", TonalShiftSchema.default(defaultTonalShift))
	.field("midtones", TonalShiftSchema.default(defaultTonalShift))
	.field("highlights", TonalShiftSchema.default(defaultTonalShift))
	.field("preserveLuminosity", z.boolean().default(true))
	.field("shadows_cyanRed", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Shadows Cyan-Red Signal",
	})
	.field("shadows_magentaGreen", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Shadows Magenta-Green Signal",
	})
	.field("shadows_yellowBlue", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Shadows Yellow-Blue Signal",
	})
	.field("midtones_cyanRed", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Midtones Cyan-Red Signal",
	})
	.field("midtones_magentaGreen", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Midtones Magenta-Green Signal",
	})
	.field("midtones_yellowBlue", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Midtones Yellow-Blue Signal",
	})
	.field("highlights_cyanRed", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Highlights Cyan-Red Signal",
	})
	.field("highlights_magentaGreen", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Highlights Magenta-Green Signal",
	})
	.field("highlights_yellowBlue", z.number().min(-100).max(100).default(0), {
		// Editor input handle; authoring code sets the nested object instead.
		editorOnly: true,
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Highlights Yellow-Blue Signal",
	})
	.build();

export const ColorBalanceNodeConfigSchema = colorBalanceConfig.schema;

export type ColorBalanceNodeConfig = z.infer<
	typeof ColorBalanceNodeConfigSchema
>;

export const ColorBalanceResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type ColorBalanceResult = z.infer<typeof ColorBalanceResultSchema>;

export const ColorBalanceOperationSchema = ColorBalanceNodeConfigSchema.extend({
	op: z.literal("ColorBalance"),
	metadata: z.unknown().optional(),
});

export type ColorBalanceOperation = z.infer<typeof ColorBalanceOperationSchema>;

export const defaultColorBalanceConfig: ColorBalanceNodeConfig =
	ColorBalanceNodeConfigSchema.parse({});

export interface ColorBalancePreset {
	id: string;
	name: string;
	shadows: TonalShift;
	midtones: TonalShift;
	highlights: TonalShift;
	preserveLuminosity: boolean;
}

export const COLOR_BALANCE_PRESETS: ColorBalancePreset[] = [
	{
		id: "teal-orange",
		name: "Teal & Orange",
		shadows: { cyanRed: -20, magentaGreen: 0, yellowBlue: 25 },
		midtones: { cyanRed: 10, magentaGreen: -5, yellowBlue: -10 },
		highlights: { cyanRed: 25, magentaGreen: 0, yellowBlue: -20 },
		preserveLuminosity: true,
	},
	{
		id: "golden-hour",
		name: "Golden Hour",
		shadows: { cyanRed: 15, magentaGreen: -5, yellowBlue: -15 },
		midtones: { cyanRed: 20, magentaGreen: 5, yellowBlue: -25 },
		highlights: { cyanRed: 10, magentaGreen: 0, yellowBlue: -20 },
		preserveLuminosity: true,
	},
	{
		id: "cool-night",
		name: "Cool Moonlight",
		shadows: { cyanRed: -25, magentaGreen: 10, yellowBlue: 35 },
		midtones: { cyanRed: -15, magentaGreen: 5, yellowBlue: 20 },
		highlights: { cyanRed: -5, magentaGreen: 0, yellowBlue: 10 },
		preserveLuminosity: true,
	},
	{
		id: "vintage-warmth",
		name: "Vintage Film",
		shadows: { cyanRed: -10, magentaGreen: 15, yellowBlue: -10 },
		midtones: { cyanRed: 15, magentaGreen: -5, yellowBlue: -15 },
		highlights: { cyanRed: 10, magentaGreen: -10, yellowBlue: -20 },
		preserveLuminosity: true,
	},
	{
		id: "cross-process",
		name: "Cross Process",
		shadows: { cyanRed: -15, magentaGreen: -20, yellowBlue: 20 },
		midtones: { cyanRed: 10, magentaGreen: 15, yellowBlue: -15 },
		highlights: { cyanRed: 20, magentaGreen: -10, yellowBlue: 10 },
		preserveLuminosity: true,
	},
	{
		id: "bleach-bypass",
		name: "Bleach Bypass Tone",
		shadows: { cyanRed: -5, magentaGreen: 0, yellowBlue: 5 },
		midtones: { cyanRed: 0, magentaGreen: -10, yellowBlue: 0 },
		highlights: { cyanRed: 10, magentaGreen: 5, yellowBlue: -10 },
		preserveLuminosity: false,
	},
	{
		id: "dramatic-cool",
		name: "Nordic Frost",
		shadows: { cyanRed: -30, magentaGreen: 0, yellowBlue: 40 },
		midtones: { cyanRed: -10, magentaGreen: 0, yellowBlue: 15 },
		highlights: { cyanRed: 5, magentaGreen: -5, yellowBlue: -10 },
		preserveLuminosity: true,
	},
	{
		id: "sunset-glow",
		name: "Sunset Glow",
		shadows: { cyanRed: 10, magentaGreen: 20, yellowBlue: -20 },
		midtones: { cyanRed: 30, magentaGreen: 10, yellowBlue: -35 },
		highlights: { cyanRed: 40, magentaGreen: -10, yellowBlue: -30 },
		preserveLuminosity: true,
	},
];

export const COLOR_BALANCE_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
