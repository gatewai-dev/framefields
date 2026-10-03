import {
	createOutputItemSchema,
	FileDataSchema,
	MultiOutputGenericSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import { z } from "zod";

export {
	createOutputItemSchema,
	FileDataSchema,
	SingleOutputGenericSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
};

export const COMPOSITE_OPERATIONS = [
	"source-over",
	"source-in",
	"source-out",
	"source-atop",
	"destination-over",
	"destination-in",
	"destination-out",
	"destination-atop",
	"lighter",
	"copy",
	"xor",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
] as const;

export const GlobalCompositeOperation = z.enum(COMPOSITE_OPERATIONS);

export const ColorSchema = z.string().optional();
export const PercentageSchema = z.number().min(0).max(100);
export const DimensionSchema = z.number().min(0).optional();

export const AnimationSchema = z.object({
	animations: z
		.array(
			z.object({
				id: z.string(),
				type: z.enum([
					"fade-in",
					"fade-out",
					"slide-in-left",
					"slide-in-right",
					"slide-in-top",
					"slide-in-bottom",
					"zoom-in",
					"zoom-out",
					"rotate-cw",
					"rotate-ccw",
					"bounce",
					"shake",
				]),
				value: z.number(),
			}),
		)
		.optional(),
});

export const StrokeSchema = z.object({
	stroke: ColorSchema,
	strokeWidth: z.number().min(0).optional(),
	strokeAlign: z
		.enum(["inside", "center", "outside"])
		.optional()
		.default("inside"),
	strokeRadius: z.number().min(0).optional(),
});

// Result Schemas for backwards compatibility with node config definitions
export const ImageResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Image"), FileDataSchema),
);
export type ImageResult = z.infer<typeof ImageResultSchema>;

export const VideoResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
);
export type VideoResult = z.infer<typeof VideoResultSchema>;

export const AudioResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Audio"), VirtualMediaDataSchema),
);
export type AudioResult = z.infer<typeof AudioResultSchema>;

export const TextResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Text"), z.string()),
);
export type TextResult = z.infer<typeof TextResultSchema>;

export const NumberResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Number"), z.number()),
);
export type NumberResult = z.infer<typeof NumberResultSchema>;

export const SignalResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Signal"), z.unknown()),
);
export type SignalResult = z.infer<typeof SignalResultSchema>;
