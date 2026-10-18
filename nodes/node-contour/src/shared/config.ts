import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const contourConfig = configBuilder()
	.field("levels", z.number().int().min(2).max(64).default(14), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "levels",
		description: "Contour lines from dark to light.",
	})
	.field("lineWidth", z.number().min(0.5).max(8).default(1.2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "lineWidth",
		description: "Line width, px.",
	})
	.field("lineColor", z.string().default("#2b1d0e"), {
		bindable: false,
		label: "lineColor",
		description: "Line color.",
	})
	.field("fill", z.enum(["source", "flat", "none"]).default("source"), {
		bindable: false,
		label: "fill",
		description: "Under the lines: the layer, `fillColor`, or transparent.",
	})
	.field("fillColor", z.string().default("#f3ead8"), {
		bindable: false,
		label: "fillColor",
		description: "Paper color (flat fill).",
	})
	.field("smoothing", z.number().min(0).max(8).default(2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "smoothing",
		description: "Blur before tracing, px (smoother lines).",
	})
	.build();

export const ContourNodeConfigSchema = contourConfig.schema;
export type ContourNodeConfig = z.infer<typeof ContourNodeConfigSchema>;
