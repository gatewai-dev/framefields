import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const lutConfig = configBuilder()
	.field("intensity", z.number().min(0).max(10).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Intensity Signal",
	})
	.build();

export const LutNodeConfigSchema = lutConfig.schema;

export type LutNodeConfig = z.infer<typeof LutNodeConfigSchema>;

export const LutResultSchema = z.union([ImageResultSchema, VideoResultSchema]);

export type LutResult = z.infer<typeof LutResultSchema>;

export const LUT_OUTPUT_TYPE_MAP: Record<string, "Image" | "Video" | "GIF"> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
