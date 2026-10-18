import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const cRTConfig = configBuilder()
	.field("scanlines", z.number().min(0).max(1).default(0.45), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "scanlines",
		description: "Scanline darkness.",
	})
	.field("lineCount", z.number().int().min(100).max(2160).default(540), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "lineCount",
		description: "Scanlines over the height.",
	})
	.field("curvature", z.number().min(0).max(1).default(0.12), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "curvature",
		description: "Barrel distortion of the tube.",
	})
	.field("mask", z.number().min(0).max(1).default(0.25), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "mask",
		description: "RGB aperture-grille strength.",
	})
	.field("vignette", z.number().min(0).max(1).default(0.35), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "vignette",
		description: "Darkening toward the edges.",
	})
	.field("noise", z.number().min(0).max(1).default(0.08), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "noise",
		description: "Animated static.",
	})
	.field("flicker", z.number().min(0).max(1).default(0.03), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "flicker",
		description: "Brightness flicker.",
	})
	.field("tracking", z.number().min(0).max(1).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "tracking",
		description: "VHS tracking error: line jitter and a rolling band.",
	})
	.field("chroma", z.number().min(0).max(20).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "chroma",
		description: "VHS color bleed, px.",
	})
	.build();

export const CRTNodeConfigSchema = cRTConfig.schema;
export type CRTNodeConfig = z.infer<typeof CRTNodeConfigSchema>;
