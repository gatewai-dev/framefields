import { buildConfig, type RendererConfig } from "./config/schema.js";

/** A valid config for tests; `env` entries override the defaults. */
export function testConfig(env: Record<string, string> = {}): RendererConfig {
	const result = buildConfig(
		{
			FF_MODE: "http",
			FF_HTTP_INSECURE: "true",
			FF_REPO_ALLOWLIST: "github.com/acme/*",
			FF_CACHE_DIR: "/tmp/ff-test-cache",
			FF_WORK_DIR: "/tmp/ff-test-work",
			...env,
		},
		{ exists: () => false, tmpdir: () => "/tmp", homedir: () => "/home/test" },
	);
	if (!result.ok) {
		throw new Error(`testConfig: ${JSON.stringify(result.problems)}`);
	}
	return result.config;
}

export function testJob(overrides: Record<string, unknown> = {}) {
	return {
		version: 2,
		source: { repo: "https://github.com/acme/films.git", ref: "main" },
		target: { entry: "src/film.ts", export: "buildFilm" },
		output: { type: "inline" },
		...overrides,
	};
}
