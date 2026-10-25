/**
 * Without a color emoji font, emoji in text draw nothing. `lint()` says so
 * (naming the layers), and so does rendering: the font preloader warns
 * once, pointing at `framefields fonts add emoji`, with no per-emoji noise.
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Composition, FontManager, Layer } from "./index.js";

beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
});
afterEach(() => vi.restoreAllMocks());

const comp = (text: string) => {
	const c = new Composition({
		width: 200,
		height: 80,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	c.add(
		Layer.text(text, {
			id: "t",
			fontFamily: "Inter",
			fontSize: 20,
			fill: "#fff",
		}),
	);
	return c;
};
const flagged = (c: Composition) =>
	c.lint().some((d) => d.code === "missing_emoji_font");

describe("missing emoji font", () => {
	it("is flagged by lint and warned once on render, until a font is registered", async () => {
		expect(FontManager.hasEmojiFont()).toBe(false);
		expect(flagged(comp("plain"))).toBe(false);
		const c = comp("Ship it 🚀");
		expect(flagged(c)).toBe(true);

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await c.renderFrame({ frame: 0 });
		await c.renderFrame({ frame: 0 });
		const said = warn.mock.calls.map((args) => String(args[0]));
		expect(
			said.filter((m) => m.includes("framefields fonts add emoji")),
		).toHaveLength(1);
		expect(said.filter((m) => m.includes("not preloaded"))).toEqual([]);

		await FontManager.registerEmojiFont(
			fileURLToPath(
				new URL(
					"../../renderer/src/assets/NotoColorEmoji.ttf",
					import.meta.url,
				),
			),
		);
		expect(FontManager.hasEmojiFont()).toBe(true);
		expect(flagged(comp("Ship it 🚀"))).toBe(false);
	});
});
