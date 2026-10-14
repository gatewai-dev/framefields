import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SlugFontCache, SlugGeometry } from "@framefields/webgpu-renderers";
import { Composition, FontManager, Layer } from "./index.js";

// Fonts are kept on disk, not in git (.gitignore: *.ttf). Every test that
// needs a real font uses the repo's Inter and is skipped where it is absent.
const INTER = "assets/fonts/Inter.ttf";
const hasInter = existsSync(
	path.resolve(import.meta.dirname, "../../..", INTER),
);
if (!hasInter) {
	console.warn(
		`[font-manager.test] ${INTER} not found at the repo root; skipping tests that need a font file.`,
	);
}

describe("FontManager Singleton & Typography Binding", () => {
	// A second, distinct font file: a copy of Inter registered under its own family.
	let secondFont = "";

	beforeAll(async () => {
		if (!hasInter) return;
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "font-manager-"));
		secondFont = path.join(dir, "SecondFace.ttf");
		await fs.copyFile(
			path.resolve(import.meta.dirname, "../../..", INTER),
			secondFont,
		);
	});

	afterAll(async () => {
		if (secondFont) {
			await fs.rm(path.dirname(secondFont), { recursive: true, force: true });
		}
	});

	beforeEach(() => {
		FontManager.clear();
	});

	it.skipIf(!hasInter)(
		"1. registers a valid TTF font and parses metadata",
		async () => {
			const font = await FontManager.register(INTER);
			expect(font).toBeDefined();
			expect(font.family).toBe("Inter");
			expect(font.format).toBe("truetype");
			expect(font.unitsPerEm).toBe(2048);
			expect(font.filePath).toBeDefined();

			expect(FontManager.has("Inter")).toBe(true);
			expect(FontManager.get("Inter")?.family).toBe("Inter");
		},
	);

	it.skipIf(!hasInter)(
		"2. registers a font with custom family name and options object",
		async () => {
			const font = await FontManager.register({
				family: "InterDisplay",
				source: INTER,
				weight: 700,
				style: "normal",
			});

			expect(font.family).toBe("InterDisplay");
			expect(font.format).toBe("truetype");
			expect(font.weight).toBe(700);
			expect(FontManager.has("InterDisplay")).toBe(true);
		},
	);

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

	it.skipIf(!hasInter)(
		"5. automatically provides registered font paths to Composition specs",
		async () => {
			await FontManager.register(INTER);
			await FontManager.register({ family: "SecondFace", source: secondFont });

			const comp = new Composition({
				width: 640,
				height: 360,
				fps: 30,
			});

			comp.add(
				Layer.text("Hello World", { fontFamily: "Inter", fontSize: 32 }),
			);
			comp.add(
				Layer.caption("captions.vtt", {
					fontFamily: "SecondFace",
					fontSize: 24,
				}),
			);

			const spec = comp.toSpec();
			expect(spec.fonts).toBeDefined();
			expect(spec.fonts?.length).toBeGreaterThanOrEqual(2);
			expect(spec.fonts?.some((p) => p.includes("Inter.ttf"))).toBe(true);
			expect(spec.fonts?.some((p) => p.includes("SecondFace.ttf"))).toBe(true);
		},
	);

	it.skipIf(!hasInter)(
		"6. comp.registerFont delegates directly to FontManager",
		async () => {
			const comp = new Composition({
				width: 640,
				height: 360,
			});

			await comp.registerFont("InterCustom", INTER);
			expect(FontManager.has("InterCustom")).toBe(true);

			const spec = comp.toSpec();
			expect(spec.fonts?.some((p) => p.includes("Inter.ttf"))).toBe(true);
		},
	);

	it.skipIf(!hasInter)(
		"7. Layer.text and Layer.caption automatically use registered font family when omitted",
		async () => {
			const font = await FontManager.register({
				family: "SecondFace",
				source: secondFont,
			});

			const textLayer = Layer.text("Auto Font Text");
			const captionLayer = Layer.caption("subtitles.vtt");

			expect(textLayer.fontFamily).toBe(font.family);
			expect(captionLayer.fontFamily).toBe(font.family);
		},
	);
});

describe.skipIf(!hasInter)("FontManager.measure", () => {
	beforeAll(async () => {
		await FontManager.register({
			family: "Inter",
			source: path.resolve(import.meta.dirname, "../../..", INTER),
		});
	});

	it("measures width, lines and per-glyph carets with the real font", () => {
		const m = FontManager.measure("Hello", {
			fontFamily: "Inter",
			fontSize: 100,
		});
		expect(m.lines).toBe(1);
		expect(m.width).toBeGreaterThan(150);
		expect(m.width).toBeLessThan(350);
		expect(m.glyphs.map((g) => g.char).join("")).toBe("Hello");
		expect(m.caretX(0)).toBe(m.glyphs[0].x);
		// Carets advance monotonically and the last one sits at the ink edge.
		for (let i = 1; i <= 5; i++) {
			expect(m.caretX(i)).toBeGreaterThan(m.caretX(i - 1));
		}
		expect(Math.abs(m.caretX(5) - m.width)).toBeLessThan(2);
		// "l" is narrower than "H" in Inter.
		expect(m.glyphs[2].width).toBeLessThan(m.glyphs[0].width);
	});

	it("wraps to the given width and scales with font size", () => {
		const small = FontManager.measure("Hello world", {
			fontFamily: "Inter",
			fontSize: 50,
		});
		const big = FontManager.measure("Hello world", {
			fontFamily: "Inter",
			fontSize: 100,
		});
		expect(big.width / small.width).toBeCloseTo(2, 1);
		const wrapped = FontManager.measure("Hello world", {
			fontFamily: "Inter",
			fontSize: 100,
			width: big.width * 0.6,
		});
		expect(wrapped.lines).toBe(2);
		expect(wrapped.glyphs.find((g) => g.char === "w")?.line).toBe(1);
	});

	it("measures with the opsz instance text layers render at that size", () => {
		const text = "¿Por qué la inteligencia";
		const fontSize = 90;
		const m = FontManager.measure(text, { fontFamily: "Inter", fontSize });
		// The font Layer.text draws with: opsz follows the font size.
		const font = SlugFontCache.getFont(
			"Inter",
			undefined,
			null,
			undefined,
			fontSize,
		);
		if (!font) throw new Error("Inter not registered");
		const rendered = SlugGeometry.measure(text, font, fontSize, 0, 108);
		expect(m.width).toBeCloseTo(rendered.width, 3);
	});

	it("throws a clear error for unregistered fonts", () => {
		expect(() => FontManager.measure("x", { fontFamily: "Nope" })).toThrow(
			/not registered/,
		);
	});
});
