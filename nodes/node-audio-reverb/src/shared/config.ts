import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const reverbConfig = configBuilder()
	.field("roomSize", z.number().min(0.0).max(0.98).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Room Size Signal",
		description:
			"Room decay, size of simulated space (0 to 0.98). Can be modulated by a static number or dynamic signal.",
	})
	.field("damping", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Damping Signal",
		description:
			"High-frequency absorption (0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("wet", z.number().min(0.0).max(1.0).default(0.3), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Wet Mix Signal",
		description:
			"Mix level of the wet reverberated signal (0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("dry", z.number().min(0.0).max(1.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Dry Mix Signal",
		description:
			"Mix level of the original dry signal (0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.field("width", z.number().min(0.0).max(1.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Stereo Width Signal",
		description:
			"Stereo spread of the reverb tail (0 to 1.0). Can be modulated by a static number or dynamic signal.",
	})
	.build();

export const ReverbNodeConfigSchema = reverbConfig.schema;

export type ReverbNodeConfig = z.infer<typeof ReverbNodeConfigSchema>;

export const ReverbResultSchema = z.union([
	AudioResultSchema,
	VideoResultSchema,
]);

export type ReverbResult = z.infer<typeof ReverbResultSchema>;

export const REVERB_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> = {
	Audio: "Audio",
	Video: "Video",
};
