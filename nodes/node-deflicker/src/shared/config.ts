import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const deflickerConfig = configBuilder()
	.field("blendWeight", z.number().min(0).max(1).default(0.35), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Blend Weight",
		description:
			"Temporal blend weight alpha between current frame and motion-warped previous frame. Higher values prioritize stability, lower values prioritize responsiveness.",
	})
	.field("disocclusionThreshold", z.number().min(0.01).max(1).default(0.15), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Disocclusion Threshold",
		description:
			"Photometric difference threshold above which warped pixels are rejected as occluded or rapid scene changes.",
	})
	.field("maxMotionPixels", z.number().min(1).max(256).default(64), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Max Motion Pixels",
		description:
			"Maximum pixel motion magnitude allowed before warping is damped to prevent extreme displacement artifacts.",
	})
	.field("scale", z.number().min(0.1).max(1).default(0.5), {
		bindable: false,
		label: "Flow Scale Factor",
		description:
			"Resolution downscale factor for dense Lucas-Kanade optical flow motion vector calculation.",
	})
	.field("windowSize", z.number().int().min(1).max(5).default(2), {
		bindable: false,
		label: "Search Window Radius",
		description:
			"Radius of the spatial window for Lucas-Kanade gradient covariance matrix calculation.",
	})
	.build();

export const DeflickerNodeConfigSchema = deflickerConfig.schema;

export type DeflickerNodeConfig = z.infer<typeof DeflickerNodeConfigSchema>;

export const DeflickerResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type DeflickerResult = z.infer<typeof DeflickerResultSchema>;

export const DeflickerOperationSchema = DeflickerNodeConfigSchema.extend({
	op: z.union([z.literal("TemporalDeflicker"), z.literal("Deflicker")]),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DeflickerOperation = z.infer<typeof DeflickerOperationSchema>;
