import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const kaleidoscopeConfig = configBuilder()
	.field("segments", z.number().int().min(2).max(32).default(6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "segments",
		description: "Mirror segments.",
	})
	.field("rotation", z.number().min(-3600).max(3600).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "rotation",
		description: "Pattern rotation, degrees.",
	})
	.field("centerX", z.number().min(0).max(1).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "centerX",
		description: "Center, 0\u20131 across.",
	})
	.field("centerY", z.number().min(0).max(1).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "centerY",
		description: "Center, 0\u20131 down.",
	})
	.field("zoom", z.number().min(0.2).max(4).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "zoom",
		description: "Scale of the folded image.",
	})
	.build();

export const KaleidoscopeNodeConfigSchema = kaleidoscopeConfig.schema;
export type KaleidoscopeNodeConfig = z.infer<
	typeof KaleidoscopeNodeConfigSchema
>;
