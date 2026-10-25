import fs from "node:fs";
import * as fontkit from "fontkit";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createMockDevice,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { type FontkitFont, SlugGenerator } from "./slug-generator.js";
import { SlugGeometry } from "./slug-geometry.js";
import {
	type SlugCodePoint,
	type SlugFont,
	SlugLoader,
} from "./slug-loader.js";
import { breakLines, placeLine, shapeParagraph } from "./text-shaping.js";

beforeAll(() => {
	ensureDOMGlobals();
	if (typeof globalThis.GPUTextureUsage === "undefined") {
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
			COPY_SRC: 8,
		} as never;
	}
});

/** A font with no shaping source: one 100-unit glyph per listed code point. */
function mockFont(chars: string): SlugFont {
	const codePoints = new Map<number, SlugCodePoint>();
	const add = (codePoint: number, advanceWidth: number) =>
		codePoints.set(codePoint, {
			codePoint,
			width: advanceWidth > 0 ? 80 : 0,
			height: advanceWidth > 0 ? 700 : 0,
			advanceWidth,
			bearingX: 10,
			bearingY: 700,
			bandCount: 1,
			bandDimX: 8,
			bandDimY: 8,
			bandsTexCoordX: 0,
			bandsTexCoordY: 0,
		});
	add(-1, 100);
	for (const ch of chars) add(ch.codePointAt(0) ?? 0, ch === " " ? 50 : 100);
	return {
		codePoints,
		curvesTex: null as never,
		bandsTex: null as never,
		ascender: 800,
		descender: -200,
		lineGap: 0,
		unitsPerEm: 1000,
	};
}

const HEBREW = "אבגדהוזחטיכלמנסעפצקרשת";
const font = mockFont(`${HEBREW}ABCDEFGHIJ0123456789 ()[]!.,-`);
const style = { font, fontSize: 10, letterSpacing: 0 };

/** Visual (left-to-right) text of one laid-out paragraph line. */
function visualText(text: string, direction?: "ltr" | "rtl" | "auto") {
	const p = shapeParagraph([{ text, style }], { direction });
	const line = placeLine(p.clusters, p.baseLevel);
	return {
		text: line.clusters.map((c) => c.cluster.text).join(""),
		baseLevel: p.baseLevel,
		line,
	};
}

describe("bidi ordering", () => {
	it("keeps left-to-right text in logical order", () => {
		const { text, baseLevel } = visualText("AB CD");
		expect(baseLevel).toBe(0);
		expect(text).toBe("AB CD");
	});

	it("reverses a right-to-left paragraph and detects its direction", () => {
		const { text, baseLevel } = visualText("אב גד");
		expect(baseLevel).toBe(1);
		expect(text).toBe("דג בא");
	});

	it("keeps Latin words and numbers left to right inside RTL text", () => {
		// Digits after a Latin word join its left-to-right run (UAX #9 W7).
		expect(visualText("אב CD 2026 גד").text).toBe("דג CD 2026 בא");
		expect(visualText("אב 2026 גד").text).toBe("דג 2026 בא");
	});

	it("honours an explicit base direction", () => {
		// LTR base: the Hebrew word reverses in place, the sentence stays LTR.
		expect(visualText("AB אב CD", "ltr").text).toBe("AB בא CD");
		// RTL base: the Latin run moves to the right-to-left reading position.
		const rtl = visualText("AB CD", "rtl");
		expect(rtl.baseLevel).toBe(1);
		expect(rtl.text).toBe("AB CD");
	});

	it("mirrors brackets in right-to-left runs", () => {
		const p = shapeParagraph([{ text: "(אב)", style }]);
		const line = placeLine(p.clusters, p.baseLevel);
		const glyphCps = line.clusters.map((c) => c.cluster.glyphs[0].cp.codePoint);
		// Displayed as "(בא)": the logical ")" shows as "(" on the left.
		expect(glyphCps[0]).toBe("(".codePointAt(0));
		expect(glyphCps[glyphCps.length - 1]).toBe(")".codePointAt(0));
	});

	it("treats emoji as neutral, not as strong left-to-right text", () => {
		const { text } = visualText("אב 😀 גד");
		expect(text).toBe("דג 😀 בא");
	});
});

describe("RTL line layout", () => {
	it("wraps from the right: the first words stay on the first line", () => {
		const p = shapeParagraph([{ text: "אב גד הו זח", style }]);
		// Each word is 2px wide, each space 0.5px: two words fit in 5px.
		const lines = breakLines(p.clusters, 5);
		expect(
			lines.map((l) =>
				l
					.map((c) => c.text)
					.join("")
					.trim(),
			),
		).toEqual(["אב גד", "הו זח"]);
	});

	it("keeps a paragraph's indent and drops the space a wrap leaves", () => {
		const p = shapeParagraph([{ text: "  ab cd", style }]);
		const lines = breakLines(p.clusters, 3);
		expect(lines.map((l) => l.map((c) => c.text).join(""))).toEqual([
			"  ab ",
			"cd",
		]);
	});

	it("aligns start to the right edge and keeps trailing spaces out of the ink", () => {
		const result = SlugGeometry.layout(
			"אב גד",
			font,
			10,
			0,
			12,
			100,
			"start",
			"char",
		);
		const visible = result.glyphs.filter((g) => !g.isSpace);
		const right = Math.max(...visible.map((g) => g.x + 1));
		expect(right).toBeCloseTo(100, 5);
		expect(result.hasRtl).toBe(true);
	});

	it("numbers characters in reading order", () => {
		const result = SlugGeometry.layout(
			"אבג",
			font,
			10,
			0,
			12,
			100,
			"left",
			"char",
		);
		const byIndex = [...result.glyphs].sort(
			(a, b) => a.charIndex - b.charIndex,
		);
		expect(byIndex.map((g) => g.char).join("")).toBe("אבג");
		// The first character read sits rightmost.
		expect(byIndex[0].x).toBeGreaterThan(byIndex[2].x);
		expect(byIndex.every((g) => g.rtl)).toBe(true);
	});

	it("orders rich-text spans visually and keeps each span's style", () => {
		const result = SlugGeometry.layout(
			"אב גד",
			font,
			10,
			0,
			12,
			100,
			"left",
			"word",
			undefined,
			undefined,
			[{ text: "אב " }, { text: "גד", fill: "#ff0000" }],
		);
		const red = result.glyphs.filter((g) => g.fill === "#ff0000");
		const plain = result.glyphs.filter((g) => !g.fill && !g.isSpace);
		expect(red.map((g) => g.char).join("")).toBe("גד");
		// The second span is read second, so it sits to the left.
		expect(Math.max(...red.map((g) => g.x))).toBeLessThan(
			Math.min(...plain.map((g) => g.x)),
		);
	});

	it("lays out LTR text exactly as before", () => {
		const result = SlugGeometry.layout("AB CD", font, 10, 0, 12, 100, "left");
		expect(result.glyphs.map((g) => g.x)).toEqual([0, 1, 2, 2.5, 3.5]);
		expect(result.wordsCount).toBe(2);
		expect(result.charsCount).toBe(5);
		expect(result.hasRtl).toBeUndefined();
	});
});

describe("Slug binary format", () => {
	it("still reads v1 (SLUGGISH) binaries", () => {
		const glyphRecord = 40;
		const curvesBytes = 4096 * 16;
		const bandsBytes = 4096 * 8;
		const buffer = new ArrayBuffer(
			8 + 2 + glyphRecord + 8 + curvesBytes + 8 + bandsBytes + 16,
		);
		const view = new DataView(buffer);
		let o = 0;
		for (const ch of "SLUGGISH") view.setUint8(o++, ch.charCodeAt(0));
		view.setUint16(o, 1, true);
		o += 2;
		view.setUint32(o, 65, true); // codePoint
		view.setUint32(o + 12, 600, true); // advanceWidth
		o += glyphRecord;
		view.setUint16(o, 4096, true);
		view.setUint16(o + 2, 1, true);
		view.setUint32(o + 4, curvesBytes, true);
		o += 8 + curvesBytes;
		view.setUint16(o, 4096, true);
		view.setUint16(o + 2, 1, true);
		view.setUint32(o + 4, bandsBytes, true);
		o += 8 + bandsBytes;
		view.setInt32(o + 12, 1000, true); // unitsPerEm

		const parsed = SlugLoader.parse(createMockDevice(), buffer);
		expect(parsed.codePoints.get(65)?.advanceWidth).toBe(600);
		expect(parsed.glyphs).toBeUndefined();
		expect(parsed.unitsPerEm).toBe(1000);
	});
});

// ── Real fonts (macOS ships these; elsewhere the tests skip) ─────────────

function loadSystemFont(path: string): FontkitFont | null {
	if (!fs.existsSync(path)) return null;
	const parsed = fontkit.create(fs.readFileSync(path)) as unknown as
		| FontkitFont
		| { fonts: FontkitFont[] };
	return "fonts" in parsed ? parsed.fonts[0] : parsed;
}

const sfArabic = loadSystemFont("/System/Library/Fonts/SFArabic.ttf");

describe.skipIf(!sfArabic)("Arabic shaping (SF Arabic)", () => {
	const source = sfArabic as FontkitFont;

	it("generates the shaped forms on demand and joins letters", () => {
		const slug = new SlugGenerator().generate(null, source);
		const before = slug.glyphs?.size ?? 0;
		const p = shapeParagraph([
			{
				text: "لازم نتعلّم",
				style: { font: slug, fontSize: 90, letterSpacing: 0 },
			},
		]);
		// Arabic was not in the default set: shaping generated its glyphs.
		expect(slug.glyphs?.size ?? 0).toBeGreaterThan(before);
		// Joined forms are not the isolated cmap glyphs.
		const nun = source.glyphForCodePoint?.("ن".codePointAt(0) ?? 0)?.id;
		const nunCluster = p.clusters.find((c) => c.text === "ن");
		expect(nunCluster?.glyphs.some((g) => g.cp.glyphId === nun)).toBe(false);
	});

	it("forms lam-alef and keeps the shadda with its letter", () => {
		const slug = new SlugGenerator().generate(null, source);
		const p = shapeParagraph([
			{
				text: "لازم نتعلّم",
				style: { font: slug, fontSize: 90, letterSpacing: 0 },
			},
		]);
		const texts = p.clusters.map((c) => c.text);
		expect(texts).toContain("لا");
		expect(texts).toContain("لّ");
		const lamShadda = p.clusters.find((c) => c.text === "لّ");
		// Base and mark: two glyphs, the mark raised above the baseline.
		expect(lamShadda?.glyphs.length).toBe(2);
		expect(
			Math.min(...(lamShadda?.glyphs.map((g) => g.dy) ?? [0])),
		).toBeLessThan(0);
	});

	it("re-uploads textures when glyphs are added after the first upload", () => {
		const device = createMockDevice();
		const slug = new SlugGenerator().generate(device, source);
		const firstTex = slug.curvesTex;
		const id = source.glyphForCodePoint?.("ع".codePointAt(0) ?? 0)?.id ?? 0;
		expect(SlugGenerator.ensureGlyphs(slug, [id])).toBe(true);
		expect(slug.curvesTex).not.toBe(firstTex);
		expect(slug.glyphs?.get(id)?.glyphId).toBe(id);
		// Asking again is a no-op.
		expect(SlugGenerator.ensureGlyphs(slug, [id])).toBe(false);
	});

	it("round-trips shaped glyphs through the v2 binary", () => {
		const slug = new SlugGenerator().generate(null, source);
		shapeParagraph([
			{ text: "لا", style: { font: slug, fontSize: 90, letterSpacing: 0 } },
		]);
		const buffer = new SlugGenerator().exportSluggish(slug);
		const parsed = SlugLoader.parse(createMockDevice(), buffer);
		expect(parsed.glyphs?.size).toBe(slug.glyphs?.size);
		for (const [id, cp] of slug.glyphs ?? []) {
			expect(parsed.glyphs?.get(id)?.advanceWidth).toBe(cp.advanceWidth);
		}
	});
});

describe("emoji presentation and font fallback", () => {
	// "✓" and "©" are in this font; "❤" and "★" are not.
	const text = mockFont("ab ✓©");
	const style = { font: text, fontSize: 10, letterSpacing: 0 };
	const shapeOne = (s: string, options = {}) =>
		shapeParagraph([{ text: s, style }], options).clusters;

	it("draws plain symbols from the text font, not as emoji", () => {
		const clusters = shapeOne("a ✓ ©");
		expect(clusters.filter((c) => c.isEmoji)).toEqual([]);
		const check = clusters.find((c) => c.text === "✓");
		expect(check?.glyphs[0]?.cp.codePoint).toBe(0x2713);
	});

	it("keeps default-emoji and VS16 graphemes as emoji", () => {
		const emoji = shapeOne("🚀 ❤️ ✅")
			.filter((c) => c.isEmoji)
			.map((c) => c.text);
		expect(emoji).toEqual(["🚀", "❤️", "✅"]);
	});

	it("falls back to the emoji font for a text-default pictograph the font lacks", () => {
		expect(shapeOne("❤").map((c) => c.isEmoji)).toEqual([true]);
		// With the glyph, a text-default pictograph stays text.
		expect(shapeOne("©").map((c) => c.isEmoji)).toEqual([false]);
	});

	it("takes a missing glyph from the fallback font, in its own style", () => {
		const other = mockFont("★");
		const seen: number[] = [];
		const clusters = shapeOne("a★b", {
			fallback: <T extends typeof style>(s: T, cp: number) => {
				seen.push(cp);
				return { ...s, font: other } as T;
			},
		});
		expect(seen).toEqual([0x2605]);
		expect(clusters.map((c) => [c.text, c.style.font === other])).toEqual([
			["a", false],
			["★", true],
			["b", false],
		]);
		expect(clusters[1]?.glyphs[0]?.cp.codePoint).toBe(0x2605);
	});

	it("lists only graphemes that may draw as emoji for preloading", async () => {
		const { emojiGraphemes } = await import("./text-shaping.js");
		expect(emojiGraphemes("✓ done © ★ ❤ ❤️ 🚀")).toEqual(["©", "❤", "❤️", "🚀"]);
	});
});
