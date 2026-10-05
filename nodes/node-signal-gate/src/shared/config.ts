import { SignalDataSchema } from "@framefields/core";
import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const GateModeSchema = z.enum(["gate", "trigger", "toggle"]);
export type GateMode = z.infer<typeof GateModeSchema>;

export const SignalGateConfigSchema = z.object({
	threshold: z.number().min(0).max(1).default(0.5),
	debounceMs: z.number().min(0).max(5000).default(100),
	mode: GateModeSchema.default("gate"),
	holdFrames: z.number().min(1).max(120).default(4),
	invert: z.boolean().default(false),
});

export type SignalGateConfig = z.infer<typeof SignalGateConfigSchema>;

export const SignalGateResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("Signal"), SignalDataSchema),
);

export type SignalGateResult = z.infer<typeof SignalGateResultSchema>;
