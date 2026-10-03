import {
	createOutputItemSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import { z } from "zod";

export const ExtractFrameConfigSchema = z
	.object({
		/** The frame number to extract (0-indexed) */
		frame: z.number().int().min(0).default(0),
	})
	.strict();

export type ExtractFrameConfig = z.infer<typeof ExtractFrameConfigSchema>;

export const ExtractFrameResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
);

export type ExtractFrameResult = z.infer<typeof ExtractFrameResultSchema>;

export const ExtractFrameOperationSchema = ExtractFrameConfigSchema.extend({
	op: z.literal("ExtractFrame"),
	metadata: z.any().optional(),
	dataType: z.literal("Image"),
});

export type ExtractFrameOperation = z.infer<typeof ExtractFrameOperationSchema>;
