import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const compressorConfig = configBuilder()
	.field("threshold", z.number().min(-60).max(0).default(-24), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Threshold Signal",
		description:
			"Level (dBFS) above which gain reduction begins (-60 to 0 dB). Can be modulated by a static number or dynamic signal.",
	})
	.field("ratio", z.number().min(1).max(100).default(4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Ratio Signal",
		description:
			"Input-to-output ratio above threshold (1 to 100). Can be modulated by a static number or dynamic signal.",
	})
	.field("attack", z.number().min(0.0001).max(1.0).default(0.003), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Attack Signal",
		description:
			"Seconds to reach full gain reduction (0.0001 to 1.0s). Can be modulated by a static number or dynamic signal.",
	})
	.field("release", z.number().min(0.01).max(5.0).default(0.25), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Release Signal",
		description:
			"Seconds to recover gain after signal drops (0.01 to 5.0s). Can be modulated by a static number or dynamic signal.",
	})
	.field("knee", z.number().min(0).max(24).default(6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Knee Signal",
		description:
			"dB range for soft-knee transition around threshold (0 to 24 dB). Can be modulated by a static number or dynamic signal.",
	})
	.field("makeupGain", z.number().min(0).max(24).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Makeup Gain Signal",
		description:
			"dBFS of gain applied after compression (0 to 24 dB). Can be modulated by a static number or dynamic signal.",
	})
	.build();

export const CompressorNodeConfigSchema = compressorConfig.schema;

export type CompressorNodeConfig = z.infer<typeof CompressorNodeConfigSchema>;

export const CompressorResultSchema = z.union([
	AudioResultSchema,
	VideoResultSchema,
]);

export type CompressorResult = z.infer<typeof CompressorResultSchema>;

export const COMPRESSOR_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> = {
	Audio: "Audio",
	Video: "Video",
};
