import type { VirtualMediaData } from "@framefields/core";
import { SlugFontCache } from "@framefields/webgpu-renderers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadCompositionFonts } from "./preload-fonts.js";

type Device = Parameters<typeof preloadCompositionFonts>[1];

vi.mock("./utils.js", () => ({ preloadFont: vi.fn(async () => {}) }));

const text = (value: string, fontFamily?: string): VirtualMediaData =>
	({
		operation: { op: "text", text: value, fontFamily, fontSize: 32 },
	}) as unknown as VirtualMediaData;

const tree = (...children: VirtualMediaData[]): VirtualMediaData =>
	({ operation: { op: "compose" }, children }) as unknown as VirtualMediaData;

describe("preloadCompositionFonts", () => {
	afterEach(() => vi.restoreAllMocks());

	it("loads each family and each emoji once", async () => {
		const slug = vi
			.spyOn(SlugFontCache, "preloadSlugFont")
			.mockResolvedValue({} as never);
		vi.spyOn(SlugFontCache, "hasEmojiFont").mockReturnValue(true);
		const emoji = vi
			.spyOn(SlugFontCache, "preloadEmoji")
			.mockResolvedValue({} as never);

		await preloadCompositionFonts(
			tree(text("hi 😀", "Serif"), text("😀 🎉", "Serif"), text("plain")),
			{} as Device,
		);

		expect(slug.mock.calls.map((c) => c[1]).sort()).toEqual(["Inter", "Serif"]);
		expect(emoji.mock.calls.map((c) => c[1]).sort()).toEqual(["🎉", "😀"]);
	});

	it("warns once, and does not fail, when emoji have no font", async () => {
		vi.spyOn(SlugFontCache, "preloadSlugFont").mockResolvedValue({} as never);
		vi.spyOn(SlugFontCache, "hasEmojiFont").mockReturnValue(false);
		vi.spyOn(SlugFontCache, "preloadEmoji").mockRejectedValue(
			new Error("no emoji font"),
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const onError = vi.fn();

		await preloadCompositionFonts(tree(text("😀")), {} as Device, onError);
		await preloadCompositionFonts(tree(text("🎉")), {} as Device, onError);

		const notices = warn.mock.calls.filter((c) =>
			String(c[0]).includes("registerEmojiFont"),
		);
		expect(notices).toHaveLength(1);
		expect(onError).not.toHaveBeenCalled();
	});
});
