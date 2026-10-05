import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const ExtractionModeEnum = z.enum([
	"rms_envelope",
	"transient_beat",
	"sub_bass",
	"bass",
	"mid",
	"high",
	"spectral_flux",
]);
export type ExtractionMode = z.infer<typeof ExtractionModeEnum>;

export const SignalCurveEnum = z.enum([
	"linear",
	"exponential",
	"logarithmic",
	"square",
	"smoothstep",
]);
export type SignalCurve = z.infer<typeof SignalCurveEnum>;

export const AudioSignalExtractorConfigSchema = z.object({
	extractionMode: ExtractionModeEnum.default("rms_envelope"),
	attackMs: z.number().min(0.5).max(1000).default(10),
	releaseMs: z.number().min(1).max(5000).default(120),
	sensitivity: z.number().min(0.1).max(10).default(1.0),
	noiseFloorDb: z.number().min(-90).max(0).default(-48),
	dynamicRangeDb: z.number().min(6).max(80).default(48),
	autoRange: z.boolean().default(true),
	smoothing: z.number().min(0).max(1).default(0.15),
	curve: SignalCurveEnum.default("linear"),
	beatThreshold: z.number().min(0.01).max(1).default(0.08),
	beatDecayMs: z.number().min(10).max(1000).default(80),
	previewMode: z
		.enum(["waveform", "envelope", "beat_markers", "spectrum"])
		.default("envelope"),
});

export type AudioSignalExtractorConfig = z.infer<
	typeof AudioSignalExtractorConfigSchema
>;

export const AudioSignalExtractorResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("Signal"), z.any()),
);

export type AudioSignalExtractorResult = z.infer<
	typeof AudioSignalExtractorResultSchema
>;
