import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const LiquifyDeformTypeSchema = z.enum([
	"Push",
	"Pull",
	"Bloat",
	"Pucker",
	"TwirlCW",
	"TwirlCCW",
]);

export type LiquifyDeformType = z.infer<typeof LiquifyDeformTypeSchema>;

export const LiquifyDeformSchema = z.object({
	type: LiquifyDeformTypeSchema.default("Bloat"),
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	radius: z.number().min(0.01).max(1.0).default(0.15),
	strength: z.number().min(0).max(1.0).default(0.5),
	dx: z.number().min(-1.0).max(1.0).default(0),
	dy: z.number().min(-1.0).max(1.0).default(0),
});

export type LiquifyDeformOperation = z.infer<typeof LiquifyDeformSchema>;

export const liquifyConfig = configBuilder()
	.field("operations", z.array(LiquifyDeformSchema).default([]), {
		label: "Operations",
		description: "List of localized liquify deformation operations.",
	})
	.build();

export const LiquifyNodeConfigSchema = liquifyConfig.schema;

export type LiquifyNodeConfig = z.infer<typeof LiquifyNodeConfigSchema>;

export const LiquifyResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type LiquifyResult = z.infer<typeof LiquifyResultSchema>;

export const LIQUIFY_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
