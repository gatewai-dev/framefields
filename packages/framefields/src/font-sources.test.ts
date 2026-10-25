import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { VirtualMediaData } from "@framefields/core";
import {
	measureTextAsync,
	preloadCompositionFonts,
} from "@framefields/renderers";
import { SlugFontCache } from "@framefields/webgpu-renderers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FontManager } from "./index.js";

// Fonts are kept on disk, not in git (see font-manager.test.ts).
const INTER = path.resolve(
	import.meta.dirname,
	"../../..",
	"assets/fonts/Inter.ttf",
);
const hasInter = existsSync(INTER);

/**
 * A page as the browser preview runs: fonts are fetched, and every fetch
 * 404s, as `assets/fonts/<Family>.ttf` does for a font registered from
 * bytes or from a file named otherwise.
 */
function asBrowserPage() {
	const fetched: string[] = [];
	const faces: Array<{ family: string; source: unknown }> = [];
	vi.stubGlobal("window", globalThis);
	vi.stubGlobal("__IS_HEADLESS_RENDERER__", false);
	vi.stubGlobal("document", { fonts: { add() {}, ready: Promise.resolve() } });
	vi.stubGlobal(
		"FontFace",
		class {
			constructor(family: string, source: unknown) {
				faces.push({ family, source });
			}
			load() {
				return Promise.resolve(this);
			}
		},
	);
	vi.stubGlobal("fetch", async (url: string) => {
		fetched.push(String(url));
		return new Response("missing", { status: 404, statusText: "Not Found" });
	});
	return { fetched, faces };
}

const textIn = (fontFamily: string) =>
	({
		operation: { op: "text", text: "Hello", fontFamily, fontSize: 40 },
	}) as unknown as VirtualMediaData;

describe.skipIf(!hasInter)(
	"fonts registered without a conventional path",
	() => {
		let bytes: Uint8Array;
		beforeAll(async () => {
			bytes = new Uint8Array(await fs.readFile(INTER));
		});
		afterEach(() => {
			vi.unstubAllGlobals();
			SlugFontCache.clearFailed();
		});

		it("loads a family registered from bytes without looking it up by name", async () => {
			await FontManager.register({ family: "BytesOnly", source: bytes });
			const page = asBrowserPage();

			await preloadCompositionFonts(textIn("BytesOnly"), null);
			const slug = await SlugFontCache.preloadSlugFont(
				null,
				"BytesOnly",
				"assets/fonts/BytesOnly.ttf",
			);
			const measured = await measureTextAsync("Hello", {
				fontFamily: "BytesOnly",
				fontSize: 40,
			});

			expect(slug.unitsPerEm).toBe(2048);
			expect(page.fetched).toEqual([]);
			expect(SlugFontCache.isFailed("BytesOnly")).toBe(false);
			// The page's FontFace gets the bytes, not a guessed URL.
			expect(page.faces).toEqual([{ family: "BytesOnly", source: bytes }]);
			expect(measured.width).toBe(
				Math.ceil(
					FontManager.measure("Hello", {
						fontFamily: "BytesOnly",
						fontSize: 40,
					}).width,
				),
			);
		});

		it("loads a family registered from a URL from that URL", async () => {
			const url = "https://fonts.example/Inter-Variable.ttf";
			vi.stubGlobal("fetch", async () => new Response(bytes));
			await FontManager.register({ family: "FromUrl", source: url });
			const page = asBrowserPage();

			await preloadCompositionFonts(textIn("FromUrl"), null);

			expect(page.fetched).toEqual([]);
			expect(page.faces).toEqual([
				{ family: "FromUrl", source: `url(${url})` },
			]);
		});

		it("forgets a lookup that missed before the family was registered", async () => {
			const page = asBrowserPage();
			await expect(
				SlugFontCache.preloadSlugFont(null, "Late", "assets/fonts/Late.ttf"),
			).rejects.toThrow(/Failed to fetch/);
			expect(page.fetched).toEqual(["assets/fonts/Late.ttf"]);
			expect(SlugFontCache.isFailed("Late")).toBe(true);

			await FontManager.register({ family: "Late", source: bytes });

			expect(SlugFontCache.isFailed("Late")).toBe(false);
			await expect(
				SlugFontCache.preloadSlugFont(null, "Late", "assets/fonts/Late.ttf"),
			).resolves.toBeDefined();
			expect(page.fetched).toHaveLength(1);
		});
	},
);

describe.skipIf(!hasInter)("file URLs", () => {
	it("registers a font from a file:// URL whose path has spaces", async () => {
		const { mkdtempSync, cpSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { pathToFileURL } = await import("node:url");
		const dir = path.join(mkdtempSync(path.join(tmpdir(), "ff-")), "My Film");
		const file = path.join(dir, "Spaced Name.ttf");
		cpSync(INTER, file, { recursive: true });
		const url = pathToFileURL(file).href;
		expect(url).toContain("My%20Film");
		// Run from elsewhere so no cwd fallback can find it by name.
		const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpdir());
		await FontManager.register({ family: "Spaced", source: url });
		cwd.mockRestore();
		expect(FontManager.has("Spaced")).toBe(true);
	});
});
