/**
 * Performs a deep comparison between two values to determine if they are equivalent.
 * Handles primitives, objects, arrays, Dates, and NaNs.
 */
export function isEqual(a: any, b: any): boolean {
	if (a === b) return true;

	// Handle NaN
	if (
		typeof a === "number" &&
		typeof b === "number" &&
		Number.isNaN(a) &&
		Number.isNaN(b)
	) {
		return true;
	}

	if (a && b && typeof a === "object" && typeof b === "object") {
		if (a.constructor !== b.constructor) return false;

		if (Array.isArray(a)) {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				if (!isEqual(a[i], b[i])) return false;
			}
			return true;
		}

		if (a instanceof Date) return a.getTime() === (b as Date).getTime();
		if (a instanceof RegExp) return a.toString() === (b as RegExp).toString();

		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;

		for (const key of keys) {
			if (!Object.hasOwn(b, key)) return false;
			if (!isEqual(a[key], b[key])) return false;
		}

		return true;
	}

	return false;
}
