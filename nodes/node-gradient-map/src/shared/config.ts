import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const GradientStopSchema = z.object({
	position: z.number().min(0).max(1),
	color: z.string(),
});

export type GradientStop = z.infer<typeof GradientStopSchema>;

export const gradientMapConfig = configBuilder()
	.field(
		"stops",
		z
			.array(GradientStopSchema)
			.min(2)
			.default([
				{ position: 0.0, color: "#000000" },
				{ position: 1.0, color: "#ffffff" },
			]),
	)
	.field("smooth", z.boolean().default(true))
	.field("dither", z.boolean().default(true))
	.field("opacity", z.number().min(0).max(1).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Opacity",
	})
	.build();

export const GradientMapNodeConfigSchema = gradientMapConfig.schema;

export type GradientMapNodeConfig = z.infer<typeof GradientMapNodeConfigSchema>;

export const GradientMapResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type GradientMapResult = z.infer<typeof GradientMapResultSchema>;

export const GradientMapOperationSchema = GradientMapNodeConfigSchema.extend({
	op: z.literal("GradientMap"),
	metadata: z.unknown().optional(),
});

export type GradientMapOperation = z.infer<typeof GradientMapOperationSchema>;

export const defaultGradientMapConfig: GradientMapNodeConfig =
	GradientMapNodeConfigSchema.parse({});

export interface GradientMapPreset {
	id: string;
	name: string;
	stops: GradientStop[];
}

export const GRADIENT_MAP_PRESETS: GradientMapPreset[] = [
	{
		id: "bw",
		name: "Black & White",
		stops: [
			{ position: 0.0, color: "#000000" },
			{ position: 1.0, color: "#ffffff" },
		],
	},
	{
		id: "sepia",
		name: "Sepia Tone",
		stops: [
			{ position: 0.0, color: "#1b0d00" },
			{ position: 0.45, color: "#6e441a" },
			{ position: 1.0, color: "#f0d8a8" },
		],
	},
	{
		id: "cyberpunk",
		name: "Cyberpunk",
		stops: [
			{ position: 0.0, color: "#0d0221" },
			{ position: 0.3, color: "#0f084b" },
			{ position: 0.65, color: "#00f5d4" },
			{ position: 1.0, color: "#f15bb5" },
		],
	},
	{
		id: "sunset",
		name: "Sunset Glow",
		stops: [
			{ position: 0.0, color: "#1a0529" },
			{ position: 0.35, color: "#7a1c5b" },
			{ position: 0.7, color: "#e85d04" },
			{ position: 1.0, color: "#ffba08" },
		],
	},
	{
		id: "thermal",
		name: "Thermal / Heatmap",
		stops: [
			{ position: 0.0, color: "#000004" },
			{ position: 0.25, color: "#3b0f70" },
			{ position: 0.5, color: "#8c2981" },
			{ position: 0.75, color: "#fe9f6d" },
			{ position: 1.0, color: "#fcfdbf" },
		],
	},
	{
		id: "emerald",
		name: "Emerald Deep",
		stops: [
			{ position: 0.0, color: "#031d16" },
			{ position: 0.4, color: "#0a5c36" },
			{ position: 0.8, color: "#34d399" },
			{ position: 1.0, color: "#ecfdf5" },
		],
	},
	{
		id: "blueprint",
		name: "Blueprint",
		stops: [
			{ position: 0.0, color: "#001233" },
			{ position: 0.4, color: "#003566" },
			{ position: 0.8, color: "#60a5fa" },
			{ position: 1.0, color: "#ffffff" },
		],
	},
	{
		id: "ultraviolet",
		name: "Ultraviolet",
		stops: [
			{ position: 0.0, color: "#060112" },
			{ position: 0.35, color: "#280b54" },
			{ position: 0.7, color: "#7928ca" },
			{ position: 1.0, color: "#f3e8ff" },
		],
	},
	{
		id: "golden-hour",
		name: "Golden Hour",
		stops: [
			{ position: 0.0, color: "#190e03" },
			{ position: 0.4, color: "#663300" },
			{ position: 0.75, color: "#d97706" },
			{ position: 1.0, color: "#fef3c7" },
		],
	},
	{
		id: "retro-duotone",
		name: "Teal & Crimson",
		stops: [
			{ position: 0.0, color: "#092327" },
			{ position: 0.5, color: "#00a896" },
			{ position: 1.0, color: "#ef233c" },
		],
	},
];

export const GRADIENT_MAP_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
