import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import { z } from "zod";

export const SVG_NODE_MODELS = [
	"fal-ai/recraft/v4.1/text-to-vector",
	"fal-ai/recraft/v4.1/pro/text-to-vector",
] as const;

export const SVG_PRESET_SIZES = [
	"square_hd",
	"square",
	"portrait_4_3",
	"portrait_16_9",
	"landscape_4_3",
	"landscape_16_9",
] as const;

export const SVG_PRESET_DIMENSIONS: Record<
	(typeof SVG_PRESET_SIZES)[number],
	{ width: number; height: number }
> = {
	square_hd: { width: 1024, height: 1024 },
	square: { width: 512, height: 512 },
	portrait_4_3: { width: 768, height: 1024 },
	portrait_16_9: { width: 576, height: 1024 },
	landscape_4_3: { width: 1024, height: 768 },
	landscape_16_9: { width: 1024, height: 576 },
};

export const SVG_SIZES = [...SVG_PRESET_SIZES, "custom"] as const;

export const SvgNodeConfigSchema = z
	.object({
		model: z
			.enum(SVG_NODE_MODELS)
			.default("fal-ai/recraft/v4.1/text-to-vector"),
		imageSize: z
			.union([
				z.enum(SVG_PRESET_SIZES),
				z.object({
					width: z.number().int().min(64).max(2048),
					height: z.number().int().min(64).max(2048),
				}),
			])
			.default("square_hd"),
		colors: z
			.array(
				z
					.string()
					.regex(
						/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
						"must be a valid hex color starting with #",
					),
			)
			.max(10)
			.default([]),
		backgroundColor: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.nullable()
			.default(null),
	})
	.strict();

export type SvgNodeConfig = z.infer<typeof SvgNodeConfigSchema>;

export const SvgResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
);

export type SvgResult = z.infer<typeof SvgResultSchema>;
