import { config } from "dotenv";
import { type EnvConfig, envSchema } from "./env-schema.js";
import { logger } from "./logger.js";

export { APP_VERSION } from "./version.js";

let _envConfig: EnvConfig | null = null;

export function setEnvConfig(customConfig: EnvConfig): void {
	_envConfig = customConfig;
}

export function getEnvConfig(): EnvConfig {
	if (!_envConfig) {
		config();
		const parsed = envSchema.safeParse(process.env);
		if (!parsed.success) {
			logger.error(
				{ err: parsed.error.format() },
				"❌ Invalid environment variables",
			);
			throw new Error("Invalid environment variables");
		}
		_envConfig = parsed.data;
	}
	return _envConfig;
}

export const ENV_CONFIG: EnvConfig = new Proxy({} as EnvConfig, {
	get(_target, prop, receiver) {
		return Reflect.get(getEnvConfig(), prop, receiver);
	},
	ownKeys() {
		return Reflect.ownKeys(getEnvConfig());
	},
	getOwnPropertyDescriptor(_target, prop) {
		return Reflect.getOwnPropertyDescriptor(getEnvConfig(), prop);
	},
	getPrototypeOf() {
		return Reflect.getPrototypeOf(getEnvConfig());
	},
});
