import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import pino from "pino";

/** The service's version, from src/ (tests, dev) or dist/src/ (build). */
const version = (() => {
	for (const rel of ["../package.json", "../../package.json"]) {
		try {
			const pkg = JSON.parse(
				readFileSync(new URL(rel, import.meta.url), "utf8"),
			) as {
				name?: string;
				version?: string;
			};
			if (pkg.name === "@framefields/renderer-service" && pkg.version)
				return pkg.version;
		} catch {
			// try the next location
		}
	}
	return "unknown";
})();

/** Per-job / per-request fields merged into every log line. */
export const loggerContext = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Adds the context to a log line. Returns a copy: pino merges each call's
 * fields into the object mixin returns, which would otherwise leak them into
 * the job's later log lines.
 */
export function contextMixin(): Record<string, unknown> {
	return { ...loggerContext.getStore() };
}

export const logger = pino({
	level: process.env.LOG_LEVEL || "info",
	timestamp: pino.stdTimeFunctions.isoTime,
	base: { service: "framefields-renderer", version },
	mixin: contextMixin,
	redact: {
		paths: [
			"req.headers.authorization",
			"headers.authorization",
			"token",
			"password",
		],
		remove: true,
	},
});

export const apiLogger = logger.child({ component: "api" });
export const rendererLogger = logger.child({ component: "renderer" });
