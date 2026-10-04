/** Debug output: shown only with LOG_LEVEL=debug or trace. */
export const DEBUG_LOGS =
	typeof process !== "undefined" &&
	/^(debug|trace)$/i.test(process.env?.LOG_LEVEL ?? "");

export function debugLog(...args: unknown[]): void {
	if (DEBUG_LOGS) console.debug(...args);
}
