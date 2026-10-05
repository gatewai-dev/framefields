import {
	type CompositorProgramConfig,
	CompositorProgramSchema,
} from "@framefields/compositions/program";
import { MediaMetadataSchema } from "@framefields/core";
import { ImageResultSchema, VideoResultSchema } from "@framefields/node-sdk";
import { z } from "zod";

/**
 * v2 config — THE document (spec: SKILL.md).
 * No `layers`, no `layerUpdates`, no aliases. The node config IS the
 * composition program: strict zod, validated by the E-code pre-parse scan
 * in `@framefields/compositions/program/validate`.
 */
export const CompositorNodeConfigSchema = CompositorProgramSchema;
export type CompositorNodeConfig = CompositorProgramConfig;

/** Data types accepted by the variable composer inputs. */
export const VariableInputDataTypes = [
	"Text",
	"Image",
	"Video",
	"Audio",
	"Caption",
	"SVG",
	"GIF",
	"Lottie",
	"Signal",
] as const;
export type VariableInputDataType = (typeof VariableInputDataTypes)[number];

/** The Compositor op framing (used in the render tree, per processCompositor). */
export const CompositorOperationSchema = CompositorNodeConfigSchema.extend({
	op: z.literal("Compositor"),
	dataType: z.enum(["Video", "Image"]).optional(),
	metadata: MediaMetadataSchema.optional(),
}).strict();

export type CompositorOperation = z.infer<typeof CompositorOperationSchema>;

export const CompositorResultSchema = z.union([
	VideoResultSchema,
	ImageResultSchema,
]);
