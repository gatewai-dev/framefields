import { describe, expect, expectTypeOf, it } from "vitest";
import { assertNever } from "./assert.js";

describe("assertNever", () => {
	it("throws at runtime when called with unexpected value", () => {
		expect(() => assertNever("unexpected" as never)).toThrow(
			"Unhandled union variant: unexpected",
		);

		expect(() =>
			assertNever({ op: "Unknown" } as never, "Custom message"),
		).toThrow("Custom message");
	});

	it("typechecks exhaustiveness in a discriminated union", () => {
		type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };

		function area(s: Shape): number {
			switch (s.kind) {
				case "circle":
					return Math.PI * s.r * s.r;
				case "square":
					return s.s * s.s;
				default:
					return assertNever(s);
			}
		}

		expect(area({ kind: "circle", r: 2 })).toBeCloseTo(12.566, 3);
		expect(area({ kind: "square", s: 3 })).toBe(9);
		expectTypeOf(assertNever).toBeFunction();
	});
});
