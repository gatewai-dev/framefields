import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const stereoPanningConfig = configBuilder()
	.field("pan", z.number().min(-1).max(1).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Stereo Panning",
		description:
			"Stereo panning value: -1 (full left) to 1 (full right), 0 is center. Can be modulated by a static number or dynamic signal.",
	})
	.build();

export const StereoPanningNodeConfigSchema = stereoPanningConfig.schema;

export type StereoPanningNodeConfig = z.infer<
	typeof StereoPanningNodeConfigSchema
>;

export const StereoPanningResultSchema = z.union([
	AudioResultSchema,
	VideoResultSchema,
]);

export type StereoPanningResult = z.infer<typeof StereoPanningResultSchema>;

export const STEREO_PANNING_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> =
	{
		Audio: "Audio",
		Video: "Video",
	};
