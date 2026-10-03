import { z } from "zod";
import {
	BaseVideoLayerPropsSchema,
	VideoLayerTypeSchema,
} from "./base-layer-schema.js";
import { TransitionSchema } from "./transition-schema.js";
import { VirtualMediaDataSchema } from "./virtual-video.js";

export const ExtendedLayerSchema = BaseVideoLayerPropsSchema.extend({
	id: z.string(),
	name: z.string().optional(),
	type: VideoLayerTypeSchema,

	// VirtualMediaData from upstream
	virtualMedia: VirtualMediaDataSchema.optional(),

	// Transitions
	transitionIn: TransitionSchema.optional(),
	transitionOut: TransitionSchema.optional(),

	// Timing in the composition
	durationInMS: z.number(), // Required here
	maxDurationInMS: z.number().optional(),

	// Content (resolved before render)
	src: z.string().optional(),
	volume: z.number().default(1),

	// Handle info for mapping
	inputHandleId: z.string().optional(),

	isPlaceholder: z.boolean().optional(),

	lockAspect: z.boolean().optional(),
	lockRatio: z.boolean().optional(),

	// Z-Index
	zIndex: z.number().optional(),
}).strict();

export type ExtendedLayer = z.infer<typeof ExtendedLayerSchema>;
