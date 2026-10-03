import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const MIN_DECONTAMINATE = 0;
export const MAX_DECONTAMINATE = 1;
export const MIN_RADIUS = 0.5;
export const MAX_RADIUS = 50;
export const MIN_SMOOTH = 0;
export const MAX_SMOOTH = 100;
export const MIN_FEATHER = 0;
export const MAX_FEATHER = 50;
export const MIN_SHIFT_EDGE = -100;
export const MAX_SHIFT_EDGE = 100;

export const MatteChannelEnum = z.enum([
	"Alpha",
	"Luminance",
	"Red",
	"Green",
	"Blue",
]);

export type MatteChannel = z.infer<typeof MatteChannelEnum>;

export const RefineEdgeOutputModeEnum = z.enum([
	"Composite",
	"MatteOnly",
	"DecontaminatedRGB",
]);

export type RefineEdgeOutputMode = z.infer<typeof RefineEdgeOutputModeEnum>;

export const refineEdgeConfig = configBuilder()
	.field(
		"decontaminateAmount",
		z
			.number()
			.multipleOf(0.01)
			.min(MIN_DECONTAMINATE)
			.max(MAX_DECONTAMINATE)
			.default(0.7),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Decontaminate Colors",
			description:
				"Amount of edge color spill decontamination/defringing (0.0–1.0).",
		},
	)
	.field(
		"radius",
		z.number().multipleOf(0.1).min(MIN_RADIUS).max(MAX_RADIUS).default(2.0),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Edge Detection Radius (px)",
			description:
				"Radius in pixels around alpha transitions to refine and decontaminate.",
		},
	)
	.field("smooth", z.number().min(MIN_SMOOTH).max(MAX_SMOOTH).default(5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Smoothness",
		description: "Matte edge smoothing curve intensity (0–100).",
	})
	.field(
		"feather",
		z.number().multipleOf(0.1).min(MIN_FEATHER).max(MAX_FEATHER).default(0.5),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Feather (px)",
			description: "Sub-pixel gaussian softness along the matte boundary.",
		},
	)
	.field(
		"shiftEdge",
		z.number().min(MIN_SHIFT_EDGE).max(MAX_SHIFT_EDGE).default(0),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Shift Edge (%)",
			description:
				"Contract (<0) or expand (>0) the edge boundary (-100% to +100%).",
		},
	)
	.field("matteChannel", MatteChannelEnum.default("Alpha"), {
		label: "Matte Channel",
		description:
			"Channel to extract matte from (Alpha, Luminance, Red, Green, Blue).",
	})
	.field("outputMode", RefineEdgeOutputModeEnum.default("Composite"), {
		label: "Output Mode",
		description:
			"Composite (decontaminated RGB + refined alpha), MatteOnly (grayscale mask), DecontaminatedRGB (clean RGB with full alpha).",
	})
	.build();

export const RefineEdgeNodeConfigSchema = refineEdgeConfig.schema;

export type RefineEdgeNodeConfig = z.infer<typeof RefineEdgeNodeConfigSchema>;

export const RefineEdgeResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type RefineEdgeResult = z.infer<typeof RefineEdgeResultSchema>;

export const REFINE_EDGE_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
