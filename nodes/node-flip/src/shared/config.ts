import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const flipConfig = configBuilder()
	.field("horizontal", z.boolean().default(true), {
		description: "Mirror horizontally along the vertical center axis.",
	})
	.field("vertical", z.boolean().default(false), {
		description: "Mirror vertically along the horizontal center axis.",
	})
	.field("diagonal", z.boolean().default(false), {
		description: "Swap horizontal and vertical axes (diagonal transposition).",
	})
	.field(
		"mode",
		z
			.enum([
				"horizontal",
				"vertical",
				"both",
				"diagonal",
				"antiDiagonal",
				"custom",
			])
			.default("horizontal"),
		{
			description: "Quick preset mode for flipping or transposition.",
		},
	)
	.field(
		"symmetry",
		z
			.enum([
				"none",
				"leftToRight",
				"rightToLeft",
				"topToBottom",
				"bottomToTop",
				"quadrant",
			])
			.default("none"),
		{
			description: "Split-mirror reflection and symmetry effects.",
		},
	)
	.build();

export const FlipNodeConfigSchema = flipConfig.schema;

export type FlipNodeConfig = z.infer<typeof FlipNodeConfigSchema>;

export const FlipResultSchema = z.union([ImageResultSchema, VideoResultSchema]);

export type FlipResult = z.infer<typeof FlipResultSchema>;

export const FLIP_OUTPUT_TYPE_MAP: Record<string, "Image" | "Video" | "GIF"> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};

export function calculateFlipDimensions(
	width: number,
	height: number,
	config: {
		horizontal?: boolean;
		vertical?: boolean;
		diagonal?: boolean;
		mode?:
			| "horizontal"
			| "vertical"
			| "both"
			| "diagonal"
			| "antiDiagonal"
			| "custom";
	},
): { width: number; height: number } {
	const isDiagonal =
		config.mode === "diagonal" ||
		config.mode === "antiDiagonal" ||
		(config.mode === "custom" && config.diagonal) ||
		(config.diagonal && !config.mode);

	if (isDiagonal) {
		return { width: height, height: width };
	}
	return { width, height };
}
