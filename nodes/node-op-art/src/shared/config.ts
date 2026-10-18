import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const opArtConfig = configBuilder()
	.field(
		"pattern",
		z.enum(["stripes", "rings", "checker", "waves"]).default("stripes"),
		{ bindable: false, label: "pattern", description: "Line pattern." },
	)
	.field("frequency", z.number().min(2).max(300).default(48), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "frequency",
		description: "Lines across the height.",
	})
	.field("angle", z.number().min(-360).max(360).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "angle",
		description: "Pattern angle, degrees.",
	})
	.field("warp", z.number().min(0).max(3).default(0.6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "warp",
		description: "How far brightness bends the lines.",
	})
	.field("source", z.number().min(0).max(1).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "source",
		description: "How much darks thicken the lines (0 = even lines).",
	})
	.field("colorA", z.string().default("#0a0a0a"), {
		bindable: false,
		label: "colorA",
		description: "Line color.",
	})
	.field("colorB", z.string().default("#f5f5f5"), {
		bindable: false,
		label: "colorB",
		description: "Gap color.",
	})
	.build();

export const OpArtNodeConfigSchema = opArtConfig.schema;
export type OpArtNodeConfig = z.infer<typeof OpArtNodeConfigSchema>;
