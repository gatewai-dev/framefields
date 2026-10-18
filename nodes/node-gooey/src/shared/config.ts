import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const gooeyConfig = configBuilder()
	.field("radius", z.number().min(1).max(60).default(12), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "radius",
		description: "Melt distance, px.",
	})
	.field("threshold", z.number().min(0).max(1).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "threshold",
		description: "Alpha cut, 0\u20131 (higher = thinner blobs).",
	})
	.field("softness", z.number().min(0.001).max(0.5).default(0.04), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "softness",
		description: "Edge softness.",
	})
	.build();

export const GooeyNodeConfigSchema = gooeyConfig.schema;
export type GooeyNodeConfig = z.infer<typeof GooeyNodeConfigSchema>;
