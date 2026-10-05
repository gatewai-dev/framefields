import {
	createOutputItemSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@framefields/core";
import { z } from "zod";

export const CornerPinNodeConfigSchema = z
	.object({
		points: z
			.array(
				z.object({
					x: z.number().min(0).max(100),
					y: z.number().min(0).max(100),
				}),
			)
			.length(4)
			.optional(),
	})
	.strict();

export type CornerPinNodeConfig = z.infer<typeof CornerPinNodeConfigSchema>;

export const CornerPinOperationSchema = CornerPinNodeConfigSchema.extend({
	op: z.literal("CornerPin"),
	metadata: z.any().optional(),
});

export type CornerPinOperation = z.infer<typeof CornerPinOperationSchema>;

export const CornerPinResultSchema = SingleOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);

export type CornerPinResult = z.infer<typeof CornerPinResultSchema>;

export const CORNER_PIN_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF" | "SVG"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
