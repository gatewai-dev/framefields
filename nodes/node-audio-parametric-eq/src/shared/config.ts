import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const ParametricEqFilterTypeSchema = z.enum([
	"lowShelf",
	"highShelf",
	"peak",
	"lowPass",
	"highPass",
	"notch",
]);

export const parametricEqConfig = configBuilder()
	.field("type", ParametricEqFilterTypeSchema.default("peak"), {
		bindable: false,
		label: "Filter Type",
		description: "Type of biquad filter",
	})
	.field("frequency", z.number().int().min(20).max(20000).default(1000), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Frequency Signal",
		description:
			"Cutoff or center frequency in Hz (20 to 20000 Hz). Can be modulated by a static number or dynamic signal.",
	})
	.field("gain", z.number().min(-24).max(24).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Gain Boost / Cut Signal",
		description:
			"Gain boost or cut in dB (-24 to 24 dB). Can be modulated by a static number or dynamic signal.",
	})
	.field("q", z.number().min(0.01).max(10).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Q (Resonance) Signal",
		description:
			"Filter bandwidth / Q factor (0.01 to 10.0). Can be modulated by a static number or dynamic signal.",
	})
	.build();

export const ParametricEqNodeConfigSchema = parametricEqConfig.schema;

export type ParametricEqNodeConfig = z.infer<
	typeof ParametricEqNodeConfigSchema
>;

export const ParametricEqResultSchema = z.union([
	AudioResultSchema,
	VideoResultSchema,
]);

export type ParametricEqResult = z.infer<typeof ParametricEqResultSchema>;

export const PARAMETRIC_EQ_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> =
	{
		Audio: "Audio",
		Video: "Video",
	};
