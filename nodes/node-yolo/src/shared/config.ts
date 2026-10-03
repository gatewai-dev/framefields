import {
	createOutputItemSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import {
	ImageResultSchema,
	MultiOutputGenericSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const YoloNodeConfigSchema = z
	.object({
		enableDetection: z.boolean().default(true),
		enableSegmentation: z.boolean().default(false),
		enablePose: z.boolean().default(false),
		enableClassification: z.boolean().default(false),
		enableObb: z.boolean().default(false),
		enableWorld: z.boolean().default(false),
		prompts: z.array(z.string()).optional(),
		customModel: z
			.object({
				path: z.string().optional(),
				url: z.string().optional(),
				task: z.enum(["detect", "segment", "pose", "obb", "classify", "world"]),
				classes: z.array(z.string()),
				imgsz: z.number().int().min(320).max(1280).optional(),
			})
			.optional(),
		classes: z.array(z.string()).optional(),
		confidence: z.number().min(0).max(1).default(0.25),
		iouThreshold: z.number().min(0).max(1).default(0.45),
		variant: z.enum(["n", "s", "m", "l", "x"]).default("n"),
		imgsz: z.number().int().min(320).max(1280).default(640),
		mode: z
			.enum([
				"passthrough",
				"mask",
				"matte",
				"crop",
				"skeleton",
				"boxes",
				"tracking",
				"obb",
			])
			.default("passthrough"),
		delegate: z.enum(["CPU", "GPU"]).default("CPU"),
		maxMissedFrames: z.number().int().positive().default(15),
		maskThreshold: z.number().min(0).max(1).default(0.5),
		featherRadius: z.number().min(0).max(1).optional(),
		keyBackground: z.boolean().default(false),
		backgroundKeyThreshold: z.number().min(0).max(255).default(70),
		modelsDir: z.string().optional(),
		baseUrl: z.string().optional(),
		visionBundle: z.custom<unknown>().optional(),
	})
	.strict();

export type YoloNodeConfig = z.infer<typeof YoloNodeConfigSchema>;

export const YoloOperationSchema = YoloNodeConfigSchema.extend({
	op: z.literal("Yolo"),
	dataType: z.enum(["Image", "Video", "SVG", "GIF", "Caption"]).optional(),
	inputs: z.record(z.string(), z.unknown()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type YoloOperation = z.infer<typeof YoloOperationSchema>;

export const ImageYoloResultSchema = ImageResultSchema;
export type ImageYoloResult = z.infer<typeof ImageYoloResultSchema>;

export const VideoYoloResultSchema = SingleOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);
export type VideoYoloResult = z.infer<typeof VideoYoloResultSchema>;

export const YoloResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);
export type YoloResult = z.infer<typeof YoloResultSchema>;
