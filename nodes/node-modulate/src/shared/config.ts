import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const modulateConfig = configBuilder()
	.field("hue", z.number().int().min(0).max(359).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Hue Signal",
	})
	.field("brightness", z.number().multipleOf(0.01).min(0).max(2).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Brightness Signal",
	})
	.field("contrast", z.number().multipleOf(0.01).min(0).max(2).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Contrast Signal",
	})
	.field("exposure", z.number().multipleOf(0.01).min(-2).max(2).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Exposure Signal",
	})
	.field("saturation", z.number().multipleOf(0.01).min(0).max(2).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Saturation Signal",
	})
	.field("sepia", z.number().multipleOf(0.01).min(0).max(1).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Sepia Signal",
	})
	.build();

export const ModulateNodeConfigSchema = modulateConfig.schema;

export type ModulateNodeConfig = z.infer<typeof ModulateNodeConfigSchema>;

export const ModulateResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type ModulateResult = z.infer<typeof ModulateResultSchema>;

export const ModulateOperationSchema = ModulateNodeConfigSchema.extend({
	op: z.literal("Modulate"),
	metadata: z.any().optional(),
});

export type ModulateOperation = z.infer<typeof ModulateOperationSchema>;

export const MODULATE_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
