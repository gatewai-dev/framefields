import { afterEach, describe, expect, it } from "vitest";
import { SlugFontCache } from "./slug-font-cache.js";

/** An SFNT whose table directory lists `tags` (the tables themselves are empty). */
function sfnt(tags: string[]): Uint8Array {
	const bytes = new Uint8Array(12 + tags.length * 16 + 16);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x00010000);
	view.setUint16(4, tags.length);
	tags.forEach((tag, i) => {
		const rec = 12 + i * 16;
		for (let c = 0; c < 4; c++) view.setUint8(rec + c, tag.charCodeAt(c));
		view.setUint32(rec + 8, 12 + tags.length * 16);
	});
	return bytes;
}

function reset() {
	SlugFontCache.destroy();
	SlugFontCache.emojiFontPath = null;
	SlugFontCache.emojiFontUrl = null;
}

describe("emoji font", () => {
	afterEach(reset);

	it("ships with none", () => {
		reset();
		expect(SlugFontCache.hasEmojiFont()).toBe(false);
	});

	it("takes a color bitmap font and drops emoji drawn before it", () => {
		let destroyed = false;
		SlugFontCache.emojiTextureCache.set("😀-48", {
			destroy: () => {
				destroyed = true;
			},
		} as unknown as GPUTexture);

		SlugFontCache.setEmojiFont(sfnt(["cmap", "CBDT", "CBLC"]), "/x/emoji.ttf");

		expect(SlugFontCache.hasEmojiFont()).toBe(true);
		expect(SlugFontCache.emojiFontPath).toBe("/x/emoji.ttf");
		expect(SlugFontCache.emojiTextureCache.size).toBe(0);
		expect(destroyed).toBe(true);
	});

	it("rejects a font without color bitmaps", () => {
		SlugFontCache.setEmojiFont(sfnt(["cmap", "CBDT", "CBLC"]));
		expect(() => SlugFontCache.setEmojiFont(sfnt(["cmap", "glyf"]))).toThrow(
			/CBDT\/CBLC/,
		);
		expect(SlugFontCache.hasEmojiFont()).toBe(false);
	});

	it("says how to set one when an emoji is drawn without it", async () => {
		await expect(
			SlugFontCache.preloadEmoji({} as GPUDevice, "😀", 48),
		).rejects.toThrow(/registerEmojiFont/);
	});
});
