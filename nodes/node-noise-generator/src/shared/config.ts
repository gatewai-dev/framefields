import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const noiseConfig = configBuilder()
	.field(
		"noiseType",
		z.enum(["Perlin", "Simplex", "Voronoi"]).default("Perlin"),
		{
			bindable: false,
			label: "Noise Type",
		},
	)
	.field("outputType", z.enum(["Image", "Video"]).default("Image"), {
		bindable: false,
		label: "Output Type",
	})
	.field("width", z.number().int().min(16).max(4096).default(512), {
		bindable: false,
		label: "Width",
	})
	.field("height", z.number().int().min(16).max(4096).default(512), {
		bindable: false,
		label: "Height",
	})
	.field("scale", z.number().min(0.1).max(100.0).default(10.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Scale Signal",
		description:
			"Scale of the noise pattern. Can be modulated by a static number or a dynamic signal.",
	})
	.field("octaves", z.number().int().min(1).max(8).default(4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Octaves Signal",
		description: "Fractal detail depth of the noise.",
	})
	.field("persistence", z.number().min(0.0).max(1.0).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Persistence Signal",
		description: "Roughness multiplier for each fractal octave.",
	})
	.field("lacunarity", z.number().min(1.0).max(4.0).default(2.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Lacunarity Signal",
		description: "Frequency spacing multiplier for each fractal octave.",
	})
	.field("speed", z.number().min(0.0).max(10.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Speed Signal",
		description: "Speed of time-based noise animation in Video mode.",
	})
	.field(
		"colorStart",
		z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#000000"),
		{
			bindable: false,
			label: "Color Start",
		},
	)
	.field(
		"colorEnd",
		z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#ffffff"),
		{
			bindable: false,
			label: "Color End",
		},
	)
	.field("durationMs", z.number().int().min(1).max(60000).default(5000), {
		bindable: false,
		label: "Duration (ms)",
	})
	.field("fps", z.number().int().min(1).max(120).default(30), {
		bindable: false,
		label: "FPS",
	})
	.build();

export const NoiseGeneratorNodeConfigSchema = noiseConfig.schema;

export type NoiseGeneratorNodeConfig = z.infer<
	typeof NoiseGeneratorNodeConfigSchema
>;

export const NoiseGeneratorResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type NoiseGeneratorResult = z.infer<typeof NoiseGeneratorResultSchema>;
