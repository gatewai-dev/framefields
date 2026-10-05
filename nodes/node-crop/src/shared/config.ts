import {
	createOutputItemSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@framefields/core";
import {
	ImageResultSchema,
	MultiOutputGenericSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

const BaseCropNodeConfigSchema = z
	.object({
		cropType: z.enum(["rect", "path"]).default("rect"),
		leftPercentage: z.number().min(0).max(100).default(0),
		topPercentage: z.number().min(0).max(100).default(0),
		widthPercentage: z.number().min(0.01).max(100).default(100),
		heightPercentage: z.number().min(0.01).max(100).default(100),
		pathPoints: z
			.array(
				z.object({
					x: z.number().min(0).max(100),
					y: z.number().min(0).max(100),
				}),
			)
			.optional(),
		roundness: z.number().min(0).max(100).default(0),
	})
	.strict();

const validateCropPathPoints = <
	T extends { cropType?: string; pathPoints?: { x: number; y: number }[] },
>(
	data: T,
	ctx: z.RefinementCtx,
) => {
	if (data.cropType === "path") {
		if (!data.pathPoints || data.pathPoints.length < 3) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"pathPoints must contain at least 3 points when cropType is 'path'",
				path: ["pathPoints"],
			});
		}
	}
};

export const CropNodeConfigSchema = BaseCropNodeConfigSchema.superRefine(
	validateCropPathPoints,
);

export type CropNodeConfig = z.infer<typeof BaseCropNodeConfigSchema>;

export const ImageCropResultSchema = ImageResultSchema;

export type ImageCropResult = z.infer<typeof ImageCropResultSchema>;

export const CropOperationSchema = BaseCropNodeConfigSchema.extend({
	op: z.literal("Crop"),
	mode: z.enum(["cropped", "rest"]).optional(),
	metadata: z.any().optional(),
}).superRefine(validateCropPathPoints);

export type CropOperation = z.infer<typeof CropOperationSchema>;

export const VideoCropResultSchema = SingleOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);

export type VideoCropResult = z.infer<typeof VideoCropResultSchema>;

export const CropResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);

export type CropResult = z.infer<typeof CropResultSchema>;

export const CROP_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF" | "SVG"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
