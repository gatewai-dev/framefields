import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@framefields/core";
import { z } from "zod";

export const CAPTION_GEN_MODELS = ["fal-ai/whisper"] as const;

export const WHISPER_LANGUAGES = [
	"af",
	"am",
	"ar",
	"as",
	"az",
	"ba",
	"be",
	"bg",
	"bn",
	"bo",
	"br",
	"bs",
	"ca",
	"cs",
	"cy",
	"da",
	"de",
	"el",
	"en",
	"es",
	"et",
	"eu",
	"fa",
	"fi",
	"fo",
	"fr",
	"gl",
	"gu",
	"ha",
	"haw",
	"he",
	"hi",
	"hr",
	"ht",
	"hu",
	"hy",
	"id",
	"is",
	"it",
	"ja",
	"jw",
	"ka",
	"kk",
	"km",
	"kn",
	"ko",
	"la",
	"lb",
	"ln",
	"lo",
	"lt",
	"lv",
	"mg",
	"mi",
	"mk",
	"ml",
	"mn",
	"mr",
	"ms",
	"mt",
	"my",
	"ne",
	"nl",
	"nn",
	"no",
	"oc",
	"pa",
	"pl",
	"ps",
	"pt",
	"ro",
	"ru",
	"sa",
	"sd",
	"si",
	"sk",
	"sl",
	"sn",
	"so",
	"sq",
	"sr",
	"su",
	"sv",
	"sw",
	"ta",
	"te",
	"tg",
	"th",
	"tk",
	"tl",
	"tr",
	"tt",
	"uk",
	"ur",
	"uz",
	"vi",
	"yi",
	"yo",
	"zh",
] as const;

export const CaptionGeneratorNodeConfigSchema = z
	.object({
		model: z.enum(CAPTION_GEN_MODELS).default("fal-ai/whisper"),
		task: z.literal("transcribe"),
		language: z
			.union([z.enum(WHISPER_LANGUAGES), z.literal("auto")])
			.default("auto"),
		chunk_level: z.enum(["segment", "word"]).default("segment"),
		batch_size: z.number().int().min(1).max(256).default(32),
	})
	.strict();

export type CaptionGeneratorNodeConfig = z.infer<
	typeof CaptionGeneratorNodeConfigSchema
>;

export const CaptionGeneratorResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("Caption"), VirtualMediaDataSchema),
);

export type CaptionGeneratorResult = z.infer<
	typeof CaptionGeneratorResultSchema
>;
