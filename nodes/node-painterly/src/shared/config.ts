import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const painterlyConfig = configBuilder()
	.field("style", z.enum(["oil", "watercolor"]).default("oil"), {
		bindable: false,
		label: "style",
		description: "Oil (dense strokes) or watercolor (wet edges, paper).",
	})
	.field("radius", z.number().int().min(2).max(12).default(5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "radius",
		description: "Brush size, px.",
	})
	.field("edgeDarkening", z.number().min(0).max(1).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "edgeDarkening",
		description: "Watercolor: pigment pooling at patch edges.",
	})
	.field("paper", z.number().min(0).max(1).default(0.3), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "paper",
		description: "Paper / canvas grain.",
	})
	.field("saturation", z.number().min(0).max(2).default(1.05), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "saturation",
		description: "Color saturation.",
	})
	.build();

export const PainterlyNodeConfigSchema = painterlyConfig.schema;
export type PainterlyNodeConfig = z.infer<typeof PainterlyNodeConfigSchema>;
