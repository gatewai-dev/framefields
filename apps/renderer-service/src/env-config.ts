import { rendererLogger } from "@gitframes/server-utils";
import { config } from "dotenv";
import z from "zod";

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "staging", "test"])
		.default("development"),
	BASE_URL: z.url(),
	RENDERER_PORT: z.coerce
		.number()
		.default(() => Number(process.env.PORT || 8082)),
	R2_ACCESS_KEY_ID: z.string(),
	R2_SECRET_ACCESS_KEY: z.string(),
	R2_S3_API_ENDPOINT: z.string(),
	R2_ASSETS_BUCKET: z.string(),
	R2_CUSTOM_DOMAIN: z.string().optional(),
});

config();

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	const formatted = parsed.error.format();
	console.error(
		"❌ Invalid environment variables:",
		JSON.stringify(formatted, null, 2),
	);
	rendererLogger.error(
		{ err: z.treeifyError(parsed.error) },
		"❌ Invalid environment variables",
	);
	throw new Error(
		`Invalid environment variables: ${JSON.stringify(formatted)}`,
	);
}
export const RENDERER_ENV_CONFIG = parsed.data;

export type RendererEnvConfig = z.infer<typeof envSchema>;
