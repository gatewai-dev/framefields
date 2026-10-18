import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const toonConfig = configBuilder()
	.field("levels", z.number().int().min(2).max(12).default(4), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "levels",
		description: "Brightness bands.",
	})
	.field("edgeThreshold", z.number().min(0).max(1).default(0.2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "edgeThreshold",
		description: "How strong an edge must be to get ink, 0\u20131.",
	})
	.field("edgeWidth", z.number().min(0.5).max(4).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "edgeWidth",
		description: "Ink line width, px.",
	})
	.field("edgeColor", z.string().default("#111111"), {
		bindable: false,
		label: "edgeColor",
		description: "Ink color.",
	})
	.field("saturation", z.number().min(0).max(2).default(1.15), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "saturation",
		description: "Color saturation after banding.",
	})
	.build();

export const ToonNodeConfigSchema = toonConfig.schema;
export type ToonNodeConfig = z.infer<typeof ToonNodeConfigSchema>;
