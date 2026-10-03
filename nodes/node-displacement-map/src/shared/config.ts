import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const displacementMapConfig = configBuilder()
	.field("strengthX", z.number().min(0).max(500).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Strength X Signal",
		description:
			"Horizontal displacement strength in pixels. Can be modulated by a static number or a dynamic signal.",
	})
	.field("strengthY", z.number().min(0).max(500).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Strength Y Signal",
		description:
			"Vertical displacement strength in pixels. Can be modulated by a static number or a dynamic signal.",
	})
	.field(
		"xChannel",
		z.enum(["Red", "Green", "Blue", "Alpha", "Luminance"]).default("Red"),
		{
			bindable: false,
			label: "X Channel",
		},
	)
	.field(
		"yChannel",
		z.enum(["Red", "Green", "Blue", "Alpha", "Luminance"]).default("Green"),
		{
			bindable: false,
			label: "Y Channel",
		},
	)
	.field("wrapMode", z.enum(["Clamp", "Repeat", "Mirror"]).default("Clamp"), {
		bindable: false,
		label: "Wrap Mode",
	})
	.build();

export const DisplacementMapNodeConfigSchema = displacementMapConfig.schema;

export type DisplacementMapNodeConfig = z.infer<
	typeof DisplacementMapNodeConfigSchema
>;

export const DisplacementMapResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type DisplacementMapResult = z.infer<typeof DisplacementMapResultSchema>;

export const DISPLACEMENT_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
