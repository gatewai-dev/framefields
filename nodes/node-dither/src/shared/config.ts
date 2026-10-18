import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const ditherConfig = configBuilder()
	.field("mode", z.enum(["bayer", "noise", "halftone"]).default("bayer"), {
		bindable: false,
		label: "mode",
		description:
			"Pattern: Bayer matrix, blue-ish noise or round halftone dots.",
	})
	.field("levels", z.number().int().min(2).max(16).default(2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "levels",
		description: "Levels per channel (2 = 1-bit).",
	})
	.field("scale", z.number().min(1).max(16).default(2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "scale",
		description: "Dither pixel size, px.",
	})
	.field("monochrome", z.boolean().default(true), {
		bindable: false,
		label: "monochrome",
		description:
			"Map brightness to the dark \u2192 light colors instead of dithering each channel.",
	})
	.field("dark", z.string().default("#111111"), {
		bindable: false,
		label: "dark",
		description: "Dark color (monochrome).",
	})
	.field("light", z.string().default("#f2efe6"), {
		bindable: false,
		label: "light",
		description: "Light color (monochrome).",
	})
	.build();

export const DitherNodeConfigSchema = ditherConfig.schema;
export type DitherNodeConfig = z.infer<typeof DitherNodeConfigSchema>;
