import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import { z } from "zod";

export const CaptionEditorNodeConfigSchema = z
	.object({
		content: z.string().max(200000).default(""),
	})
	.strict();

export type CaptionEditorNodeConfig = z.infer<
	typeof CaptionEditorNodeConfigSchema
>;

export const CaptionEditorResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("Caption"), VirtualMediaDataSchema),
);

export type CaptionEditorResult = z.infer<typeof CaptionEditorResultSchema>;
