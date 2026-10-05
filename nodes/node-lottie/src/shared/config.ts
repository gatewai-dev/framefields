import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@framefields/core";
import { z } from "zod";

export const LOTTIE_NODE_MODELS = [
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.6-sol",
	"google/gemini-3.8-flash",
	"anthropic/claude-fable-5.1",
] as const;

export const MAX_REFERENCE_IMAGES = 8;

export const LottieNodeConfigSchema = z
	.object({
		model: z.enum(LOTTIE_NODE_MODELS).default("gpt-5.6-terra"),
		width: z.number().int().min(16).max(4096).default(512),
		height: z.number().int().min(16).max(4096).default(512),
		fps: z.number().int().min(12).max(60).default(24),
		durationSeconds: z.number().min(0.5).max(30).default(2),
	})
	.strict();

export type LottieNodeConfig = z.infer<typeof LottieNodeConfigSchema>;

export const LottieResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("Lottie"), VirtualMediaDataSchema),
);

export type LottieResult = z.infer<typeof LottieResultSchema>;
