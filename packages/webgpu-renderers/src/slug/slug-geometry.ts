import type { TextSpan, TextSpanMark } from "@framefields/core";
import {
	buildPathLUT,
	generatePathSegments,
	samplePathChainGeometry,
} from "../text-animations/path.js";
import type { TextPathOptions } from "../text-animations/types.js";
import { SlugFontCache } from "./slug-font-cache.js";
import type { FontkitFont } from "./slug-generator.js";
import type { SlugCodePoint, SlugFont } from "./slug-loader.js";

export interface SlugGlyphLayout {
	char: string;
	cp: SlugCodePoint;
	x: number;
	y: number;
	lineIndex: number;
	wordIndex: number;
	charIndex: number;
	unitIndex: number; // Index of the animation unit this glyph belongs to
	isSpace: boolean;
	pathTangentAngleRad?: number;
	perpendicularToPath?: boolean;
	pathNormalX?: number;
	pathNormalY?: number;
	spanIndex?: number;
	fill?: string;
	fontSize?: number;
	fontScale?: number;
	baselineShift?: number;
	opacity?: number;
	fontFamily?: string;
	font?: SlugFont;
	mark?: TextSpanMark;
}

export interface SlugEmojiLayout {
	char: string;
	x: number;
	y: number;
	size: number;
	lineIndex: number;
}

export interface SlugMarkLayout {
	x: number;
	y: number;
	width: number;
	height: number;
	background: string;
	borderRadius?: number;
	lineIndex: number;
}

export interface SlugLayoutResult {
	glyphs: SlugGlyphLayout[];
	emojis: SlugEmojiLayout[];
	marks?: SlugMarkLayout[];
	totalHeight: number;
	linesCount: number;
	wordsCount: number;
	charsCount: number;
}

const EMOJI_REGEX =
	/(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])/u;

const graphemeSegmenter =
	typeof Intl !== "undefined" &&
	(
		Intl as unknown as {
			Segmenter?: new (
				locale: string,
				opts: { granularity: string },
			) => { segment: (text: string) => Iterable<{ segment: string }> };
		}
	).Segmenter
		? new (
				Intl as unknown as {
					Segmenter: new (
						locale: string,
						opts: { granularity: string },
					) => { segment: (text: string) => Iterable<{ segment: string }> };
				}
			).Segmenter("en", { granularity: "grapheme" })
		: null;

function segmentGraphemes(text: string): string[] {
	if (graphemeSegmenter) {
		return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
	}
	return Array.from(text);
}

const kernCache = new Map<string, number>();

function resolveParsedFont(font: SlugFont): FontkitFont | null {
	if (font.fontFamily) {
		const parsed = SlugFontCache.getParsed(font.fontFamily);
		if (parsed) return parsed;
	}
	const globalParsed = (globalThis as Record<symbol, unknown>)[
		Symbol.for("gatewai.slugFontCache.parsed")
	] as Map<string, FontkitFont> | undefined;
	if (globalParsed) {
		if (font.fontFamily && globalParsed.has(font.fontFamily)) {
			return globalParsed.get(font.fontFamily) ?? null;
		}
		if (globalParsed.size === 1) {
			return globalParsed.values().next().value ?? null;
		}
	}
	return null;
}

export function getKernOffset(font: SlugFont, a: number, b: number): number {
	const family = font.fontFamily ?? "default";
	const key = `${family}:${a}:${b}`;
	const hit = kernCache.get(key);
	if (hit !== undefined) return hit;

	const src = resolveParsedFont(font);
	let v = 0;
	if (src) {
		try {
			const s = String.fromCodePoint(a) + String.fromCodePoint(b);
			const laid = src.layout?.(s);
			if (!laid) throw new Error("font cannot shape text");
			const total = laid.positions.reduce(
				(acc: number, p: { xAdvance: number }) => acc + p.xAdvance,
				0,
			);
			const advA = src.glyphForCodePoint?.(a)?.advanceWidth ?? 0;
			const advB = src.glyphForCodePoint?.(b)?.advanceWidth ?? 0;
			v = laid.glyphs.length === 2 ? total - (advA + advB) : 0;
		} catch {
			v = 0;
		}
	}
	kernCache.set(key, v);
	return v;
}

const layoutCache = new Map<string, SlugLayoutResult>();
const MAX_LAYOUT_CACHE = 256;

export class SlugGeometry {
	static layout(
		text: string,
		font: SlugFont,
		fontSize: number,
		letterSpacing: number,
		lineHeight: number,
		maxWidth: number,
		align: "left" | "center" | "right" | "start" | "end" = "left",
		applyBy: "line" | "word" | "char" = "word",
		alignWidth?: number,
		pathOptions?: TextPathOptions,
		spans?: TextSpan[],
	): SlugLayoutResult {
		if (spans && spans.length > 0) {
			const spansKey = spans
				.map(
					(s) =>
						`${typeof s.text === "string" ? s.text : ""}:${s.fontFamily ?? ""}:${s.fontWeight ?? ""}:${s.fontSize ?? ""}:${s.fill ?? ""}:${s.baselineShift ?? ""}`,
				)
				.join(";");
			const cacheKey = `${text}|${font.fontFamily ?? ""}|${font.unitsPerEm}|${fontSize}|${letterSpacing}|${lineHeight}|${maxWidth}|${align}|${applyBy}|${alignWidth ?? ""}|${spansKey}`;
			const cached = layoutCache.get(cacheKey);
			if (cached) return cached;

			const result = SlugGeometry.layoutSpans(
				spans,
				font,
				fontSize,
				letterSpacing,
				lineHeight,
				maxWidth,
				align,
				applyBy,
				alignWidth,
			);
			if (layoutCache.size >= MAX_LAYOUT_CACHE) {
				const firstKey = layoutCache.keys().next().value;
				if (firstKey) layoutCache.delete(firstKey);
			}
			layoutCache.set(cacheKey, result);
			return result;
		}

		if (pathOptions) {
			return SlugGeometry.layoutOnPath(
				text,
				font,
				fontSize,
				letterSpacing,
				pathOptions,
				applyBy,
			);
		}

		const cacheKey = `${text}|${font.fontFamily ?? ""}|${font.unitsPerEm}|${fontSize}|${letterSpacing}|${lineHeight}|${maxWidth}|${align}|${applyBy}|${alignWidth ?? ""}`;
		const cached = layoutCache.get(cacheKey);
		if (cached) return cached;

		const fontScale = fontSize / font.unitsPerEm;

		// 1. Tokenize text into paragraph lines, words, and spaces
		const rawLines = text.split("\n");

		interface RawGlyph {
			char: string;
			cp: SlugCodePoint | null;
			isEmoji: boolean;
			isSpace: boolean;
			x: number; // local X offset in the token
		}

		interface RawLine {
			glyphs: RawGlyph[];
			width: number;
		}

		const lines: RawLine[] = [];

		for (const rawLine of rawLines) {
			const tokens = rawLine.split(/(\s+)/);
			let currentLineGlyphs: RawGlyph[] = [];
			let currentLineWidth = 0;

			for (const token of tokens) {
				if (!token) continue;

				const isSpace = /^\s+$/.test(token);
				let tokenWidth = 0;
				const tokenGlyphs: RawGlyph[] = [];

				const graphemes = segmentGraphemes(token);

				for (const char of graphemes) {
					// Ignore invisible standalone variation selectors or zero-width joiners if any
					if (char === "\uFE0F" || char === "\uFE0E" || char === "\u200D") {
						continue;
					}

					const codePoint = char.codePointAt(0) || 0;
					const isEmoji = EMOJI_REGEX.test(char);

					let cp: SlugCodePoint | null = null;
					let adv = 0;

					if (isEmoji) {
						adv = fontSize;
					} else {
						cp =
							font.codePoints.get(codePoint) || font.codePoints.get(-1) || null;
						adv = (cp?.advanceWidth || 0) * fontScale;
					}

					tokenGlyphs.push({
						char,
						cp,
						isEmoji,
						isSpace,
						x: tokenWidth,
					});

					tokenWidth += adv + letterSpacing;
				}

				if (isSpace) {
					// Skip leading spaces on a new line (after a word-wrap reset)
					if (currentLineGlyphs.length === 0) continue;
					for (const tg of tokenGlyphs) {
						tg.x += currentLineWidth;
						currentLineGlyphs.push(tg);
					}
					currentLineWidth += tokenWidth;
				} else {
					if (
						currentLineWidth > 0 &&
						currentLineWidth + tokenWidth > maxWidth
					) {
						lines.push({
							glyphs: currentLineGlyphs,
							width: currentLineWidth,
						});
						currentLineGlyphs = [];
						currentLineWidth = 0;
					}

					for (const tg of tokenGlyphs) {
						tg.x += currentLineWidth;
						currentLineGlyphs.push(tg);
					}
					currentLineWidth += tokenWidth;
				}
			}

			lines.push({
				glyphs: currentLineGlyphs,
				width: currentLineWidth,
			});
		}

		// Apply kerning across consecutive non-space glyphs on each line
		for (const line of lines) {
			let shift = 0;
			for (let i = 1; i < line.glyphs.length; i++) {
				const prev = line.glyphs[i - 1];
				const cur = line.glyphs[i];
				if (!prev.isSpace && !cur.isSpace && prev.cp && cur.cp) {
					shift +=
						getKernOffset(font, prev.cp.codePoint, cur.cp.codePoint) *
						fontScale;
				}
				cur.x += shift;
			}
			line.width += shift;
		}

		// 2. Position lines and build detailed glyph descriptions
		const glyphs: SlugGlyphLayout[] = [];
		const emojis: SlugEmojiLayout[] = [];

		let currentY = font.ascender * fontScale; // Baseline of first line
		let wordIndex = 0;
		let charIndex = 0;

		const isCenter = align === "center";
		const isRight = align === "right" || align === "end";

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];
			let visibleLineWidth = line.width;
			for (let i = line.glyphs.length - 1; i >= 0; i--) {
				const g = line.glyphs[i];
				if (!g.isSpace) {
					const adv = g.isEmoji
						? fontSize
						: (g.cp?.advanceWidth || 0) * fontScale;
					visibleLineWidth = g.x + adv;
					break;
				}
			}

			const targetAlignWidth = alignWidth ?? maxWidth;
			let alignOffset = 0;
			if (isCenter) {
				alignOffset = (targetAlignWidth - visibleLineWidth) / 2;
			} else if (isRight) {
				alignOffset = targetAlignWidth - visibleLineWidth;
			}

			let inWord = false;

			for (let gIdx = 0; gIdx < line.glyphs.length; gIdx++) {
				const g = line.glyphs[gIdx];
				const charX = g.x + alignOffset;

				if (g.isEmoji) {
					emojis.push({
						char: g.char,
						x: charX,
						y: currentY - fontSize,
						size: fontSize,
						lineIndex,
					});
					charIndex++;
				} else if (g.cp) {
					if (g.isSpace) {
						if (inWord) {
							wordIndex++;
							inWord = false;
						}
					} else {
						if (!inWord) {
							inWord = true;
						}
					}

					let mappedUnitIndex = 0;
					if (applyBy === "line") {
						mappedUnitIndex = lineIndex;
					} else if (applyBy === "word") {
						mappedUnitIndex = wordIndex;
					} else {
						mappedUnitIndex = charIndex;
					}

					glyphs.push({
						char: g.char,
						cp: g.cp,
						x: charX,
						y: currentY,
						lineIndex,
						wordIndex,
						charIndex,
						unitIndex: mappedUnitIndex,
						isSpace: g.isSpace,
					});

					charIndex++;
				}
			}

			if (inWord) {
				wordIndex++;
			}
			currentY += lineHeight;
		}

		const totalHeight = currentY - lineHeight + -font.descender * fontScale;

		// Calculate total distinct unit counts
		let maxUnitIndex = 0;
		for (const g of glyphs) {
			if (!g.isSpace && g.unitIndex > maxUnitIndex) {
				maxUnitIndex = g.unitIndex;
			}
		}

		const result: SlugLayoutResult = {
			glyphs,
			emojis,
			totalHeight,
			linesCount: lines.length,
			wordsCount: wordIndex,
			charsCount: charIndex,
		};

		if (layoutCache.size >= MAX_LAYOUT_CACHE) {
			const firstKey = layoutCache.keys().next().value;
			if (firstKey) layoutCache.delete(firstKey);
		}
		layoutCache.set(cacheKey, result);

		return result;
	}

	static measure(
		text: string,
		font: SlugFont,
		fontSize: number,
		letterSpacing: number,
		lineHeight: number,
		maxWidth?: number,
		spans?: TextSpan[],
	): { width: number; height: number; layout: SlugLayoutResult } {
		const effectiveMaxWidth = maxWidth ?? Number.MAX_SAFE_INTEGER;
		const layout = SlugGeometry.layout(
			text,
			font,
			fontSize,
			letterSpacing,
			lineHeight,
			effectiveMaxWidth,
			"left",
			"word",
			undefined,
			undefined,
			spans,
		);

		// Compute the actual content width from the lines
		const fontScale = fontSize / font.unitsPerEm;
		let contentWidth = 0;

		// Walk all non-space glyphs to find the rightmost edge per line
		const lineWidths = new Map<number, number>();
		for (const g of layout.glyphs) {
			if (g.isSpace) continue;
			const glyphFontScale = g.fontScale ?? fontScale;
			const glyphRight = g.x + g.cp.advanceWidth * glyphFontScale;
			const cur = lineWidths.get(g.lineIndex) ?? 0;
			if (glyphRight > cur) {
				lineWidths.set(g.lineIndex, glyphRight);
			}
		}
		// Also walk all emojis to find the rightmost edge per line
		for (const emoji of layout.emojis) {
			const emojiRight = emoji.x + emoji.size;
			const cur = lineWidths.get(emoji.lineIndex) ?? 0;
			if (emojiRight > cur) {
				lineWidths.set(emoji.lineIndex, emojiRight);
			}
		}
		for (const w of lineWidths.values()) {
			if (w > contentWidth) contentWidth = w;
		}

		// Add trailing letterSpacing like the text-measurer does
		if (letterSpacing > 0) {
			contentWidth += letterSpacing;
		}

		return {
			width: Math.ceil(contentWidth) + 2,
			height: Math.ceil(layout.totalHeight) + 2,
			layout,
		};
	}

	private static layoutSpans(
		spans: TextSpan[],
		defaultFont: SlugFont,
		defaultFontSize: number,
		defaultLetterSpacing: number,
		defaultLineHeight: number,
		maxWidth: number,
		align: "left" | "center" | "right" | "start" | "end" = "left",
		applyBy: "line" | "word" | "char" = "word",
		alignWidth?: number,
	): SlugLayoutResult {
		interface StreamGrapheme {
			isNewline: boolean;
			char: string;
			cp: SlugCodePoint | null;
			isEmoji: boolean;
			isSpace: boolean;
			advance: number;
			spanIndex: number;
			font: SlugFont;
			fontSize: number;
			fontScale: number;
			letterSpacing: number;
			baselineShift: number;
			fill?: string;
			opacity?: number;
			mark?: TextSpanMark;
		}

		const stream: StreamGrapheme[] = [];

		for (let sIdx = 0; sIdx < spans.length; sIdx++) {
			const s = spans[sIdx];
			const rawText =
				typeof s.text === "string"
					? s.text
					: s.text &&
							typeof s.text === "object" &&
							"get" in s.text &&
							typeof (s.text as { get: () => unknown }).get === "function"
						? String((s.text as { get: () => unknown }).get())
						: String(s.text ?? "");

			let spanFont = defaultFont;
			if (s.fontFamily || s.fontWeight !== undefined) {
				const family = s.fontFamily ?? defaultFont.fontFamily ?? "Inter";
				const resolved = SlugFontCache.getFont(family, s.fontWeight, null);
				if (resolved) spanFont = resolved;
			}

			const spanFontSize =
				typeof s.fontSize === "number"
					? s.fontSize
					: s.fontSize &&
							typeof s.fontSize === "object" &&
							"get" in s.fontSize &&
							typeof (s.fontSize as { get: () => unknown }).get === "function"
						? Number((s.fontSize as { get: () => unknown }).get())
						: defaultFontSize;

			const spanFontScale = spanFontSize / spanFont.unitsPerEm;
			const spanLetterSpacing = s.letterSpacing ?? defaultLetterSpacing;
			const spanBaselineShift = s.baselineShift ?? 0;
			const spanFill =
				typeof s.fill === "string"
					? s.fill
					: s.fill &&
							typeof s.fill === "object" &&
							"get" in s.fill &&
							typeof (s.fill as { get: () => unknown }).get === "function"
						? String((s.fill as { get: () => unknown }).get())
						: undefined;
			const spanOpacity =
				typeof s.opacity === "number"
					? s.opacity
					: s.opacity &&
							typeof s.opacity === "object" &&
							"get" in s.opacity &&
							typeof (s.opacity as { get: () => unknown }).get === "function"
						? Number((s.opacity as { get: () => unknown }).get())
						: undefined;

			const graphemes = segmentGraphemes(rawText);
			for (const char of graphemes) {
				if (char === "\uFE0F" || char === "\uFE0E" || char === "\u200D") {
					continue;
				}
				if (char === "\n") {
					stream.push({
						isNewline: true,
						char: "\n",
						cp: null,
						isEmoji: false,
						isSpace: true,
						advance: 0,
						spanIndex: sIdx,
						font: spanFont,
						fontSize: spanFontSize,
						fontScale: spanFontScale,
						letterSpacing: spanLetterSpacing,
						baselineShift: spanBaselineShift,
						fill: spanFill,
						opacity: spanOpacity,
						mark: s.mark,
					});
					continue;
				}

				const codePoint = char.codePointAt(0) || 0;
				const isEmoji = EMOJI_REGEX.test(char);
				let cp: SlugCodePoint | null = null;
				let adv = 0;

				if (isEmoji) {
					adv = spanFontSize;
				} else {
					cp =
						spanFont.codePoints.get(codePoint) ||
						spanFont.codePoints.get(-1) ||
						null;
					adv = (cp?.advanceWidth || 0) * spanFontScale;
				}

				stream.push({
					isNewline: false,
					char,
					cp,
					isEmoji,
					isSpace: /^\s+$/.test(char),
					advance: adv,
					spanIndex: sIdx,
					font: spanFont,
					fontSize: spanFontSize,
					fontScale: spanFontScale,
					letterSpacing: spanLetterSpacing,
					baselineShift: spanBaselineShift,
					fill: spanFill,
					opacity: spanOpacity,
					mark: s.mark,
				});
			}
		}

		// Tokenize stream into words, spaces, and newlines
		interface Token {
			isNewline: boolean;
			isSpace: boolean;
			glyphs: StreamGrapheme[];
			width: number;
		}

		const tokens: Token[] = [];
		let currentTokenGlyphs: StreamGrapheme[] = [];
		let currentTokenIsSpace = false;
		let currentTokenWidth = 0;

		const flushToken = () => {
			if (currentTokenGlyphs.length > 0) {
				tokens.push({
					isNewline: false,
					isSpace: currentTokenIsSpace,
					glyphs: currentTokenGlyphs,
					width: currentTokenWidth,
				});
				currentTokenGlyphs = [];
				currentTokenWidth = 0;
			}
		};

		for (const g of stream) {
			if (g.isNewline) {
				flushToken();
				tokens.push({
					isNewline: true,
					isSpace: true,
					glyphs: [],
					width: 0,
				});
				continue;
			}

			if (currentTokenGlyphs.length === 0) {
				currentTokenIsSpace = g.isSpace;
				currentTokenGlyphs.push(g);
				currentTokenWidth = g.advance + g.letterSpacing;
			} else if (g.isSpace === currentTokenIsSpace) {
				currentTokenGlyphs.push(g);
				currentTokenWidth += g.advance + g.letterSpacing;
			} else {
				flushToken();
				currentTokenIsSpace = g.isSpace;
				currentTokenGlyphs.push(g);
				currentTokenWidth = g.advance + g.letterSpacing;
			}
		}
		flushToken();

		// Word wrapping into lines
		interface RawSpanGlyph extends StreamGrapheme {
			x: number;
		}
		interface RawSpanLine {
			glyphs: RawSpanGlyph[];
			width: number;
		}

		const lines: RawSpanLine[] = [];
		let currentLineGlyphs: RawSpanGlyph[] = [];
		let currentLineWidth = 0;

		for (const token of tokens) {
			if (token.isNewline) {
				lines.push({
					glyphs: currentLineGlyphs,
					width: currentLineWidth,
				});
				currentLineGlyphs = [];
				currentLineWidth = 0;
				continue;
			}

			if (token.isSpace) {
				// Drop leading space at start of line
				if (currentLineGlyphs.length === 0) continue;
				for (const g of token.glyphs) {
					currentLineGlyphs.push({
						...g,
						x: currentLineWidth,
					});
					currentLineWidth += g.advance + g.letterSpacing;
				}
			} else {
				// Word token: wrap if exceeding maxWidth
				if (currentLineWidth > 0 && currentLineWidth + token.width > maxWidth) {
					lines.push({
						glyphs: currentLineGlyphs,
						width: currentLineWidth,
					});
					currentLineGlyphs = [];
					currentLineWidth = 0;
				}

				for (const g of token.glyphs) {
					currentLineGlyphs.push({
						...g,
						x: currentLineWidth,
					});
					currentLineWidth += g.advance + g.letterSpacing;
				}
			}
		}
		lines.push({
			glyphs: currentLineGlyphs,
			width: currentLineWidth,
		});

		// Kerning per line
		for (const line of lines) {
			let shift = 0;
			for (let i = 1; i < line.glyphs.length; i++) {
				const prev = line.glyphs[i - 1];
				const cur = line.glyphs[i];
				if (
					!prev.isSpace &&
					!cur.isSpace &&
					prev.cp &&
					cur.cp &&
					prev.font === cur.font
				) {
					shift +=
						getKernOffset(cur.font, prev.cp.codePoint, cur.cp.codePoint) *
						cur.fontScale;
				}
				cur.x += shift;
			}
			line.width += shift;
		}

		// Baseline alignment & output glyph assembly
		const glyphs: SlugGlyphLayout[] = [];
		const emojis: SlugEmojiLayout[] = [];
		const marks: SlugMarkLayout[] = [];

		let currentBaselineY = 0;
		let wordIndex = 0;
		let charIndex = 0;

		const isCenter = align === "center";
		const isRight = align === "right" || align === "end";

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];

			let maxAscenderPx =
				(defaultFont.ascender ?? 800) *
				(defaultFontSize / defaultFont.unitsPerEm);
			let maxDescenderPx =
				-(defaultFont.descender ?? -200) *
				(defaultFontSize / defaultFont.unitsPerEm);
			let maxLineHeightPx = defaultLineHeight;

			for (const g of line.glyphs) {
				const asc = (g.font.ascender ?? 800) * g.fontScale;
				const desc = -(g.font.descender ?? -200) * g.fontScale;
				const lh = defaultLineHeight * (g.fontSize / defaultFontSize);
				if (asc > maxAscenderPx) maxAscenderPx = asc;
				if (desc > maxDescenderPx) maxDescenderPx = desc;
				if (lh > maxLineHeightPx) maxLineHeightPx = lh;
			}

			if (lineIndex === 0) {
				currentBaselineY = maxAscenderPx;
			}

			let visibleLineWidth = line.width;
			for (let i = line.glyphs.length - 1; i >= 0; i--) {
				const g = line.glyphs[i];
				if (!g.isSpace) {
					visibleLineWidth = g.x + g.advance;
					break;
				}
			}

			const targetAlignWidth = alignWidth ?? maxWidth;
			let alignOffset = 0;
			if (isCenter) {
				alignOffset = (targetAlignWidth - visibleLineWidth) / 2;
			} else if (isRight) {
				alignOffset = targetAlignWidth - visibleLineWidth;
			}

			let inWord = false;

			// Mark tracking
			let activeMark: TextSpanMark | undefined;
			let markStartX = 0;
			let markEndX = 0;
			let markAsc = maxAscenderPx;
			let markDesc = maxDescenderPx;

			const flushMark = () => {
				if (activeMark && markEndX > markStartX) {
					const padX = activeMark.paddingX ?? 4;
					const padY = activeMark.paddingY ?? 2;
					const bg =
						typeof activeMark.background === "string"
							? activeMark.background
							: activeMark.background &&
									typeof activeMark.background === "object" &&
									"get" in activeMark.background &&
									typeof (activeMark.background as { get: () => unknown })
										.get === "function"
								? String(
										(activeMark.background as { get: () => unknown }).get(),
									)
								: String(activeMark.background);
					marks.push({
						x: markStartX - padX,
						y: currentBaselineY - markAsc - padY,
						width: markEndX - markStartX + padX * 2,
						height: markAsc + markDesc + padY * 2,
						background: bg,
						borderRadius: activeMark.borderRadius ?? 4,
						lineIndex,
					});
				}
				activeMark = undefined;
			};

			for (let gIdx = 0; gIdx < line.glyphs.length; gIdx++) {
				const g = line.glyphs[gIdx];
				const charX = g.x + alignOffset;

				// Mark grouping
				if (g.mark && !g.isSpace) {
					if (!activeMark || activeMark !== g.mark) {
						flushMark();
						activeMark = g.mark;
						markStartX = charX;
						markEndX = charX + g.advance;
						markAsc = (g.font.ascender ?? 800) * g.fontScale;
						markDesc = -(g.font.descender ?? -200) * g.fontScale;
					} else {
						markEndX = charX + g.advance;
						const a = (g.font.ascender ?? 800) * g.fontScale;
						const d = -(g.font.descender ?? -200) * g.fontScale;
						if (a > markAsc) markAsc = a;
						if (d > markDesc) markDesc = d;
					}
				} else {
					flushMark();
				}

				if (g.isEmoji) {
					emojis.push({
						char: g.char,
						x: charX,
						y: currentBaselineY - g.fontSize,
						size: g.fontSize,
						lineIndex,
					});
					charIndex++;
				} else if (g.cp) {
					if (g.isSpace) {
						if (inWord) {
							wordIndex++;
							inWord = false;
						}
					} else {
						if (!inWord) {
							inWord = true;
						}
					}

					let mappedUnitIndex = 0;
					if (applyBy === "line") {
						mappedUnitIndex = lineIndex;
					} else if (applyBy === "word") {
						mappedUnitIndex = wordIndex;
					} else {
						mappedUnitIndex = charIndex;
					}

					glyphs.push({
						char: g.char,
						cp: g.cp,
						x: charX,
						y: currentBaselineY + g.baselineShift,
						lineIndex,
						wordIndex,
						charIndex,
						unitIndex: mappedUnitIndex,
						isSpace: g.isSpace,
						spanIndex: g.spanIndex,
						fill: g.fill,
						fontSize: g.fontSize,
						fontScale: g.fontScale,
						baselineShift: g.baselineShift,
						opacity: g.opacity,
						fontFamily: g.font.fontFamily,
						font: g.font,
						mark: g.mark,
					});

					charIndex++;
				}
			}
			flushMark();

			if (inWord) {
				wordIndex++;
			}

			if (lineIndex < lines.length - 1) {
				currentBaselineY += Math.max(
					maxLineHeightPx,
					maxAscenderPx + maxDescenderPx,
				);
			}
		}

		// Calculate total distinct unit counts
		let maxUnitIndex = 0;
		for (const g of glyphs) {
			if (!g.isSpace && g.unitIndex > maxUnitIndex) {
				maxUnitIndex = g.unitIndex;
			}
		}

		const totalHeight =
			lines.length > 0
				? currentBaselineY +
					(defaultFontSize / defaultFont.unitsPerEm) *
						-(defaultFont.descender ?? -200)
				: 0;

		return {
			glyphs,
			emojis,
			marks: marks.length > 0 ? marks : undefined,
			totalHeight,
			linesCount: lines.length,
			wordsCount: Math.max(0, maxUnitIndex + 1),
			charsCount: charIndex,
		};
	}

	private static layoutOnPath(
		text: string,
		font: SlugFont,
		fontSize: number,
		letterSpacing: number,
		pathOptions: TextPathOptions,
		applyBy: "line" | "word" | "char" = "word",
	): SlugLayoutResult {
		const fontScale = fontSize / font.unitsPerEm;
		const segments = generatePathSegments(pathOptions.path);
		const chainLUT = buildPathLUT(segments);
		const totalLength = chainLUT.totalLength;

		const graphemes = segmentGraphemes(text);

		interface TokenChar {
			char: string;
			cp: SlugCodePoint | null;
			isEmoji: boolean;
			isSpace: boolean;
			advance: number;
			charIndex: number;
			wordIndex: number;
			unitIndex: number;
		}

		const chars: TokenChar[] = [];
		let wordIndex = 0;
		let charIndex = 0;
		let inWord = false;

		for (const char of graphemes) {
			if (char === "\uFE0F" || char === "\uFE0E" || char === "\u200D") {
				continue;
			}
			const isSpace = /^\s+$/.test(char);
			const isEmoji = EMOJI_REGEX.test(char);
			let cp: SlugCodePoint | null = null;
			let advance = 0;

			if (isEmoji) {
				advance = fontSize;
			} else {
				const codePoint = char.codePointAt(0) || 0;
				cp = font.codePoints.get(codePoint) || font.codePoints.get(-1) || null;
				advance = (cp?.advanceWidth || 0) * fontScale;
			}

			if (isSpace) {
				if (inWord) {
					wordIndex++;
					inWord = false;
				}
			} else {
				if (!inWord) {
					inWord = true;
				}
			}

			let unitIdx = charIndex;
			if (applyBy === "word") unitIdx = wordIndex;
			else if (applyBy === "line") unitIdx = 0;

			chars.push({
				char,
				cp,
				isEmoji,
				isSpace,
				advance,
				charIndex,
				wordIndex,
				unitIndex: unitIdx,
			});
			charIndex++;
		}
		if (inWord) wordIndex++;

		let baselineOffsetPixels = 0;
		if (pathOptions.baselineOffset === "center") {
			baselineOffsetPixels = (font.ascender + font.descender) * fontScale * 0.5;
		} else if (pathOptions.baselineOffset === "ascender") {
			baselineOffsetPixels = -font.ascender * fontScale;
		} else if (pathOptions.baselineOffset === "descender") {
			baselineOffsetPixels = -font.descender * fontScale;
		}
		const totalShift = (pathOptions.baselineShift ?? 0) + baselineOffsetPixels;

		const glyphs: SlugGlyphLayout[] = [];
		const emojis: SlugEmojiLayout[] = [];

		const firstMargin = pathOptions.firstMargin ?? 0;
		const lastMargin = pathOptions.lastMargin ?? 0;
		// Margins are insets from each end of the path (After Effects' First /
		// Last Margin); force alignment spreads the line across what is left.
		const effEnd = Math.max(firstMargin, totalLength - lastMargin);
		const pathSpan = effEnd - firstMargin;
		const advanceAt = (i: number): number => {
			const ch = chars[i];
			const next = chars[i + 1];
			const kern =
				next && !ch.isSpace && !next.isSpace && ch.cp && next.cp
					? getKernOffset(font, ch.cp.codePoint, next.cp.codePoint) * fontScale
					: 0;
			return ch.advance + letterSpacing + kern;
		};
		// The natural run: every advance but the last glyph's own width counts once.
		let naturalLength = 0;
		for (let i = 0; i < chars.length; i++)
			naturalLength += i < chars.length - 1 ? advanceAt(i) : chars[i].advance;
		const forceAlignExtra =
			pathOptions.forceAlignment && chars.length > 1
				? (pathSpan - naturalLength) / (chars.length - 1)
				: 0;

		let currentDistance = firstMargin;

		for (let i = 0; i < chars.length; i++) {
			const ch = chars[i];
			const d = currentDistance;

			let s = pathOptions.reversePath ? totalLength - d : d;
			if (pathOptions.loop && totalLength > 0) {
				s = ((s % totalLength) + totalLength) % totalLength;
			}

			const sample = samplePathChainGeometry(segments, chainLUT, s);
			const glyphX = sample.position.x + sample.normal.x * totalShift;
			const glyphY = sample.position.y + sample.normal.y * totalShift;
			const tangentRad =
				pathOptions.perpendicularToPath !== false
					? (sample.tangentAngleDeg * Math.PI) / 180
					: 0;

			if (ch.isEmoji) {
				emojis.push({
					char: ch.char,
					x: glyphX,
					y: glyphY - fontSize,
					size: fontSize,
					lineIndex: 0,
				});
			} else if (ch.cp) {
				glyphs.push({
					char: ch.char,
					cp: ch.cp,
					x: glyphX,
					y: glyphY,
					lineIndex: 0,
					wordIndex: ch.wordIndex,
					charIndex: ch.charIndex,
					unitIndex: ch.unitIndex,
					isSpace: ch.isSpace,
					pathTangentAngleRad: tangentRad,
					perpendicularToPath: pathOptions.perpendicularToPath !== false,
					pathNormalX: sample.normal.x,
					pathNormalY: sample.normal.y,
				});
			}

			currentDistance += advanceAt(i) + forceAlignExtra;
		}

		return {
			glyphs,
			emojis,
			totalHeight: fontSize * 1.5,
			linesCount: 1,
			wordsCount: wordIndex,
			charsCount: charIndex,
		};
	}
}
