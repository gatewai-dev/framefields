import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const iridescenceConfig = configBuilder()
	.field("strength", z.number().min(0).max(1).default(0.6), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "strength",
		description: "How much rainbow, 0\u20131.",
	})
	.field("scale", z.number().min(0.1).max(10).default(2), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "scale",
		description: "Rainbow bands over the range.",
	})
	.field("shift", z.number().min(-3600).max(3600).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "shift",
		description: "Hue shift, degrees (animate it).",
	})
	.field("mode", z.enum(["luminance", "relief"]).default("relief"), {
		bindable: false,
		label: "mode",
		description:
			"Bands from brightness, or from the slope of the image (foil).",
	})
	.build();

export const IridescenceNodeConfigSchema = iridescenceConfig.schema;
export type IridescenceNodeConfig = z.infer<typeof IridescenceNodeConfigSchema>;
