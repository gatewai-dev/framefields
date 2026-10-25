import { describe, expect, it } from "vitest";
import { emojiPresentation } from "./emoji.js";

describe("emojiPresentation", () => {
	it("keeps plain symbols in the text font", () => {
		for (const g of ["✓", "✗", "★", "☆", "☐", "❯", "➜", "→", "A", "1", "#"])
			expect([g, emojiPresentation(g)]).toEqual([g, "text"]);
	});

	it("draws default-emoji characters and sequences as emoji", () => {
		for (const g of [
			"🚀",
			"✅",
			"⚡",
			"✨",
			"⭐",
			"❌",
			"🇹🇷",
			"👍🏽",
			"☝🏽",
			"1️⃣",
			"👩‍💻",
			"❤️‍🔥",
		])
			expect([g, emojiPresentation(g)]).toEqual([g, "emoji"]);
	});

	it("follows the variation selectors", () => {
		expect(emojiPresentation("❤️")).toBe("emoji"); // VS16
		expect(emojiPresentation("✔️")).toBe("emoji");
		expect(emojiPresentation("❤︎")).toBe("text"); // VS15
		expect(emojiPresentation("🚀︎")).toBe("text");
		// VS16 on a character that isn't a pictograph changes nothing.
		expect(emojiPresentation("✓️")).toBe("text");
	});

	it("leaves text-default pictographs to the font", () => {
		for (const g of ["❤", "✈", "☀", "⚠", "✔", "©", "™", "♥"])
			expect([g, emojiPresentation(g)]).toEqual([g, "either"]);
	});
});
