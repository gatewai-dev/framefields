import { describe, expect, it } from "vitest";
import { shouldPaintContainerBackground } from "./container-bg.js";

describe("shouldPaintContainerBackground", () => {
	it("paints every container kind when a background is set", () => {
		for (const kind of ["flex", "block", "box"]) {
			expect(shouldPaintContainerBackground(kind, "#3a2f1e")).toBe(true);
		}
	});

	it("never paints when there is no background", () => {
		expect(shouldPaintContainerBackground("flex", undefined)).toBe(false);
		expect(shouldPaintContainerBackground("box", null)).toBe(false);
		expect(shouldPaintContainerBackground("box", "")).toBe(false);
	});

	it("does not paint non-container kinds", () => {
		for (const kind of ["text", "media", undefined]) {
			expect(shouldPaintContainerBackground(kind, "#ffffff")).toBe(false);
		}
	});
});
