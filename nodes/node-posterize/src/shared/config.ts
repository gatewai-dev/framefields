import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const posterizeConfig = configBuilder()
	.field("levels", z.number().int().min(2).max(64).default(6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "levels",
		description: "Steps per channel when no palette is set.",
	})
	.field(
		"palette",
		z
			.enum([
				"none",
				"gameboy",
				"teletext",
				"cga",
				"pico8",
				"c64",
				"grayscale",
				"sepia",
				"custom",
			])
			.default("none"),
		{
			bindable: false,
			label: "palette",
			description: "Snap to a retro palette, or `custom` to use `colors`.",
		},
	)
	.field("colors", z.array(z.string()).max(16).default([]), {
		bindable: false,
		label: "colors",
		description:
			"Your palette (up to 16 hex colors), used when `palette` is `custom`.",
	})
	.field("dither", z.number().min(0).max(1).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "dither",
		description: "Ordered (Bayer) dithering between steps, 0\u20131.",
	})
	.field("pixelSize", z.number().min(1).max(64).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "pixelSize",
		description: "Pixel size, px: above 1 for pixel art.",
	})
	.build();

export const PosterizeNodeConfigSchema = posterizeConfig.schema;
export type PosterizeNodeConfig = z.infer<typeof PosterizeNodeConfigSchema>;
