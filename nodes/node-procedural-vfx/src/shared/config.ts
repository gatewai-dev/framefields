import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const VFX_EFFECT_TYPES = [
	"Smoke",
	"Fire",
	"Rain",
	"Sparks",
	"Snow",
	"Dust",
	"Lightning",
	"Magic",
	"LensFlare",
	"Embers",
	"EnergyBeam",
] as const;

export const proceduralVFXConfig = configBuilder()
	.field("effectType", z.enum(VFX_EFFECT_TYPES).default("Smoke"), {
		bindable: false,
		label: "Effect Type",
		description: "Which procedural particle / light effect to synthesize.",
	})
	.field("outputType", z.enum(["Image", "Video"]).default("Video"), {
		bindable: false,
		label: "Output Type",
		description: "Image renders a static frame; Video animates over time.",
	})
	.field("width", z.number().int().min(16).max(4096).default(1080), {
		bindable: false,
		label: "Width",
	})
	.field("height", z.number().int().min(16).max(4096).default(1080), {
		bindable: false,
		label: "Height",
	})
	.field("density", z.number().min(0.0).max(1.0).default(0.6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Density Signal",
		description:
			"Amount of particles / coverage of the effect. Can be modulated by a static number or dynamic signal.",
	})
	.field("scale", z.number().min(0.001).max(10.0).default(0.01), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Scale Signal",
		description:
			"Spatial frequency / particle size of the effect. Can be modulated by a signal.",
	})
	.field("speed", z.number().min(0.0).max(10.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Speed Signal",
		description: "Animation speed in Video mode. Can be modulated by a signal.",
	})
	.field("intensity", z.number().min(0.0).max(1.0).default(0.8), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Intensity Signal",
		description:
			"Brightness / alpha gain of the effect. Can be modulated by a signal.",
	})
	.field("seed", z.number().int().min(0).max(1000000).default(1234), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Seed Signal",
		description:
			"Deterministic shuffle of the random pattern. Can be modulated by a signal.",
	})
	.field(
		"colorStart",
		z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a valid hex color starting with #",
			)
			.default("#ffffff"),
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
			.default("#ff5500"),
		{
			bindable: false,
			label: "Color End",
		},
	)
	.field("durationMs", z.number().int().min(100).max(100000).default(5000), {
		bindable: false,
		label: "Duration (ms)",
	})
	.field("fps", z.number().int().min(1).max(120).default(30), {
		bindable: false,
		label: "FPS",
	})
	.build();

export const ProceduralVFXNodeConfigSchema = proceduralVFXConfig.schema;

export type ProceduralVFXNodeConfig = z.infer<
	typeof ProceduralVFXNodeConfigSchema
>;

export const ProceduralVFXResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type ProceduralVFXResult = z.infer<typeof ProceduralVFXResultSchema>;
