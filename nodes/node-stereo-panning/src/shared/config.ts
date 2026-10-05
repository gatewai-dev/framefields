import { AudioResultSchema, VideoResultSchema } from "@framefields/node-sdk";
import { z } from "zod";

export const StereoPanningNodeConfigSchema = z.object({
	pan: z
		.number()
		.min(-1)
		.max(1)
		.default(0)
		.describe(
			"Stereo panning value: -1 (full left) to 1 (full right), 0 is center",
		),
});

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
