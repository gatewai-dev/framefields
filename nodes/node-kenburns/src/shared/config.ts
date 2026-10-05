import {
	createOutputItemSchema,
	MediaMetadataSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@framefields/core";
import { z } from "zod";

export const KEN_BURNS_EASING_OPTIONS = [
	"linear",
	"ease-in",
	"ease-out",
	"ease-in-out",
	"spring",
] as const;

export type KenBurnsEasing = (typeof KEN_BURNS_EASING_OPTIONS)[number];

export const KenBurnsKeyframeSchema = z.object({
	id: z.string().min(1).optional(),
	durationMs: z.number().int().min(0).max(20000),
	holdMs: z.number().int().min(0).max(20000).optional().default(1000),
	scale: z.number().min(1).max(20),
	x: z.number().min(0).max(100),
	y: z.number().min(0).max(100),
	easing: z.enum(KEN_BURNS_EASING_OPTIONS).default("ease-in-out").optional(),
});

export type KenBurnsKeyframe = z.infer<typeof KenBurnsKeyframeSchema>;

export const KEN_BURNS_ASPECT_RATIOS = [
	"16:9",
	"9:16",
	"21:9",
	"9:21",
	"1:1",
	"4:3",
	"3:2",
	"2:3",
	"4:5",
	"5:4",
] as const;

export type KenBurnsAspectRatio = (typeof KEN_BURNS_ASPECT_RATIOS)[number];

export const KenBurnsConfigBaseSchema = z
	.object({
		keyframes: z
			.array(KenBurnsKeyframeSchema)
			.default([])
			.superRefine((kfs, ctx) => {
				if (kfs.length >= 2) {
					for (let i = 0; i < kfs.length - 1; i++) {
						if (kfs[i].durationMs <= 0) {
							ctx.addIssue({
								code: z.ZodIssueCode.custom,
								path: [i, "durationMs"],
								message:
									"Intermediate keyframes must have a duration greater than 0",
							});
						}
					}
				}
			}),
		motionBlurSize: z.number().min(0).max(10).optional().default(1.5),
		movementStyle: z.enum(["spline", "direct"]).default("spline"),
		aspectRatio: z.enum(["input", ...KEN_BURNS_ASPECT_RATIOS]).default("input"),
	})
	.strict();

const transformLastKeyframe = <T extends { keyframes: KenBurnsKeyframe[] }>(
	data: T,
): T => {
	if (data.keyframes.length === 0) return data;
	const keyframes = [...data.keyframes];
	const lastIdx = keyframes.length - 1;
	keyframes[lastIdx] = {
		...keyframes[lastIdx],
		durationMs: 0,
	};
	return {
		...data,
		keyframes,
	};
};

export const KenBurnsConfigSchema = KenBurnsConfigBaseSchema.transform(
	transformLastKeyframe,
);

export type KenBurnsConfig = z.infer<typeof KenBurnsConfigSchema>;

export const KenBurnsOperationSchema = KenBurnsConfigBaseSchema.extend({
	op: z.literal("KenBurns"),
	metadata: MediaMetadataSchema.optional(),
	originalWidth: z.number().int().positive().optional(),
	originalHeight: z.number().int().positive().optional(),
}).transform(transformLastKeyframe);

export type KenBurnsOperation = z.infer<typeof KenBurnsOperationSchema>;

// Ken Burns always outputs a Video because it applies animation over time
export const KenBurnsResultSchema = SingleOutputGenericSchema(
	createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
);

export type KenBurnsResult = z.infer<typeof KenBurnsResultSchema>;
