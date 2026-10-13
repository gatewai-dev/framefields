import type { TextSpan, TextSpanMark } from "@framefields/core";
import {
	buildPathLUT,
	generatePathSegments,
	samplePathChainGeometry,
} from "../text-animations/path.js";
import type { TextPathOptions } from "../text-animations/types.js";
import { SlugFontCache } from "./slug-font-cache.js";
import type { SlugCodePoint, SlugFont } from "./slug-loader.js";
import {
	alignOffset,
	breakLines,
	fontIdentity,
	type PlacedLine,
	placeLine,
	resolveAlign,
	type ShapedCluster,
	type ShapeStyle,
	shapeParagraph,
	type TextDirection,
} from "./text-shaping.js";

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
	/** UTF-16 index in the laid-out text of the cluster this glyph draws. */
	textIndex?: number;
	/** The glyph belongs to a right-to-left run. */
	rtl?: boolean;
	/** Advance of the glyph's whole cluster, px (letter spacing excluded). */
	clusterAdvance?: number;
	/** Left edge of the glyph's cluster on its line, px. */
	clusterX?: number;
	/** The glyph's paragraph runs right to left (so "start" is the right edge). */
	baseRtl?: boolean;
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
	/** Some text was laid out right to left. */
	hasRtl?: boolean;
}

type Align = "left" | "center" | "right" | "start" | "end";
type ApplyBy = "line" | "word" | "char";

const layoutCache = new Map<string, SlugLayoutResult>();
const MAX_LAYOUT_CACHE = 256;

function cacheResult(key: string, result: SlugLayoutResult): SlugLayoutResult {
	if (layoutCache.size >= MAX_LAYOUT_CACHE) {
		const firstKey = layoutCache.keys().next().value;
		if (firstKey) layoutCache.delete(firstKey);
	}
	layoutCache.set(key, result);
	return result;
}

/** Reads a plain value or an animated `{ get() }` one. */
function resolveValue(v: unknown): unknown {
	if (
		v &&
		typeof v === "object" &&
		"get" in v &&
		typeof (v as { get: unknown }).get === "function"
	) {
		return (v as { get: () => unknown }).get();
	}
	return v;
}

interface LogicalIndices {
	charIndex: number;
	wordIndex: number;
	unitIndex: number;
}

/**
 * Animation indices follow reading order, so a right-to-left line reveals
 * from the right. Emoji count as characters but neither start nor end words.
 */
function assignIndices<S extends ShapeStyle>(
	lines: ShapedCluster<S>[][],
	applyBy: ApplyBy,
): {
	indices: Map<ShapedCluster<S>, LogicalIndices>;
	words: number;
	chars: number;
} {
	const indices = new Map<ShapedCluster<S>, LogicalIndices>();
	let wordIndex = 0;
	let charIndex = 0;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		let inWord = false;
		for (const c of lines[lineIndex]) {
			if (!c.isEmoji) {
				if (c.isSpace) {
					if (inWord) {
						wordIndex++;
						inWord = false;
					}
				} else {
					inWord = true;
				}
			}
			const unitIndex =
				applyBy === "line"
					? lineIndex
					: applyBy === "word"
						? wordIndex
						: charIndex;
			indices.set(c, { charIndex, wordIndex, unitIndex });
			if (c.isEmoji || c.glyphs.length > 0) charIndex++;
		}
		if (inWord) wordIndex++;
	}
	return { indices, words: wordIndex, chars: charIndex };
}

/** Optional ligatures stay off when text animates per character or is letter-spaced (as in CSS). */
function useLigatures(applyBy: ApplyBy, letterSpacing: number): boolean {
	return applyBy !== "char" && letterSpacing === 0;
}

export class SlugGeometry {
	static layout(
		text: string,
		font: SlugFont,
		fontSize: number,
		letterSpacing: number,
		lineHeight: number,
		maxWidth: number,
		align: Align = "left",
		applyBy: ApplyBy = "word",
		alignWidth?: number,
		pathOptions?: TextPathOptions,
		spans?: TextSpan[],
		direction: TextDirection = "auto",
	): SlugLayoutResult {
		const fontKey = fontIdentity(font);
		if (spans && spans.length > 0) {
			const spansKey = spans
				.map(
					(s) =>
						`${typeof s.text === "string" ? s.text : ""}:${s.fontFamily ?? ""}:${s.fontWeight ?? ""}:${s.fontSize ?? ""}:${s.fill ?? ""}:${s.baselineShift ?? ""}:${s.letterSpacing ?? ""}`,
				)
				.join(";");
			const cacheKey = `${text}|${fontKey}|${fontSize}|${letterSpacing}|${lineHeight}|${maxWidth}|${align}|${applyBy}|${alignWidth ?? ""}|${direction}|${spansKey}`;
			const cached = layoutCache.get(cacheKey);
			if (cached) return cached;

			return cacheResult(
				cacheKey,
				SlugGeometry.layoutSpans(
					spans,
					font,
					fontSize,
					letterSpacing,
					lineHeight,
					maxWidth,
					align,
					applyBy,
					alignWidth,
					direction,
				),
			);
		}

		if (pathOptions) {
			return SlugGeometry.layoutOnPath(
				text,
				font,
				fontSize,
				letterSpacing,
				pathOptions,
				applyBy,
				direction,
			);
		}

		const cacheKey = `${text}|${fontKey}|${fontSize}|${letterSpacing}|${lineHeight}|${maxWidth}|${align}|${applyBy}|${alignWidth ?? ""}|${direction}`;
		const cached = layoutCache.get(cacheKey);
		if (cached) return cached;

		const style: ShapeStyle = { font, fontSize, letterSpacing };
		const ligatures = useLigatures(applyBy, letterSpacing);

		// 1. Shape each paragraph and wrap it into lines (logical order).
		interface Line {
			clusters: ShapedCluster[];
			baseLevel: number;
			textOffset: number;
		}
		const lines: Line[] = [];
		let textOffset = 0;
		for (const paragraph of text.split("\n")) {
			const shaped = shapeParagraph([{ text: paragraph, style }], {
				direction,
				ligatures,
			});
			for (const clusters of breakLines(shaped.clusters, maxWidth)) {
				lines.push({ clusters, baseLevel: shaped.baseLevel, textOffset });
			}
			textOffset += paragraph.length + 1;
		}

		const { indices, words, chars } = assignIndices(
			lines.map((l) => l.clusters),
			applyBy,
		);

		// 2. Order each line for display, align it, and emit glyphs.
		const glyphs: SlugGlyphLayout[] = [];
		const emojis: SlugEmojiLayout[] = [];
		let hasRtl = false;
		let currentY = font.ascender * (fontSize / font.unitsPerEm); // Baseline of first line
		const targetAlignWidth = alignWidth ?? maxWidth;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const { clusters, baseLevel, textOffset: offset } = lines[lineIndex];
			const placed = placeLine(clusters, baseLevel);
			const shift = alignOffset(
				placed,
				resolveAlign(align, baseLevel),
				targetAlignWidth,
			);
			const xOf = new Map<ShapedCluster, number>();
			for (const p of placed.clusters) xOf.set(p.cluster, p.x + shift);
			if (baseLevel & 1) hasRtl = true;

			// Emit in reading order; positions come from the visual placement.
			for (const c of clusters) {
				const x = xOf.get(c) ?? 0;
				const idx = indices.get(c) as LogicalIndices;
				const rtl = (c.level & 1) === 1;
				if (rtl) hasRtl = true;
				if (c.isEmoji) {
					emojis.push({
						char: c.text,
						x: x + c.inkStart,
						y: currentY - fontSize,
						size: fontSize,
						lineIndex,
					});
					continue;
				}
				for (const g of c.glyphs) {
					glyphs.push({
						char: c.text,
						cp: g.cp,
						x: x + g.dx,
						y: currentY + g.dy,
						lineIndex,
						wordIndex: idx.wordIndex,
						charIndex: idx.charIndex,
						unitIndex: idx.unitIndex,
						isSpace: c.isSpace,
						textIndex: offset + c.start,
						rtl,
						clusterAdvance: c.advance - c.spacing,
						clusterX: x,
						baseRtl: (baseLevel & 1) === 1,
					});
				}
			}
			currentY += lineHeight;
		}

		const totalHeight =
			currentY - lineHeight + -font.descender * (fontSize / font.unitsPerEm);

		return cacheResult(cacheKey, {
			glyphs,
			emojis,
			totalHeight,
			linesCount: lines.length,
			wordsCount: words,
			charsCount: chars,
			hasRtl: hasRtl || undefined,
		});
	}

	static measure(
		text: string,
		font: SlugFont,
		fontSize: number,
		letterSpacing: number,
		lineHeight: number,
		maxWidth?: number,
		spans?: TextSpan[],
		direction: TextDirection = "auto",
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
			direction,
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

		return {
			width: Math.ceil(contentWidth),
			height: Math.ceil(layout.totalHeight),
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
		align: Align = "left",
		applyBy: ApplyBy = "word",
		alignWidth?: number,
		direction: TextDirection = "auto",
	): SlugLayoutResult {
		interface SpanStyle extends ShapeStyle {
			spanIndex: number;
			fontScale: number;
			baselineShift: number;
			fill?: string;
			opacity?: number;
			mark?: TextSpanMark;
		}

		// Split the spans into paragraphs of styled segments.
		const paragraphs: Array<Array<{ text: string; style: SpanStyle }>> = [[]];
		let ligatures = useLigatures(applyBy, defaultLetterSpacing);
		for (let sIdx = 0; sIdx < spans.length; sIdx++) {
			const s = spans[sIdx];
			const rawText = String(resolveValue(s.text) ?? "");

			let spanFont = defaultFont;
			if (s.fontFamily || s.fontWeight !== undefined) {
				const family = s.fontFamily ?? defaultFont.fontFamily ?? "Inter";
				const resolved = SlugFontCache.getFont(family, s.fontWeight, null);
				if (resolved) spanFont = resolved;
			}
			const sizeValue = resolveValue(s.fontSize);
			const spanFontSize =
				typeof sizeValue === "number"
					? sizeValue
					: sizeValue !== undefined
						? Number(sizeValue)
						: defaultFontSize;
			const fillValue = resolveValue(s.fill);
			const opacityValue = resolveValue(s.opacity);
			const style: SpanStyle = {
				font: spanFont,
				fontSize: spanFontSize,
				fontScale: spanFontSize / spanFont.unitsPerEm,
				letterSpacing: s.letterSpacing ?? defaultLetterSpacing,
				baselineShift: s.baselineShift ?? 0,
				fill: fillValue !== undefined ? String(fillValue) : undefined,
				opacity: opacityValue !== undefined ? Number(opacityValue) : undefined,
				mark: s.mark,
				spanIndex: sIdx,
			};
			if (style.letterSpacing !== 0) ligatures = false;

			const parts = rawText.split("\n");
			for (let p = 0; p < parts.length; p++) {
				if (p > 0) paragraphs.push([]);
				if (parts[p]) {
					paragraphs[paragraphs.length - 1].push({ text: parts[p], style });
				}
			}
		}

		interface Line {
			clusters: ShapedCluster<SpanStyle>[];
			baseLevel: number;
		}
		const lines: Line[] = [];
		for (const segments of paragraphs) {
			const shaped = shapeParagraph(segments, { direction, ligatures });
			for (const clusters of breakLines(shaped.clusters, maxWidth)) {
				lines.push({ clusters, baseLevel: shaped.baseLevel });
			}
		}

		const { indices, chars } = assignIndices(
			lines.map((l) => l.clusters),
			applyBy,
		);

		// Baseline alignment & output glyph assembly
		const glyphs: SlugGlyphLayout[] = [];
		const emojis: SlugEmojiLayout[] = [];
		const marks: SlugMarkLayout[] = [];
		let hasRtl = false;

		let currentBaselineY = 0;
		const targetAlignWidth = alignWidth ?? maxWidth;
		const defaultScale = defaultFontSize / defaultFont.unitsPerEm;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const { clusters, baseLevel } = lines[lineIndex];

			let maxAscenderPx = (defaultFont.ascender ?? 800) * defaultScale;
			let maxDescenderPx = -(defaultFont.descender ?? -200) * defaultScale;
			let maxLineHeightPx = defaultLineHeight;

			for (const c of clusters) {
				const st = c.style;
				const asc = (st.font.ascender ?? 800) * st.fontScale;
				const desc = -(st.font.descender ?? -200) * st.fontScale;
				const lh = defaultLineHeight * (st.fontSize / defaultFontSize);
				if (asc > maxAscenderPx) maxAscenderPx = asc;
				if (desc > maxDescenderPx) maxDescenderPx = desc;
				if (lh > maxLineHeightPx) maxLineHeightPx = lh;
			}

			if (lineIndex === 0) {
				currentBaselineY = maxAscenderPx;
			}

			const placed: PlacedLine<SpanStyle> = placeLine(clusters, baseLevel);
			const shift = alignOffset(
				placed,
				resolveAlign(align, baseLevel),
				targetAlignWidth,
			);
			if (baseLevel & 1) hasRtl = true;

			// Mark backgrounds group visually adjacent clusters of one mark.
			let activeMark: TextSpanMark | undefined;
			let markStartX = 0;
			let markEndX = 0;
			let markAsc = maxAscenderPx;
			let markDesc = maxDescenderPx;

			const flushMark = () => {
				if (activeMark && markEndX > markStartX) {
					const padX = activeMark.paddingX ?? 4;
					const padY = activeMark.paddingY ?? 2;
					marks.push({
						x: markStartX - padX,
						y: currentBaselineY - markAsc - padY,
						width: markEndX - markStartX + padX * 2,
						height: markAsc + markDesc + padY * 2,
						background: String(resolveValue(activeMark.background)),
						borderRadius: activeMark.borderRadius ?? 4,
						lineIndex,
					});
				}
				activeMark = undefined;
			};

			const xOf = new Map<ShapedCluster<SpanStyle>, number>();
			for (const p of placed.clusters) {
				const c = p.cluster;
				const x = p.x + shift;
				xOf.set(c, x);
				const st = c.style;
				if (st.mark && !c.isSpace) {
					const a = (st.font.ascender ?? 800) * st.fontScale;
					const d = -(st.font.descender ?? -200) * st.fontScale;
					if (!activeMark || activeMark !== st.mark) {
						flushMark();
						activeMark = st.mark;
						markStartX = x + c.inkStart;
						markEndX = x + c.inkEnd;
						markAsc = a;
						markDesc = d;
					} else {
						markEndX = x + c.inkEnd;
						if (a > markAsc) markAsc = a;
						if (d > markDesc) markDesc = d;
					}
				} else {
					flushMark();
				}
			}
			flushMark();

			for (const c of clusters) {
				const x = xOf.get(c) ?? 0;
				const st = c.style;
				const idx = indices.get(c) as LogicalIndices;
				const rtl = (c.level & 1) === 1;
				if (rtl) hasRtl = true;
				if (c.isEmoji) {
					emojis.push({
						char: c.text,
						x: x + c.inkStart,
						y: currentBaselineY - st.fontSize,
						size: st.fontSize,
						lineIndex,
					});
					continue;
				}
				for (const g of c.glyphs) {
					glyphs.push({
						char: c.text,
						cp: g.cp,
						x: x + g.dx,
						y: currentBaselineY + st.baselineShift + g.dy,
						lineIndex,
						wordIndex: idx.wordIndex,
						charIndex: idx.charIndex,
						unitIndex: idx.unitIndex,
						isSpace: c.isSpace,
						rtl,
						clusterAdvance: c.advance - c.spacing,
						clusterX: x,
						baseRtl: (baseLevel & 1) === 1,
						spanIndex: st.spanIndex,
						fill: st.fill,
						fontSize: st.fontSize,
						fontScale: st.fontScale,
						baselineShift: st.baselineShift,
						opacity: st.opacity,
						fontFamily: st.font.fontFamily,
						font: st.font,
						mark: st.mark,
					});
				}
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
				? currentBaselineY + defaultScale * -(defaultFont.descender ?? -200)
				: 0;

		return {
			glyphs,
			emojis,
			marks: marks.length > 0 ? marks : undefined,
			totalHeight,
			linesCount: lines.length,
			wordsCount: Math.max(0, maxUnitIndex + 1),
			charsCount: chars,
			hasRtl: hasRtl || undefined,
		};
	}

	private static layoutOnPath(
		text: string,
		font: SlugFont,
		fontSize: number,
		letterSpacing: number,
		pathOptions: TextPathOptions,
		applyBy: ApplyBy = "word",
		direction: TextDirection = "auto",
	): SlugLayoutResult {
		const fontScale = fontSize / font.unitsPerEm;
		const segments = generatePathSegments(pathOptions.path);
		const chainLUT = buildPathLUT(segments);
		const totalLength = chainLUT.totalLength;

		// Path text is a single line: shape it whole, then lay it along the
		// path in display order.
		const shaped = shapeParagraph(
			[
				{
					text: text.replace(/\n/g, " "),
					style: { font, fontSize, letterSpacing },
				},
			],
			{ direction, ligatures: useLigatures(applyBy, letterSpacing) },
		);
		const clusters = shaped.clusters;
		const { indices, words, chars } = assignIndices([clusters], applyBy);
		const visual = placeLine(clusters, shaped.baseLevel).clusters.map(
			(p) => p.cluster,
		);

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
		// The natural run: every advance but the last cluster's own width counts once.
		let naturalLength = 0;
		for (let i = 0; i < visual.length; i++) {
			const c = visual[i];
			naturalLength +=
				i < visual.length - 1 ? c.advance : c.advance - c.spacing;
		}
		const forceAlignExtra =
			pathOptions.forceAlignment && visual.length > 1
				? (pathSpan - naturalLength) / (visual.length - 1)
				: 0;

		const perpendicular = pathOptions.perpendicularToPath !== false;
		const sampleAt = (d: number) => {
			let s = pathOptions.reversePath ? totalLength - d : d;
			if (pathOptions.loop && totalLength > 0) {
				s = ((s % totalLength) + totalLength) % totalLength;
			}
			return samplePathChainGeometry(segments, chainLUT, s);
		};

		let currentDistance = firstMargin;
		for (const c of visual) {
			const idx = indices.get(c) as LogicalIndices;
			if (c.isEmoji) {
				const sample = sampleAt(currentDistance + c.inkStart);
				emojis.push({
					char: c.text,
					x: sample.position.x + sample.normal.x * totalShift,
					y: sample.position.y + sample.normal.y * totalShift - fontSize,
					size: fontSize,
					lineIndex: 0,
				});
			} else {
				for (const g of c.glyphs) {
					// Each glyph (a mark too) sits where its own offset lands on the path.
					const sample = sampleAt(currentDistance + g.dx);
					const shift = totalShift + g.dy;
					glyphs.push({
						char: c.text,
						cp: g.cp,
						x: sample.position.x + sample.normal.x * shift,
						y: sample.position.y + sample.normal.y * shift,
						lineIndex: 0,
						wordIndex: idx.wordIndex,
						charIndex: idx.charIndex,
						unitIndex: applyBy === "line" ? 0 : idx.unitIndex,
						isSpace: c.isSpace,
						textIndex: c.start,
						rtl: (c.level & 1) === 1,
						clusterAdvance: c.advance - c.spacing,
						pathTangentAngleRad: perpendicular
							? (sample.tangentAngleDeg * Math.PI) / 180
							: 0,
						perpendicularToPath: perpendicular,
						pathNormalX: sample.normal.x,
						pathNormalY: sample.normal.y,
					});
				}
			}
			currentDistance += c.advance + forceAlignExtra;
		}

		return {
			glyphs,
			emojis,
			totalHeight: fontSize * 1.5,
			linesCount: 1,
			wordsCount: words,
			charsCount: chars,
			hasRtl:
				shaped.baseLevel & 1 || clusters.some((c) => c.level & 1)
					? true
					: undefined,
		};
	}
}
