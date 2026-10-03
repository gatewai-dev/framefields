import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const CanvasGeneratorNodeConfigSchema = z
	.object({
		width: z.number().int().min(1).max(4096).default(1920),
		height: z.number().int().min(1).max(4096).default(1080),
		fillType: z.enum(["solid", "linear", "radial"]).default("solid"),
		solidColor: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#3b82f6"),
		gradientStart: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#3b82f6"),
		gradientEnd: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#d8711dff"),
		gradientAngle: z.number().int().min(0).max(360).default(180),
		radialCenterX: z.number().min(0).max(1).default(0.5),
		radialCenterY: z.number().min(0).max(1).default(0.5),
		radialRadius: z.number().min(0).max(2).default(0.5),
	})
	.strict();

export type CanvasGeneratorNodeConfig = z.infer<
	typeof CanvasGeneratorNodeConfigSchema
>;

export const CanvasGeneratorResultSchema = MultiOutputGenericSchema(
	z.union([createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema)]),
);

export type CanvasGeneratorResult = z.infer<typeof CanvasGeneratorResultSchema>;
