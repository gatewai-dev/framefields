/**
 * Compile-time exhaustiveness check helper for discriminated unions and enums.
 *
 * In switch statements or if-else ladders, passing the unhandled variable to
 * `assertNever(x)` will fail TypeScript compilation if any variant was missed.
 * At runtime, if an unexpected value arrives (e.g. from unvalidated JSON), it throws
 * a descriptive Error.
 */
export function assertNever(value: never, message?: string): never {
	const detail =
		typeof value === "object" && value !== null
			? JSON.stringify(value)
			: String(value);
	throw new Error(message ?? `Unhandled union variant: ${detail}`);
}
