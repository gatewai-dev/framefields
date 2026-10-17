import { config as loadDotenv } from "dotenv";
import { registerSecret } from "../redact.js";
import { buildConfig, type RendererConfig, SECRET_ENV_KEYS } from "./schema.js";

export type { RendererConfig } from "./schema.js";

let current: RendererConfig | undefined;

/**
 * Parses the environment once. On failure, prints every problem and exits, so
 * a misconfigured worker never reports healthy.
 */
export function loadConfig(): RendererConfig {
	if (current) return current;
	loadDotenv({ quiet: true });

	const result = buildConfig(process.env);
	if (!result.ok) {
		const lines = result.problems.map((p) => `  - ${p.key}: ${p.message}`);
		console.error(`❌ CONFIG_INVALID\n${lines.join("\n")}`);
		process.exit(1);
	}
	current = result.config;

	for (const key of SECRET_ENV_KEYS) registerSecret(process.env[key]);
	for (const cred of Object.values(current.git.credentials)) {
		registerSecret(typeof cred === "string" ? cred : cred.token);
	}
	return current;
}

/**
 * Removes secrets from process.env so repo code rendered in this process
 * can't read them (PLAN.md §8.2). Call after loadConfig().
 */
export function scrubSecretEnv(): void {
	for (const key of SECRET_ENV_KEYS) delete process.env[key];
}

/** The config with secrets replaced, for the boot log. */
export function describeConfig(config: RendererConfig): unknown {
	const mask = (v: unknown) => (v ? "***" : undefined);
	return {
		...config,
		http: { ...config.http, apiKey: mask(config.http.apiKey) },
		git: {
			...config.git,
			token: mask(config.git.token),
			sshKey: mask(config.git.sshKey),
			credentials: Object.keys(config.git.credentials),
		},
		install: { ...config.install, npmrc: mask(config.install.npmrc) },
		storage: {
			...config.storage,
			accessKeyId: mask(config.storage.accessKeyId),
			secretAccessKey: mask(config.storage.secretAccessKey),
		},
	};
}
