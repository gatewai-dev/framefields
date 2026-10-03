import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const MAX_STRENGTH = 100;

export const filmGrainConfig = configBuilder()
	.field("strength", z.number().min(0).max(MAX_STRENGTH).default(15), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Strength Signal",
		description:
			"The intensity of the film grain. 0 = no grain. Can be modulated by a static number or a dynamic signal.",
	})
	.field("size", z.number().min(0.5).max(4.0).default(1.5), {
		bindable: false,
		label: "Grain Size",
	})
	.field("monochrome", z.boolean().default(true), {
		bindable: false,
		label: "Monochrome",
	})
	.field("animated", z.boolean().default(true), {
		bindable: false,
		label: "Animated",
	})
	.field("speed", z.number().min(0).max(100).default(50), {
		bindable: false,
		label: "Evolution Speed",
	})
	.field("shadows", z.number().min(0.0).max(1.0).default(0.2), {
		bindable: false,
		label: "Shadow Response",
	})
	.field("midtones", z.number().min(0.0).max(1.0).default(1.0), {
		bindable: false,
		label: "Midtone Response",
	})
	.field("highlights", z.number().min(0.0).max(1.0).default(0.2), {
		bindable: false,
		label: "Highlight Response",
	})
	.build();

export const FilmGrainNodeConfigSchema = filmGrainConfig.schema;

export type FilmGrainNodeConfig = z.infer<typeof FilmGrainNodeConfigSchema>;

export const FilmGrainResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type FilmGrainResult = z.infer<typeof FilmGrainResultSchema>;

export const FILM_GRAIN_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
