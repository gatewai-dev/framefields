/**
 * Small per-viewer preferences, kept in the browser. Storage can be missing
 * or refuse (private windows, blocked site data): then the default holds.
 */
const PREFIX = "framefields-preview:";

export function readPref<T extends string>(
	key: string,
	allowed: readonly T[],
	fallback: T,
): T {
	try {
		const v = localStorage.getItem(PREFIX + key);
		return allowed.find((a) => a === v) ?? fallback;
	} catch {
		return fallback;
	}
}

export function writePref(key: string, value: string): void {
	try {
		localStorage.setItem(PREFIX + key, value);
	} catch {}
}
