import {
	AudioResultSchema,
	configBuilder,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const FadeCurveSchema = z.enum(["linear", "exponential", "scurve"]);

export const fadeConfig = configBuilder()
	.field("fadeInDuration", z.number().min(0.0).max(60.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Fade In Duration Signal",
		description:
			"Duration in seconds of fade in from silence (0 to 60s). Can be modulated by a static number or dynamic signal.",
	})
	.field("fadeOutDuration", z.number().min(0.0).max(60.0).default(0.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Fade Out Duration Signal",
		description:
			"Duration in seconds of fade out to silence (0 to 60s). Can be modulated by a static number or dynamic signal.",
	})
	.field("fadeInCurve", FadeCurveSchema.default("linear"), {
		bindable: false,
		label: "Fade In Curve",
		description: "Envelope shape for fade in",
	})
	.field("fadeOutCurve", FadeCurveSchema.default("linear"), {
		bindable: false,
		label: "Fade Out Curve",
		description: "Envelope shape for fade out",
	})
	.build();

export const FadeNodeConfigSchema = fadeConfig.schema;

export type FadeNodeConfig = z.infer<typeof FadeNodeConfigSchema>;

export const FadeResultSchema = z.union([AudioResultSchema, VideoResultSchema]);

export type FadeResult = z.infer<typeof FadeResultSchema>;

export const FADE_OUTPUT_TYPE_MAP: Record<string, "Audio" | "Video"> = {
	Audio: "Audio",
	Video: "Video",
};
