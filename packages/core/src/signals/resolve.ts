import { isSignal } from "./index.js";

/**
 * Unwraps a potential Signal, Signal-like object with `.peek()`,
 * or object with `.value`. Returns the raw value or the original object.
 */
function unwrapValue(val: unknown): unknown {
	if (val === null || typeof val !== "object") {
		return val;
	}
	if (isSignal(val)) {
		return val.peek();
	}
	if ("peek" in val && typeof (val as { peek: unknown }).peek === "function") {
		return (val as { peek: () => unknown }).peek();
	}
	if ("value" in val) {
		return (val as { value: unknown }).value;
	}
	return val;
}

/**
 * Extracts a numeric value from a primitive, Signal, or wrapper object.
 * Returns the fallback if undefined, null, NaN, or non-numeric.
 */
export function resolveNumber(val: unknown, fallback: number): number {
	const unwrapped = unwrapValue(val);
	return typeof unwrapped === "number" && !Number.isNaN(unwrapped)
		? unwrapped
		: fallback;
}

/**
 * Extracts a string value from a primitive, Signal, or wrapper object.
 * Returns the fallback if undefined, null, or non-string.
 */
export function resolveString(val: unknown, fallback: string): string {
	const unwrapped = unwrapValue(val);
	return typeof unwrapped === "string" ? unwrapped : fallback;
}

/**
 * Extracts a boolean value from a primitive, Signal, or wrapper object.
 * Returns the fallback if undefined, null, or non-boolean.
 */
export function resolveBoolean(val: unknown, fallback: boolean): boolean {
	const unwrapped = unwrapValue(val);
	return typeof unwrapped === "boolean" ? unwrapped : fallback;
}

/**
 * Generic parameter resolver matching the fallback value's type.
 */
export function resolveParam<T>(val: unknown, fallback: T): T {
	if (typeof fallback === "number") {
		return resolveNumber(val, fallback) as T;
	}
	if (typeof fallback === "string") {
		return resolveString(val, fallback) as T;
	}
	if (typeof fallback === "boolean") {
		return resolveBoolean(val, fallback) as T;
	}
	const unwrapped = unwrapValue(val);
	return unwrapped !== undefined && unwrapped !== null
		? (unwrapped as T)
		: fallback;
}
