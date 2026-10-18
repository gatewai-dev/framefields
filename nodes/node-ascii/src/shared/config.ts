import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const asciiConfig = configBuilder()
	.field("cellSize", z.number().min(4).max(64).default(10), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "cellSize",
		description: "Character cell size, px.",
	})
	.field("colorMode", z.enum(["mono", "source", "green"]).default("mono"), {
		bindable: false,
		label: "colorMode",
		description:
			"Glyph color: `fg`, the layer's own colors, or green phosphor.",
	})
	.field("fg", z.string().default("#e8e8e8"), {
		bindable: false,
		label: "fg",
		description: "Glyph color (mono).",
	})
	.field("bg", z.string().default("#0b0b0b"), {
		bindable: false,
		label: "bg",
		description: "Background color.",
	})
	.field("contrast", z.number().min(0.5).max(3).default(1.2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "contrast",
		description: "Brightness contrast before picking glyphs.",
	})
	.field("invert", z.boolean().default(false), {
		bindable: false,
		label: "invert",
		description: "Dark areas get dense glyphs.",
	})
	.build();

export const AsciiNodeConfigSchema = asciiConfig.schema;
export type AsciiNodeConfig = z.infer<typeof AsciiNodeConfigSchema>;
