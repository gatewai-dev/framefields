import { createOutputItemSchema } from "@framefields/core";
import { configBuilder } from "@framefields/node-sdk";
import { z } from "zod";

export const extractLutConfig = configBuilder()
	.field(
		"strategy",
		z.enum(["deterministic", "statistical"]).default("deterministic"),
		{
			bindable: false,
			label: "Extraction Strategy",
		},
	)
	.field("samplePoints", z.number().int().min(10).max(500).default(150), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Sample Points",
	})
	.build();

export const ExtractLutNodeConfigSchema = extractLutConfig.schema;

export type ExtractLutNodeConfig = z.infer<typeof ExtractLutNodeConfigSchema>;

export const ExtractLutResultSchema = createOutputItemSchema(
	z.literal("LUT"),
	z.any(),
);

export const ExtractLutNodeResultSchema = z.object({
	selectedOutputIndex: z.literal(0),
	outputs: z.tuple([z.object({ items: z.tuple([ExtractLutResultSchema]) })]),
});

export type ExtractLutNodeResult = z.infer<typeof ExtractLutNodeResultSchema>;
