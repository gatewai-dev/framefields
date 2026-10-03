import z from "zod";
import type { DataType, FileAsset } from "./base.js";
import type { VirtualMediaData } from "./video/virtual-video.js";

export const FileDataSchema = z.object({
	entity: z.custom<FileAsset>().optional(),
});

export type FileData = z.infer<typeof FileDataSchema>;

export const SignalStatsSchema = z.object({
	min: z.number().optional(),
	max: z.number().optional(),
	mean: z.number().optional(),
	rms: z.number().optional(),
	peak: z.number().optional(),
	beats: z.array(z.number()).optional(),
	tempo: z.number().optional(),
});
export type SignalStats = z.infer<typeof SignalStatsSchema>;

export const SignalChannelMetaSchema = z.object({
	id: z.string(),
	name: z.string(),
	index: z.number(),
	stats: SignalStatsSchema.optional(),
});
export type SignalChannelMeta = z.infer<typeof SignalChannelMetaSchema>;

export const GeneratorSignalDataSchema = z
	.object({
		v: z.literal(2).optional(),
		type: z.literal("generator"),
		nodeId: z.string().optional(),
		baseType: z.string().optional(),
		func: z
			.enum(["sine", "triangle", "sawtooth", "square", "custom"])
			.or(z.string())
			.default("sine"),
		frequency: z.number().default(1),
		amplitude: z.number().default(1),
		phase: z.number().default(0),
		offset: z.number().default(0),
		waveform: z.string().optional(),
		bpm: z.number().optional(),
		syncToBpm: z.boolean().optional(),
		fmFrequency: z.number().optional(),
		fmDepth: z.number().optional(),
		envelope: z.string().optional(),
		fnBody: z.string().optional(),
		fnParams: z.array(z.record(z.string(), z.unknown())).optional(),
		customWGSL: z.string().optional(),
		signalFnName: z.string().optional(),
		outputType: z.string().optional(),
		fps: z.number().optional(),
		durationMs: z.number().optional(),
		stats: SignalStatsSchema.optional(),
	})
	.passthrough();
export type GeneratorSignalData = z.infer<typeof GeneratorSignalDataSchema>;

export const AudioExtractorSignalDataSchema = z
	.object({
		v: z.literal(2).optional(),
		type: z.literal("audio_extractor"),
		nodeId: z.string().optional(),
		sourceUrl: z.string().optional(),
		channel: z
			.enum(["primary", "beat", "bass", "energy", "spectral_flux"])
			.or(z.string())
			.optional(),
		channelIndex: z.number().optional(),
		channels: z.array(SignalChannelMetaSchema).optional(),
		extractionMode: z.string().optional(),
		attackMs: z.number().optional(),
		releaseMs: z.number().optional(),
		sensitivity: z.number().optional(),
		noiseFloorDb: z.number().optional(),
		dynamicRangeDb: z.number().optional(),
		autoRange: z.boolean().optional(),
		smoothing: z.number().optional(),
		curve: z.string().optional(),
		beatThreshold: z.number().optional(),
		beatDecayMs: z.number().optional(),
		previewMode: z.string().optional(),
		samples: z
			.union([z.array(z.number()), z.instanceof(Float32Array)])
			.optional(),
		fps: z.number().optional(),
		durationMs: z.number().optional(),
		stats: SignalStatsSchema.optional(),
		state: z.enum(["pending", "ready", "failed"]).optional(),
		error: z.string().optional(),
		virtualMedia: z.record(z.string(), z.unknown()).optional(),
		signalFnName: z.string().optional(),
		customWGSL: z.string().optional(),
	})
	.passthrough();
export type AudioExtractorSignalData = z.infer<
	typeof AudioExtractorSignalDataSchema
>;

export const SignalMathDataSchema = z
	.object({
		v: z.literal(2).optional(),
		type: z.literal("signal_math"),
		nodeId: z.string().optional(),
		op: z.string().optional(),
		operation: z.string().optional(),
		signalA: z.unknown().optional(),
		signalB: z.unknown().optional(),
		bValue: z.number().optional(),
		inMin: z.number().optional(),
		inMax: z.number().optional(),
		outMin: z.number().optional(),
		outMax: z.number().optional(),
		clampMin: z.number().optional(),
		clampMax: z.number().optional(),
		exponent: z.number().optional(),
		edge0: z.number().optional(),
		edge1: z.number().optional(),
		customWGSL: z.string().optional(),
		stats: SignalStatsSchema.optional(),
	})
	.passthrough();
export type SignalMathData = z.infer<typeof SignalMathDataSchema>;

export const SignalGateDataSchema = z
	.object({
		v: z.literal(2).optional(),
		type: z.literal("gate"),
		nodeId: z.string().optional(),
		sourceSignal: z.unknown().optional(),
		threshold: z.number().optional(),
		debounceMs: z.number().optional(),
		mode: z.enum(["gate", "trigger", "toggle"]).optional(),
		holdFrames: z.number().optional(),
		invert: z.boolean().optional(),
		stats: SignalStatsSchema.optional(),
	})
	.passthrough();
export type SignalGateData = z.infer<typeof SignalGateDataSchema>;

export const SignalDataSchema = z.union([
	GeneratorSignalDataSchema,
	AudioExtractorSignalDataSchema,
	SignalMathDataSchema,
	SignalGateDataSchema,
	z.object({ type: z.string() }).passthrough(),
]);

export type SignalData = z.infer<typeof SignalDataSchema>;

export function serializeSignalData(data: SignalData): string {
	return JSON.stringify(data, (_key, value) => {
		if (value instanceof Float32Array) {
			return Array.from(value);
		}
		return value;
	});
}

export function deserializeSignalData(raw: unknown): SignalData {
	if (typeof raw === "string") {
		try {
			return SignalDataSchema.parse(JSON.parse(raw));
		} catch {
			return { type: "unknown" } as SignalData;
		}
	}
	return SignalDataSchema.parse(raw);
}

export type DataForType<R extends DataType> = R extends "Text"
	? string
	: R extends "Number"
		? number
		: R extends "Boolean"
			? boolean
			: R extends "Signal"
				? SignalData
				: R extends
							| "Image"
							| "SVG"
							| "Caption"
							| "Video"
							| "Audio"
							| "Lottie"
							| "ThreeD"
							| "GIF"
							| "LUT"
					? VirtualMediaData
					: R extends "Any"
						?
								| string
								| number
								| boolean
								| FileData
								| VirtualMediaData
								| SignalData
						: never;

export const OutputItemSchema = z.object({
	type: z.custom<DataType>(),
	data: z.any(), // Since DataForType is complex, we just allow any at runtime but type it properly if possible.
	outputHandleId: z.string().optional(),
});

// Utility to create strictly-typed output item schemas
export const createOutputItemSchema = <T extends DataType>(
	type: z.ZodLiteral<T>,
	dataSchema: z.ZodTypeAny,
) => {
	return z.object({
		type: type,
		data: dataSchema,
		outputHandleId: z.string().optional(),
	}) as z.ZodType<OutputItem<T>>;
};

export type OutputItem<R extends DataType> = {
	type: R;
	data: DataForType<R>;
	outputHandleId: string | undefined;
};

export type Output = {
	items: OutputItem<DataType>[];
};

export const SingleOutputGenericSchema = <T extends DataType>(
	outputItemSchema: z.ZodType<OutputItem<T>>,
) =>
	z.object({
		selectedOutputIndex: z.literal(0),
		outputs: z.tuple([z.object({ items: z.tuple([outputItemSchema]) })]),
	});

export type SingleOutputGeneric<T extends DataType> = {
	selectedOutputIndex: 0;
	outputs: [{ items: [OutputItem<T>] }];
};

export const MultiOutputGenericSchema = <T extends DataType>(
	outputItemSchema: z.ZodType<OutputItem<T>>,
) =>
	z.object({
		selectedOutputIndex: z.number(),
		outputs: z.array(z.object({ items: z.array(outputItemSchema) })),
		sourceFingerprint: z.string().optional(),
	});

export type MultiOutputGeneric<T extends DataType> = {
	selectedOutputIndex: number;
	outputs: { items: OutputItem<T>[] }[];
	sourceFingerprint?: string;
};

export type AnyOutputUnion =
	| OutputItem<"Video">
	| OutputItem<"Image">
	| OutputItem<"Audio">
	| OutputItem<"Text">
	| OutputItem<"Number">
	| OutputItem<"Boolean">
	| OutputItem<"SVG">
	| OutputItem<"GIF">
	| OutputItem<"Caption">
	| OutputItem<"Lottie">
	| OutputItem<"ThreeD">
	| OutputItem<"Signal">
	| OutputItem<"LUT">;

export const AnyOutputUnionSchema = z.object({
	type: z.custom<DataType>(),
	data: z.any(),
	outputHandleId: z.string().optional(),
}) as z.ZodType<AnyOutputUnion>;

export const NodeResultSchema = z.object({
	selectedOutputIndex: z.number(),
	outputs: z.array(
		z.object({
			items: z.array(AnyOutputUnionSchema),
		}),
	),
});

export type NodeResult = z.infer<typeof NodeResultSchema>;

export const ExportResultSchema =
	MultiOutputGenericSchema(AnyOutputUnionSchema);

export type ExportResult = {
	selectedOutputIndex: number;
	outputs: { items: AnyOutputUnion[] }[];
	sourceFingerprint?: string;
};
