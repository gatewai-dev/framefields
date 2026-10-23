import pino, { type DestinationStream } from "pino";

const env = typeof process !== "undefined" ? process.env : undefined;

/**
 * "json" (pino lines, for log collectors) or "text" (one short line each, for
 * people and agents reading a terminal). `FRAMEFIELDS_LOG_FORMAT` picks one;
 * otherwise production is JSON and everything else text.
 */
export function resolveLogFormat(
	vars: Record<string, string | undefined> | undefined = env,
): "json" | "text" {
	const format = vars?.FRAMEFIELDS_LOG_FORMAT?.toLowerCase();
	if (format === "json" || format === "text") return format;
	return vars?.NODE_ENV === "production" ? "json" : "text";
}

const LEVEL_TAGS: Record<number, string> = {
	40: "warn: ",
	50: "error: ",
	60: "fatal: ",
};

/**
 * Turns pino's JSON lines into `[framefields] Rendered 40% (…)`: the message
 * without its `[Component]` prefix, the level only for warnings and errors,
 * and an error's message (its stack reaches the caller with the throw).
 */
export function textLogStream(
	write: (line: string) => void = (line) => process.stderr.write(line),
): DestinationStream {
	return {
		write(json: string) {
			let entry: { level?: number; msg?: unknown; err?: { message?: string } };
			try {
				entry = JSON.parse(json);
			} catch {
				write(json);
				return;
			}
			const msg = String(entry.msg ?? "").replace(/^\[[^\]]+\]\s*/, "");
			const tag = LEVEL_TAGS[entry.level ?? 0] ?? "";
			const err = entry.err?.message ? `: ${entry.err.message}` : "";
			write(`[framefields] ${tag}${msg}${err}\n`);
		},
	};
}

const options = {
	level: env?.LOG_LEVEL || "info",
	timestamp: pino.stdTimeFunctions.isoTime,
	base: {
		component: "renderer",
	},
};

export const rendererLogger =
	resolveLogFormat() === "text"
		? pino(options, textLogStream())
		: pino(options);
