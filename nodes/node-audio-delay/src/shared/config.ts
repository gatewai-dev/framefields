import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const delayConfig = configBuilder()
	.field("delayTime", z.number().min(0.001).max(5.0).default(0.25), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Delay Time Signal",
		description:
			"Delay time in seconds (0.001 to 5.0s). Can be modulated by a static number or dynamic signal.",
	})
	.field("feedback", z.number().min(0.0).max(0.95).default(0.4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Feedback Signal",
		description:
			"Amount of delayed signal fed back into delay line (0.0 to 0.95). Can be modulated by a static number or dynamic signal.",
	})
	.field("wet", z.number().min(0.0).max(1.0).default(0.3), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Wet Mix Signal",
		description:
			"Mix level of the wet delayed signal (0.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("dry", z.number().min(0.0).max(1.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Dry Mix Signal",
		description:
			"Mix level of the original dry signal (0.0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("pingPong", z.boolean().default(false), {
		bindable: false,
		label: "Ping Pong Mode",
		description: "Alternates echo reflections between left and right channels",
	})
	.build();

export const DelayNodeConfigSchema = delayConfig.schema;

export type DelayNodeConfig = z.infer<typeof DelayNodeConfigSchema>;

export const DelayResultSchema = z.union([
	AudioResultSchema,
	VideoResultSchema,
]);

export type DelayResult = z.infer<typeof DelayResultSchema>;

export const DELAY_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> = {
	Audio: "Audio",
	Video: "Video",
};
