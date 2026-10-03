import z from "zod";

export const envSchema = z.object({
	BASE_URL: z.string().default("http://localhost:8081"),
	RENDERER_URL: z.string().optional(),
	NODE_ENV: z
		.enum(["development", "production", "staging", "test"])
		.default("development"),
	PORT: z.coerce.number().default(8081),
	LOG_LEVEL: z.string().default("info"),
	MAX_CONCURRENT_RENDERING_JOBS: z.coerce.number().default(100),

	// S3 / Object Storage Configuration
	R2_ASSETS_BUCKET: z.string().optional().default("local-assets"),
	R2_S3_API_ENDPOINT: z.string().optional().default("http://localhost:9000"),
	R2_ACCESS_KEY_ID: z.string().optional().default("local"),
	R2_SECRET_ACCESS_KEY: z.string().optional().default("local"),
	R2_CUSTOM_DOMAIN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;
