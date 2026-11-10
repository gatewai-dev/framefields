/**
 * Errors and the engine's warnings go to the preview's terminal too, so
 * whoever runs it sees them without opening this tab. Each once: playback
 * repeats the same one per frame, so frame numbers don't make it new.
 */
import type { LogLine } from "../protocol.js";

export type Report = (level: LogLine["level"], parts: unknown[]) => void;

export function errorText(x: unknown): string {
	if (x instanceof Error || (typeof x === "object" && x && "message" in x)) {
		const { message, stack } = x as { message: unknown; stack?: unknown };
		const text = String(message);
		if (typeof stack === "string" && stack.includes(text))
			return stack.split("\n").slice(0, 4).join("\n");
		if (text) return text;
	}
	return typeof x === "string" ? x : String(x);
}

/** A reporter that sends each distinct line once, up to about a hundred. */
export function createReporter(send: (line: LogLine) => void): Report {
	const reported = new Set<string>();
	return (level, parts) => {
		const text = parts.map(errorText).join(" ").trim();
		const key = level + text.replace(/\d+/g, "#");
		if (!text || reported.has(key) || reported.size > 100) return;
		reported.add(key);
		send({ level, message: text.slice(0, 4000) });
	};
}

/**
 * Forwards `console.error` (from anywhere) and `console.warn` from the
 * engine (lines starting `[framefields]`, such as fonts and renderers).
 */
export function forwardConsole(console: Console, report: Report): void {
	const error = console.error.bind(console);
	const warn = console.warn.bind(console);
	console.error = (...args: unknown[]) => {
		error(...args);
		report("error", args);
	};
	console.warn = (...args: unknown[]) => {
		warn(...args);
		if (typeof args[0] === "string" && args[0].startsWith("[framefields]"))
			report("warning", args);
	};
}
