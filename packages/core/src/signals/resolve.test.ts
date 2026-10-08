import { describe, expect, it } from "vitest";
import { Signal } from "./index.js";
import {
	resolveBoolean,
	resolveNumber,
	resolveParam,
	resolveString,
} from "./resolve.js";

describe("Signal and Parameter Resolvers", () => {
	it("resolves numbers with fallback", () => {
		expect(resolveNumber(42, 0)).toBe(42);
		expect(resolveNumber(0, 10)).toBe(0);
		expect(resolveNumber(-15.5, 0)).toBe(-15.5);
		expect(resolveNumber(NaN, 5)).toBe(5);
		expect(resolveNumber(undefined, 5)).toBe(5);
		expect(resolveNumber(null, 5)).toBe(5);
		expect(resolveNumber("42", 5)).toBe(5);

		// With StateSignal
		const sig = Signal.state(123);
		expect(resolveNumber(sig, 0)).toBe(123);

		// With wrapper object containing .value
		expect(resolveNumber({ value: 99 }, 0)).toBe(99);
		expect(resolveNumber({ value: NaN }, 10)).toBe(10);

		// With object containing .peek()
		expect(resolveNumber({ peek: () => 77 }, 0)).toBe(77);
	});

	it("resolves strings with fallback", () => {
		expect(resolveString("hello", "default")).toBe("hello");
		expect(resolveString("", "default")).toBe("");
		expect(resolveString(undefined, "default")).toBe("default");
		expect(resolveString(null, "default")).toBe("default");
		expect(resolveString(123, "default")).toBe("default");

		// With StateSignal
		const sig = Signal.state("active");
		expect(resolveString(sig, "idle")).toBe("active");

		// With wrapper object
		expect(resolveString({ value: "custom" }, "default")).toBe("custom");
	});

	it("resolves booleans with fallback", () => {
		expect(resolveBoolean(true, false)).toBe(true);
		expect(resolveBoolean(false, true)).toBe(false);
		expect(resolveBoolean(undefined, true)).toBe(true);
		expect(resolveBoolean(null, true)).toBe(true);
		expect(resolveBoolean(1, false)).toBe(false);

		// With StateSignal
		const sig = Signal.state(true);
		expect(resolveBoolean(sig, false)).toBe(true);

		// With wrapper object
		expect(resolveBoolean({ value: false }, true)).toBe(false);
	});

	it("resolves generic params via resolveParam", () => {
		expect(resolveParam(10, 0)).toBe(10);
		expect(resolveParam(Signal.state(20), 0)).toBe(20);
		expect(resolveParam("abc", "xyz")).toBe("abc");
		expect(resolveParam(Signal.state("abc"), "xyz")).toBe("abc");
		expect(resolveParam(false, true)).toBe(false);
		expect(resolveParam(Signal.state(false), true)).toBe(false);
	});
});
