import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
