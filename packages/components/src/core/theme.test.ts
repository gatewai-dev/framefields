import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color.js";
import { defineTheme, themeFrames, themes } from "./theme.js";

describe("theme", () => {
	it("merges partials over graphite", () => {
		const t = defineTheme({
			color: { accent: "#ff0000" },
			font: { display: "Space Grotesk" },
		});
		expect(t.color.accent).toBe("#ff0000");
		expect(t.color.ink).toBe(themes.graphite.color.ink);
		expect(t.font.display).toBe("Space Grotesk");
		expect(t.font.mono).toBe("JetBrains Mono");
	});

	it("built-in themes pass contrast", () => {
		for (const theme of Object.values(themes)) {
			expect(
				contrastRatio(theme.color.ink, theme.color.surface),
			).toBeGreaterThanOrEqual(4.5);
			expect(() => defineTheme(theme)).not.toThrow();
		}
	});

	it("rejects unreadable ink", () => {
		expect(() =>
			defineTheme({ color: { ink: "#222", surface: "#1a1a1a" } }),
		).toThrow(/contrast/);
		// Non-hex colors can't be checked and are allowed.
		expect(() =>
			defineTheme({ color: { ink: "oklch(0.2 0 0)" } }),
		).not.toThrow();
	});

	it("scales speeds by fps", () => {
		expect(themeFrames(themes.graphite, "base", 30)).toBe(16);
		expect(themeFrames(themes.graphite, "base", 60)).toBe(32);
	});
});
