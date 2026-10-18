import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const pixelateConfig = configBuilder()
	.field("size", z.number().min(1).max(256).default(12), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "size",
		description: "Cell size, px.",
	})
	.field("shape", z.enum(["square", "circle", "diamond"]).default("square"), {
		bindable: false,
		label: "shape",
		description: "Cell shape: square pixels, round LEDs or diamonds.",
	})
	.field("gap", z.number().min(0).max(0.9).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "gap",
		description: "Space between cells, as a fraction of a cell (0 = touching).",
	})
	.build();

export const PixelateNodeConfigSchema = pixelateConfig.schema;
export type PixelateNodeConfig = z.infer<typeof PixelateNodeConfigSchema>;
