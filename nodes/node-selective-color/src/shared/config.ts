import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const MIN_COLOR_ADJUSTMENT = -100;
export const MAX_COLOR_ADJUSTMENT = 100;

export const ColorAdjustmentSchema = z.object({
	cyan: z
		.number()
		.min(MIN_COLOR_ADJUSTMENT)
		.max(MAX_COLOR_ADJUSTMENT)
		.default(0),
	magenta: z
		.number()
		.min(MIN_COLOR_ADJUSTMENT)
		.max(MAX_COLOR_ADJUSTMENT)
		.default(0),
	yellow: z
		.number()
		.min(MIN_COLOR_ADJUSTMENT)
		.max(MAX_COLOR_ADJUSTMENT)
		.default(0),
	black: z
		.number()
		.min(MIN_COLOR_ADJUSTMENT)
		.max(MAX_COLOR_ADJUSTMENT)
		.default(0),
});

export type ColorAdjustment = z.infer<typeof ColorAdjustmentSchema>;

export const defaultColorAdjustment: ColorAdjustment = {
	cyan: 0,
	magenta: 0,
	yellow: 0,
	black: 0,
};

export const SelectiveColorMethodEnum = z.enum(["Relative", "Absolute"]);
export type SelectiveColorMethod = z.infer<typeof SelectiveColorMethodEnum>;

export const COLOR_RANGE_KEYS = [
	"reds",
	"yellows",
	"greens",
	"cyans",
	"blues",
	"magentas",
	"whites",
	"neutrals",
	"blacks",
] as const;

export type ColorRangeKey = (typeof COLOR_RANGE_KEYS)[number];

export const selectiveColorConfig = configBuilder()
	.field("method", SelectiveColorMethodEnum.default("Relative"), {
		label: "Method",
		description:
			"Relative modifies CMYK ink proportions relative to existing ink levels. Absolute directly adjusts channel percentages.",
	})
	.field("reds", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Reds Adjustment",
	})
	.field("yellows", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Yellows Adjustment",
	})
	.field("greens", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Greens Adjustment",
	})
	.field("cyans", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Cyans Adjustment",
	})
	.field("blues", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Blues Adjustment",
	})
	.field("magentas", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Magentas Adjustment",
	})
	.field("whites", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Whites Adjustment",
	})
	.field("neutrals", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Neutrals Adjustment",
	})
	.field("blacks", ColorAdjustmentSchema.default(defaultColorAdjustment), {
		label: "Blacks Adjustment",
	})
	.build();

export const SelectiveColorNodeConfigSchema = selectiveColorConfig.schema;
export type SelectiveColorNodeConfig = z.infer<
	typeof SelectiveColorNodeConfigSchema
>;

export const defaultSelectiveColorConfig: SelectiveColorNodeConfig = {
	method: "Relative",
	reds: { ...defaultColorAdjustment },
	yellows: { ...defaultColorAdjustment },
	greens: { ...defaultColorAdjustment },
	cyans: { ...defaultColorAdjustment },
	blues: { ...defaultColorAdjustment },
	magentas: { ...defaultColorAdjustment },
	whites: { ...defaultColorAdjustment },
	neutrals: { ...defaultColorAdjustment },
	blacks: { ...defaultColorAdjustment },
};

export const SelectiveColorResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type SelectiveColorResult = z.infer<typeof SelectiveColorResultSchema>;

export const SelectiveColorOperationSchema =
	SelectiveColorNodeConfigSchema.extend({
		op: z.literal("SelectiveColor"),
		metadata: z.unknown().optional(),
		dataType: z.enum(["Image", "Video", "GIF"]).optional(),
	});

export type SelectiveColorOperation = z.infer<
	typeof SelectiveColorOperationSchema
>;

export const SELECTIVE_COLOR_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
