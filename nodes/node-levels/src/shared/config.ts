import { ImageResultSchema, VideoResultSchema } from "@gitframes/node-sdk";
import { z } from "zod";

export const LevelChannelSchema = z
	.object({
		inBlack: z.number().min(0).max(1).default(0),
		inWhite: z.number().min(0).max(1).default(1),
		outBlack: z.number().min(0).max(1).default(0),
		outWhite: z.number().min(0).max(1).default(1),
	})
	.strict()
	.superRefine((val, ctx) => {
		if (val.inBlack >= val.inWhite) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["inWhite"],
				message: "inWhite must be greater than inBlack",
			});
		}
		if (val.outBlack >= val.outWhite) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["outWhite"],
				message: "outWhite must be greater than outBlack",
			});
		}
	});

export type LevelChannel = z.infer<typeof LevelChannelSchema>;

export const LevelsNodeConfigSchema = z
	.object({
		master: LevelChannelSchema.default({
			inBlack: 0,
			inWhite: 1,
			outBlack: 0,
			outWhite: 1,
		}),
		red: LevelChannelSchema.default({
			inBlack: 0,
			inWhite: 1,
			outBlack: 0,
			outWhite: 1,
		}),
		green: LevelChannelSchema.default({
			inBlack: 0,
			inWhite: 1,
			outBlack: 0,
			outWhite: 1,
		}),
		blue: LevelChannelSchema.default({
			inBlack: 0,
			inWhite: 1,
			outBlack: 0,
			outWhite: 1,
		}),
	})
	.strict();

export type LevelsNodeConfig = z.infer<typeof LevelsNodeConfigSchema>;

export const LevelsResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type LevelsResult = z.infer<typeof LevelsResultSchema>;

export const LevelsOperationSchema = LevelsNodeConfigSchema.extend({
	op: z.literal("Levels"),
	metadata: z.unknown().optional(),
});

export type LevelsOperation = z.infer<typeof LevelsOperationSchema>;

export const defaultLevelChannel: LevelChannel = {
	inBlack: 0,
	inWhite: 1,
	outBlack: 0,
	outWhite: 1,
};

export const defaultLevelsConfig: LevelsNodeConfig = {
	master: { ...defaultLevelChannel },
	red: { ...defaultLevelChannel },
	green: { ...defaultLevelChannel },
	blue: { ...defaultLevelChannel },
};

export const LEVELS_OUTPUT_TYPE_MAP: Record<string, "Image" | "Video" | "GIF"> =
	{
		Video: "Video",
		Lottie: "Video",
		GIF: "GIF",
		Image: "Image",
		SVG: "Image",
	};
