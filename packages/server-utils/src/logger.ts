import pino from "pino";
import { APP_VERSION } from "./version.js";

// Global context explicitly for logger
// We initialize it with a dummy fallback for browser compatibility
export let loggerContext: {
	getStore(): Record<string, unknown> | undefined;
	run<R, TArgs extends unknown[]>(
		store: Record<string, unknown>,
		callback: (...args: TArgs) => R,
		...args: TArgs
	): R;
} = {
	getStore: () => undefined,
	run: (_store, callback, ...args) => callback(...args),
};

if (typeof (globalThis as { window?: unknown }).window === "undefined") {
	// Node environment: Replace with real AsyncLocalStorage asynchronously
	// We use /* @vite-ignore */ to prevent Vite from warning about node-only modules
	import(/* @vite-ignore */ "node:async_hooks")
		.then((module) => {
			if (module?.AsyncLocalStorage) {
				loggerContext = new module.AsyncLocalStorage<Record<string, unknown>>();
			}
		})
		.catch(() => {
			// Fallback if unavailable
		});
}

// Define Logger interface to match what we had in types
export interface Logger {
	trace: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
	fatal: (...args: unknown[]) => void;
}

const targets: pino.TransportTargetOptions[] = [];
export const logger = pino({
	level: (typeof process !== "undefined" && process.env?.LOG_LEVEL) || "info",
	timestamp: pino.stdTimeFunctions.isoTime,
	base: {
		env:
			(typeof process !== "undefined" && process.env?.NODE_ENV) ||
			"development",
		version: APP_VERSION || "unknown",
	},
	mixin() {
		return loggerContext.getStore() || {};
	},
	redact: {
		paths: [
			"email",
			"password",
			"accessToken",
			"refreshToken",
			"req.headers.authorization",
			"req.headers.x-api-key",
		],
		remove: true,
	},
	...(targets.length > 0 && {
		transport: {
			targets,
		},
	}),
});

export const apiLogger = logger.child({ component: "api" });
export const mediaLogger = logger.child({ component: "media" });
export const rendererLogger = logger.child({ component: "renderer" });
