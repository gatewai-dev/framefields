import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const rGBSplitConfig = configBuilder()
	.field("amount", z.number().min(0).max(200).default(8), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "amount",
		description: "Split distance, px.",
	})
	.field("angle", z.number().min(-360).max(360).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "angle",
		description: "Split direction, degrees (linear mode).",
	})
	.field("radial", z.boolean().default(false), {
		bindable: false,
		label: "radial",
		description: "Split outward from the center instead of along `angle`.",
	})
	.build();

export const RGBSplitNodeConfigSchema = rGBSplitConfig.schema;
export type RGBSplitNodeConfig = z.infer<typeof RGBSplitNodeConfigSchema>;
