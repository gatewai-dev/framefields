import { z } from "zod";

export const TransitionTypeSchema = z.enum([
	"none",
	"crossfade",
	"wipe-left",
	"wipe-right",
	"slide-up",
	"slide-down",
]);

export const TransitionSchema = z.object({
	type: TransitionTypeSchema,
	durationFrames: z.number().min(1),
});

export type TransitionType = z.infer<typeof TransitionTypeSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
