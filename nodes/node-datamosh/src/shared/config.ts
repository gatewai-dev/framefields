import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const datamoshConfig = configBuilder()
	.field("keyframes", z.array(z.number().int().min(0)).default([]), {
		bindable: false,
		label: "Keyframes",
		description:
			"Layer frames that show the clean picture again (I-frames). The first frame always does.",
	})
	.field("strength", z.number().min(0).max(10).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Strength",
		description: "How far pixels are dragged along the motion.",
	})
	.field("bleed", z.number().min(0).max(1).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Bleed",
		description: "Clean picture mixed back in per frame, 0–1.",
	})
	.field("warmup", z.number().int().min(1).max(240).default(48), {
		bindable: false,
		label: "Warmup",
		description: "Most frames replayed to rebuild the smear after a jump.",
	})
	.build();

export const DatamoshNodeConfigSchema = datamoshConfig.schema;
export type DatamoshNodeConfig = z.infer<typeof DatamoshNodeConfigSchema>;
