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

/**
 * What the node draws:
 *  - passthrough — the child unchanged (vision signals still update)
 *  - mask        — white subject silhouette on black
 *  - matte       — the child cut out by the subject alpha (transparent background)
 *  - crop        — the matte, punched in to the subject's bounds
 *  - skeleton    — COCO-17 pose skeleton of the primary person
 *  - boxes       — the child with tracked-object boxes
 *  - tracking    — boxes plus track centers
 */
export const VISION_MODES = [
	"passthrough",
	"mask",
	"matte",
	"crop",
	"skeleton",
	"boxes",
	"tracking",
] as const;

export type VisionMode = (typeof VISION_MODES)[number];

export const VisionNodeConfigSchema = z
	.object({
		enableDetection: z.boolean().default(true),
		enableSegmentation: z.boolean().default(false),
		enablePose: z.boolean().default(false),
		enableMatte: z.boolean().default(false),
		classes: z.array(z.string()).optional(),
		confidence: z.number().min(0).max(1).default(0.3),
		variant: z.enum(["t", "s", "m"]).default("s"),
		mode: z.enum(VISION_MODES).default("passthrough"),
		/**
		 * Source of the subject alpha for mask/matte/crop: `instance` (RTMDet-Ins, any COCO
		 * class, overlapping parts merged) or `selfie` (Selfie Segmenter, people only, fastest).
		 */
		matteSource: z.enum(["instance", "selfie"]).default("instance"),
		/** Frames a track may go unseen before it is dropped. */
		maxMissedFrames: z.number().int().positive().default(15),
		maskThreshold: z.number().min(0).max(1).default(0.5),
		featherRadius: z.number().min(0).max(1).optional(),
		/** Grow the subject into connected pixels that differ from the frame-border backdrop. */
		keyBackground: z.boolean().default(false),
		backgroundKeyThreshold: z.number().min(0).max(255).default(70),
		modelsDir: z.string().optional(),
		baseUrl: z.string().optional(),
		visionBundle: z.custom<unknown>().optional(),
	})
	.strict();

export type VisionNodeConfig = z.infer<typeof VisionNodeConfigSchema>;

export const VisionOperationSchema = VisionNodeConfigSchema.extend({
	op: z.literal("Vision"),
	dataType: z.enum(["Image", "Video", "SVG", "GIF", "Caption"]).optional(),
	inputs: z.record(z.string(), z.unknown()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type VisionOperation = z.infer<typeof VisionOperationSchema>;

export const ImageVisionResultSchema = ImageResultSchema;
export type ImageVisionResult = z.infer<typeof ImageVisionResultSchema>;

const VisualOutputSchema = z.union([
	createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
	createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
	createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
	createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
]);

export const VideoVisionResultSchema =
	SingleOutputGenericSchema(VisualOutputSchema);
export type VideoVisionResult = z.infer<typeof VideoVisionResultSchema>;

export const VisionResultSchema = MultiOutputGenericSchema(VisualOutputSchema);
export type VisionResult = z.infer<typeof VisionResultSchema>;
