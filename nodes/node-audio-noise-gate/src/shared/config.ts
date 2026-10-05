import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const noiseGateConfig = configBuilder()
	.field("threshold", z.number().min(-120).max(0).default(-40), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Threshold Signal",
		description:
			"dBFS level below which the gate closes (-120 to 0 dB). Can be modulated by a static number or dynamic signal.",
	})
	.field("attack", z.number().min(0.0001).max(1.0).default(0.005), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Attack Signal",
		description:
			"Seconds to open (fade in) when signal exceeds threshold (0.0001 to 1.0s). Can be modulated by a static number or dynamic signal.",
	})
	.field("hold", z.number().min(0.001).max(5.0).default(0.05), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Hold Signal",
		description:
			"Seconds to stay open after signal drops below threshold (0.001 to 5.0s). Can be modulated by a static number or dynamic signal.",
	})
	.field("release", z.number().min(0.01).max(5.0).default(0.1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Release Signal",
		description:
			"Seconds to close (fade out) after hold expires (0.01 to 5.0s). Can be modulated by a static number or dynamic signal.",
	})
	.field("range", z.number().min(-120).max(0).default(-80), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Floor Range Signal",
		description:
			"dBFS floor when gate is closed (-120 to 0 dB). Can be modulated by a static number or dynamic signal.",
	})
	.build();

export const NoiseGateNodeConfigSchema = noiseGateConfig.schema;

export type NoiseGateNodeConfig = z.infer<typeof NoiseGateNodeConfigSchema>;

export const NoiseGateResultSchema = z.union([
	AudioResultSchema,
	VideoResultSchema,
]);

export type NoiseGateResult = z.infer<typeof NoiseGateResultSchema>;

export const NOISE_GATE_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> = {
	Audio: "Audio",
	Video: "Video",
};
