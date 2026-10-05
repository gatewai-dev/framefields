import { TextResultSchema } from "@framefields/node-sdk";
import { z } from "zod";

export const TextNodeConfigSchema = z
	.object({
		content: z.string().max(100000).default(""),
	})
	.strict();

export type TextNodeResult = z.infer<typeof TextResultSchema>;
export { TextResultSchema };
