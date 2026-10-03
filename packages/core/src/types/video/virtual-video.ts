import { z } from "zod";
import { type DataType, DataTypeVal, FileAssetSchema } from "../base.js";

export const MediaSourceSchema = z.object({
	entity: FileAssetSchema.optional(),
});

// --- Metadata: current state of the media ---
export const MediaMetadataSchema = z.object({
	// Video / Visual Properties
	width: z.number().optional().nullable(),
	height: z.number().optional().nullable(),
	fps: z.number().optional().nullable(),

	// Shared Properties
	durationMs: z.number().optional().nullable(),

	// Core Audio Properties
	sampleRate: z.number().optional().nullable(),
	channels: z.number().optional().nullable(),

	// Format Properties
	bitDepth: z.number().optional().nullable(),
	audioCodec: z.string().optional().nullable(),
	audioBitrate: z.number().optional().nullable(),
});

export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;

// --- Timeline: semantic transformations ---
export const TimelineSegmentSchema = z.object({
	startSec: z.number(),
	endSec: z.number().optional(),
});

export const TimelineTransformSchema = z.object({
	startFrame: z.number().optional(),
	segments: z.array(TimelineSegmentSchema).optional(),
});

export type TimelineTransform = z.infer<typeof TimelineTransformSchema>;

// --- Operations: semantic transformations ---

export const BaseMediaOperationPropsSchema = z.object({
	volume: z.number().optional(),
	opacity: z.number().optional(),
	startFrame: z.number().optional(),
	timeline: TimelineTransformSchema.optional(),
});

export type BaseMediaOperationProps = z.infer<
	typeof BaseMediaOperationPropsSchema
>;

/** Original source file (leaf node) */
export const SourceOperationSchema = BaseMediaOperationPropsSchema.extend({
	op: z.literal("source"),
	source: MediaSourceSchema,
	sourceMeta: MediaMetadataSchema,
	dataType: z.enum(Object.values(DataTypeVal) as readonly DataType[]),
});

/** Text content (leaf node) */
export const TextOperationSchema = BaseMediaOperationPropsSchema.extend({
	op: z.literal("text"),
	text: z.string(),
	// Text doesn't have intrinsic dimensions like media, but we can provide hints/metadata
	metadata: MediaMetadataSchema.optional(),
	dataType: z.enum(Object.values(DataTypeVal) as readonly DataType[]),
}).passthrough();

export const MediaOperationSchema = z.union([
	SourceOperationSchema,
	TextOperationSchema,
	BaseMediaOperationPropsSchema.extend({
		op: z.string(),
		metadata: MediaMetadataSchema.optional(),
		dataType: z.enum(Object.values(DataTypeVal) as readonly DataType[]),
	}).passthrough(),
]) as z.ZodType<MediaOperation>;

export type MediaOperation = BaseMediaOperationProps &
	(
		| ({ op: "source" } & z.infer<typeof SourceOperationSchema>)
		| ({ op: "text" } & z.infer<typeof TextOperationSchema>)
		| ({
				op: string;
				metadata?: MediaMetadata;
				dataType: DataType;
		  } & Record<string, any>)
	);

// --- VirtualMediaData: THE recursive data type for all media outputs ---

export type VirtualMediaData = {
	metadata: MediaMetadata;
	operation: MediaOperation;
	children: VirtualMediaData[];
};

export const VirtualMediaDataSchema: z.ZodType<VirtualMediaData> = z.lazy(() =>
	z.object({
		/** Current dimensions/duration of this node's output */
		metadata: MediaMetadataSchema,

		/** The operation applied at this node */
		operation: MediaOperationSchema,

		/** Recursive children (inputs to this operation) */
		children: z.array(VirtualMediaDataSchema).default([]),
	}),
);
