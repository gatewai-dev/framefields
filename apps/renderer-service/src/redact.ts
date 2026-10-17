/**
 * Strips credentials from anything that leaves the worker: logs, job results
 * and error messages (PLAN.md §9).
 */

const MIN_SECRET_LENGTH = 6;
const secrets = new Set<string>();

/** Registers a value that must never appear in output. */
export function registerSecret(value: string | undefined): void {
	if (value && value.length >= MIN_SECRET_LENGTH) secrets.add(value);
}

export function clearSecrets(): void {
	secrets.clear();
}

// user:pass@ or token@ in any scheme://… URL
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;
// Query strings carrying signatures (S3/R2 presigned URLs, SAS tokens, …)
const SIGNED_QUERY =
	/(https?:\/\/[^\s?"']+)\?[^\s"']*(?:X-Amz-Signature|X-Amz-Credential|Signature|sig|token|access_token)=[^\s"']*/gi;

export function redact(text: string): string {
	let out = text
		.replace(URL_USERINFO, "$1***@")
		.replace(SIGNED_QUERY, "$1?***");
	for (const secret of secrets) {
		if (out.includes(secret)) out = out.split(secret).join("***");
	}
	return out;
}

/** Deep-redacts strings inside JSON-like values. */
export function redactValue<T>(value: T): T {
	if (typeof value === "string") return redact(value) as T;
	if (Array.isArray(value)) return value.map(redactValue) as T;
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = redactValue(v);
		return out as T;
	}
	return value;
}
