import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Composition, FontManager, Layer } from "./index.js";

describe("FontManager Singleton & Typography Binding", () => {
	beforeEach(() => {
		FontManager.clear();
	});

	it("1. registers a valid TTF font and parses metadata", async () => {
		const font = await FontManager.register("assets/fonts/Inter.ttf");
		expect(font).toBeDefined();
		expect(font.family).toBe("Inter");
		expect(font.format).toBe("truetype");
		expect(font.unitsPerEm).toBe(2048);
		expect(font.filePath).toBeDefined();

		expect(FontManager.has("Inter")).toBe(true);
		expect(FontManager.get("Inter")?.family).toBe("Inter");
	});

	it("2. registers a font with custom family name and options object", async () => {
		const font = await FontManager.register({
			family: "CinzelDisplay",
			source: "assets/fonts/Cinzel.ttf",
			weight: 700,
			style: "normal",
		});

		expect(font.family).toBe("CinzelDisplay");
		expect(font.format).toBe("truetype");
		expect(font.weight).toBe(700);
		expect(FontManager.has("CinzelDisplay")).toBe(true);
	});

	it("3. validates font binary and rejects non-font files", async () => {
		const tmpBadFile = path.resolve(process.cwd(), "scratch_not_a_font.txt");
		await fs.writeFile(
			tmpBadFile,
			"This is not a font binary, just plain text.",
		);

		try {
			await expect(FontManager.register(tmpBadFile)).rejects.toThrow(
				/Invalid font format|too small/i,
			);
		} finally {
			await fs.unlink(tmpBadFile).catch(() => {});
		}
	});

	it("4. rejects non-existent font file paths with a helpful error", async () => {
		await expect(FontManager.register("non_existent_font.ttf")).rejects.toThrow(
			/Font file not found/i,
		);
	});

	it("5. automatically provides registered font paths to Composition specs", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
		await FontManager.register("assets/fonts/SpaceGrotesk.ttf");

		const comp = new Composition({
			width: 640,
			height: 360,
			fps: 30,
		});

		comp.add(Layer.text("Hello World", { fontFamily: "Inter", fontSize: 32 }));
		comp.add(
			Layer.caption("captions.vtt", {
				fontFamily: "SpaceGrotesk",
				fontSize: 24,
			}),
		);

		const spec = comp.toSpec();
		expect(spec.fonts).toBeDefined();
		expect(spec.fonts?.length).toBeGreaterThanOrEqual(2);
		expect(spec.fonts?.some((p) => p.includes("Inter.ttf"))).toBe(true);
		expect(spec.fonts?.some((p) => p.includes("SpaceGrotesk.ttf"))).toBe(true);
	});

	it("6. comp.registerFont delegates directly to FontManager", async () => {
		const comp = new Composition({
			width: 640,
			height: 360,
		});

		await comp.registerFont("MontserratCustom", "assets/fonts/Montserrat.ttf");
		expect(FontManager.has("MontserratCustom")).toBe(true);

		const spec = comp.toSpec();
		expect(spec.fonts?.some((p) => p.includes("Montserrat.ttf"))).toBe(true);
	});

	it("7. Layer.text and Layer.caption automatically use registered font family when omitted", async () => {
		const font = await FontManager.register("assets/fonts/SpaceGrotesk.ttf");

		const textLayer = Layer.text("Auto Font Text");
		const captionLayer = Layer.caption("subtitles.vtt");

		expect(textLayer.fontFamily).toBe(font.family);
		expect(captionLayer.fontFamily).toBe(font.family);
	});
});
