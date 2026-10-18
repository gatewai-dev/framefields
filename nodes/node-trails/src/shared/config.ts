import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const TRAILS_MODES = ["blend", "over", "add", "max"] as const;

export const trailsConfig = configBuilder()
	.field("decay", z.number().min(0).max(1).default(0.9), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Decay",
		description:
			"History kept per frame, 0–1: 0.8 short echoes, 0.97 long light trails.",
	})
	.field("mode", z.enum(TRAILS_MODES).default("blend"), {
		bindable: false,
		label: "Mode",
		description:
			"blend: running average (echoes on full-frame footage); over: the layer over its fading past (cutouts, text); add: glows build up (light painting); max: keeps the brightest.",
	})
	.field("zoom", z.number().min(0.5).max(2).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Zoom",
		description: "History scale per frame; 1.02 pulls the past into a tunnel.",
	})
	.field("rotation", z.number().min(-45).max(45).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Rotation",
		description: "History rotation per frame, degrees.",
	})
	.field("offsetX", z.number().min(-500).max(500).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Offset X",
		description: "History drift per frame, px.",
	})
	.field("offsetY", z.number().min(-500).max(500).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Offset Y",
		description: "History drift per frame, px.",
	})
	.field("hueShift", z.number().min(-180).max(180).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Hue Shift",
		description:
			"History hue rotation per frame, degrees (psychedelic cycling).",
	})
	.field("warmup", z.number().int().min(0).max(240).default(60), {
		bindable: false,
		label: "Warmup",
		description:
			"Most frames replayed to rebuild the history after a jump (scrubbing, a single frame render).",
	})
	.build();

export const TrailsNodeConfigSchema = trailsConfig.schema;
export type TrailsNodeConfig = z.infer<typeof TrailsNodeConfigSchema>;
export type TrailsMode = (typeof TRAILS_MODES)[number];
