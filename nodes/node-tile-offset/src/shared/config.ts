import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const EdgeModeEnum = z.enum(["wrap", "clamp", "transparent", "mirror"]);
export type EdgeMode = z.infer<typeof EdgeModeEnum>;

export const tileOffsetConfig = configBuilder()
	.field("offsetX", z.number().default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Horizontal Offset (px)",
		description:
			"Horizontal pixel shift (positive shifts right, negative shifts left).",
	})
	.field("offsetY", z.number().default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Vertical Offset (px)",
		description:
			"Vertical pixel shift (positive shifts down, negative shifts up).",
	})
	.field("wrap", z.boolean().default(true), {
		label: "Wrap Around Edges",
		description: "Seamless modulo wrap-around across opposite borders.",
	})
	.field("edgeMode", EdgeModeEnum.default("wrap"), {
		label: "Edge Mode",
		description:
			"Boundary handling behavior: wrap (seamless modulo repeat), clamp (replicate edge pixels), transparent (empty transparent background), mirror (ping-pong reflection).",
	})
	.build();

export const TileOffsetNodeConfigSchema = tileOffsetConfig.schema;

export type TileOffsetNodeConfig = z.infer<typeof TileOffsetNodeConfigSchema>;

export const TileOffsetResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type TileOffsetResult = z.infer<typeof TileOffsetResultSchema>;

export const TileOffsetOperationSchema = TileOffsetNodeConfigSchema.extend({
	op: z.literal("TileOffset"),
	metadata: z.record(z.string(), z.unknown()).optional(),
	offsetXHandleId: z.string().nullable().optional(),
	offsetYHandleId: z.string().nullable().optional(),
	inputs: z
		.record(
			z.string(),
			z.object({
				connectionValid: z.boolean(),
				outputItem: z
					.object({
						type: z.string(),
						data: z.unknown(),
					})
					.nullable()
					.optional(),
			}),
		)
		.optional(),
});

export type TileOffsetOperation = z.infer<typeof TileOffsetOperationSchema>;

export const TILE_OFFSET_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
