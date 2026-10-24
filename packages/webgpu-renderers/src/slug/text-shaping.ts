/**
 * Turns styled text into positioned glyph clusters: Unicode bidi levels
 * (bidi-js), OpenType shaping per run (fontkit: GSUB joining forms and
 * ligatures, GPOS kerning and mark placement), then line breaking and the
 * per-line visual reordering of UAX #9 (L1, L2).
 *
 * Clusters stay in logical (reading) order until {@link placeLine}, so line
 * breaking, word/char indices and typewriter prefixes all follow the text.
 */
import bidiFactory from "bidi-js";
import {
	type FontkitFont,
	type FontkitGlyph,
	getSlugFontSource,
	SlugGenerator,
} from "./slug-generator.js";
import type { SlugCodePoint, SlugFont } from "./slug-loader.js";

/** Base direction of a paragraph. `auto` takes it from the first strong character. */
export type TextDirection = "ltr" | "rtl" | "auto";

export interface ShapeStyle {
	font: SlugFont;
	fontSize: number;
	letterSpacing: number;
}

export interface ShapedGlyph {
	cp: SlugCodePoint;
	/** Pen offset from the cluster's visual left edge, px. */
	dx: number;
	/** Baseline offset, px, positive down. */
	dy: number;
}

export interface ShapedCluster<S extends ShapeStyle = ShapeStyle> {
	/** Source text of the cluster: one grapheme, or several a ligature joined. */
	text: string;
	/** UTF-16 offset of the cluster in the paragraph. */
	start: number;
	style: S;
	isSpace: boolean;
	isEmoji: boolean;
	/** Bidi embedding level; odd is right-to-left. */
	level: number;
	/** Glyphs in visual order. */
	glyphs: ShapedGlyph[];
	/** Pen advance including the letter spacing, px. */
	advance: number;
	/** Letter spacing included in `advance`; it trails the cluster in reading order. */
	spacing: number;
	/** Visible span within the advance, px from the cluster's left edge. */
	inkStart: number;
	inkEnd: number;
}

interface ShapedParagraph<S extends ShapeStyle = ShapeStyle> {
	clusters: ShapedCluster<S>[];
	/** Paragraph embedding level: 0 left-to-right, 1 right-to-left. */
	baseLevel: number;
}

interface ShapeOptions {
	direction?: TextDirection;
	/** Optional ligatures (`liga`, `clig`); required ones such as lam-alef always apply. */
	ligatures?: boolean;
	/** Set emoji apart for bitmap drawing (default); false shapes them as glyphs. */
	emoji?: boolean;
}

const EMOJI_REGEX =
	/(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[☀-➿])/u;

/** Characters that make bidi analysis necessary (RTL letters and explicit RTL controls). */
const RTL_REGEX = /[֐-ࣿיִ-﷿ﹰ-﻿‏‫‮⁧\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * Scripts whose letters join; letter spacing would break the joins, so CSS
 * says not to apply it there (Arabic, Syriac, Thaana, N'Ko, Mongolian, …).
 */
const CURSIVE_REGEX = /[؀-ࣿﭐ-﷿ﹰ-﻿᠀-᢯\u{10D00}-\u{10D3F}\u{10F30}-\u{10F6F}]/u;

const SPACE_REGEX = /^\s+$/;

type Bidi = ReturnType<typeof bidiFactory>;
let bidiInstance: Bidi | null = null;
function bidi(): Bidi {
	bidiInstance ??= bidiFactory();
	return bidiInstance;
}

/** BMP stand-ins with the same bidi class, for astral characters bidi-js reads per UTF-16 unit. */
const BIDI_STAND_INS: Record<string, string> = {
	L: "a",
	R: "א",
	AL: "ا",
	EN: "0",
	AN: "٠",
	ES: "+",
	ET: "#",
	CS: ",",
	NSM: "̀",
	BN: "​",
	WS: " ",
	ON: "!",
};

function bidiLevels(
	text: string,
	direction: TextDirection,
): { levels: Uint8Array; baseLevel: number } {
	const b = bidi();
	// bidi-js classifies each UTF-16 unit on its own, so a surrogate pair (an
	// emoji, say) would read as two strong left-to-right characters.
	let analysed = text;
	if (/[\uD800-\uDBFF]/.test(text)) {
		let out = "";
		for (const ch of text) {
			if (ch.length === 1) {
				out += ch;
				continue;
			}
			const stand = BIDI_STAND_INS[b.getBidiCharTypeName(ch)] ?? "!";
			out += stand + stand;
		}
		analysed = out;
	}
	const result = b.getEmbeddingLevels(
		analysed,
		direction === "auto" ? undefined : direction,
	);
	return {
		levels: result.levels,
		baseLevel: result.paragraphs[0]?.level ?? (direction === "rtl" ? 1 : 0),
	};
}

interface Grapheme {
	text: string;
	start: number;
}

const graphemeSegmenter: {
	segment(text: string): Iterable<{ segment: string; index: number }>;
} | null =
	typeof Intl !== "undefined" &&
	typeof (Intl as { Segmenter?: unknown }).Segmenter === "function"
		? new (
				Intl as unknown as {
					Segmenter: new (
						locale: string | undefined,
						opts: { granularity: string },
					) => {
						segment(text: string): Iterable<{ segment: string; index: number }>;
					};
				}
			).Segmenter(undefined, { granularity: "grapheme" })
		: null;

function segmentGraphemes(text: string): Grapheme[] {
	const out: Grapheme[] = [];
	if (graphemeSegmenter) {
		for (const s of graphemeSegmenter.segment(text)) {
			out.push({ text: s.segment, start: s.index });
		}
		return out;
	}
	let i = 0;
	for (const ch of text) {
		out.push({ text: ch, start: i });
		i += ch.length;
	}
	return out;
}

// ── Shaping ──────────────────────────────────────────────────────────────

interface RunGlyph {
	cp: SlugCodePoint;
	/** UTF-16 offset in the run of the glyph's first character. */
	offset: number;
	/** UTF-16 offset just past the glyph's last character. */
	end: number;
	xAdvance: number;
	xOffset: number;
	yOffset: number;
}

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
function objectId(o: object): number {
	let id = objectIds.get(o);
	if (id === undefined) {
		id = nextObjectId++;
		objectIds.set(o, id);
	}
	return id;
}

/** A stable identity for a font, for cache keys (family names are shared by weights). */
export function fontIdentity(font: SlugFont): number {
	return objectId(font);
}

const SHAPE_CACHE_MAX = 2048;
const shapeCache = new Map<string, RunGlyph[]>();

function resolveShapingSource(font: SlugFont): FontkitFont | null {
	const own = getSlugFontSource(font) ?? viewSources.get(font);
	if (own) return own;
	if (!font.fontFamily) return null;
	const parsed = (globalThis as Record<symbol, unknown>)[
		Symbol.for("gatewai.slugFontCache.parsed")
	] as Map<string, FontkitFont> | undefined;
	return parsed?.get(font.fontFamily) ?? null;
}

function notdef(font: SlugFont): SlugCodePoint | undefined {
	return font.codePoints.get(-1) ?? font.glyphs?.get(0);
}

/** Looks a code point up, generating its glyph on first use. */
function glyphForCodePoint(
	font: SlugFont,
	codePoint: number,
): SlugCodePoint | undefined {
	let cp = font.codePoints.get(codePoint);
	if (!cp && SlugGenerator.ensureCodePoints(font, [codePoint])) {
		cp = font.codePoints.get(codePoint);
	}
	return cp ?? notdef(font);
}

/** Invisible format characters (joiners, bidi controls, variation selectors). */
function isIgnorable(cp: number): boolean {
	return (
		cp === 0x00ad ||
		(cp >= 0x200b && cp <= 0x200f) ||
		(cp >= 0x202a && cp <= 0x202e) ||
		(cp >= 0x2060 && cp <= 0x206f) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) ||
		cp === 0xfeff
	);
}

function isIgnorableOnly(text: string): boolean {
	for (const ch of text) {
		if (!isIgnorable(ch.codePointAt(0) ?? 0)) return false;
	}
	return text.length > 0;
}

/** One glyph per code point through the cmap: fonts with no shaping source. */
function mapRun(font: SlugFont, text: string): RunGlyph[] {
	const out: RunGlyph[] = [];
	let offset = 0;
	for (const ch of text) {
		const codePoint = ch.codePointAt(0) ?? 0;
		if (isIgnorable(codePoint)) {
			offset += ch.length;
			continue;
		}
		const cp = glyphForCodePoint(font, codePoint);
		if (cp) {
			out.push({
				cp,
				offset,
				end: offset + ch.length,
				xAdvance: cp.advanceWidth,
				xOffset: 0,
				yOffset: 0,
			});
		}
		offset += ch.length;
	}
	return out;
}

interface FontkitInternals {
	glyphsForString?(text: string): FontkitGlyph[];
	_layoutEngine?: {
		engine?: {
			glyphInfos?: Array<{ codePoints: number[] }> | null;
			cleanup?: () => void;
		};
	};
}

const VARIATION_SELECTOR_REGEX = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
const MARK_REGEX = /^\p{M}$/u;

/**
 * Runs fontkit's layout and returns glyphs in logical order with the code
 * points each one stands for.
 *
 * fontkit caches glyph objects per glyph id, and a cached glyph keeps the
 * code points of whatever text created it first. The shapers read those code
 * points (Arabic joining types, marks), and so would cluster mapping, so the
 * run is fed fresh glyph copies carrying this text's code points, and the
 * post-substitution code points are read from the engine's own glyph infos.
 */
function layoutWithCodePoints(
	source: FontkitFont,
	text: string,
	rtl: boolean,
	ligatures: boolean,
): {
	glyphs: FontkitGlyph[];
	codePoints: number[][];
	positions: Array<{ xAdvance: number; xOffset: number; yOffset: number }>;
} | null {
	const internals = source as FontkitFont & FontkitInternals;
	if (typeof source.layout !== "function") return null;

	let input: string | FontkitGlyph[] = text;
	if (typeof internals.glyphsForString === "function") {
		const base = internals.glyphsForString(text);
		const chars = Array.from(text);
		const fresh: FontkitGlyph[] = [];
		let c = 0;
		for (const g of base) {
			while (c < chars.length && VARIATION_SELECTOR_REGEX.test(chars[c])) c++;
			const cps: number[] = [];
			if (c < chars.length) cps.push(chars[c++].codePointAt(0) ?? 0);
			while (c < chars.length && VARIATION_SELECTOR_REGEX.test(chars[c])) {
				cps.push(chars[c++].codePointAt(0) ?? 0);
			}
			const copy = Object.assign(Object.create(Object.getPrototypeOf(g)), g, {
				codePoints: cps,
				isMark:
					cps.length > 0 &&
					cps.every((cp) => MARK_REGEX.test(String.fromCodePoint(cp))),
				isLigature: cps.length > 1,
			}) as FontkitGlyph;
			fresh.push(copy);
		}
		input = fresh;
	}

	// Capture the engine's glyph infos before its cleanup drops them.
	const engine = internals._layoutEngine?.engine;
	let infos: Array<{ codePoints: number[] }> | null = null;
	const originalCleanup = engine?.cleanup;
	if (engine && typeof originalCleanup === "function") {
		engine.cleanup = function (this: typeof engine) {
			infos = this.glyphInfos ? this.glyphInfos.slice() : null;
			return originalCleanup.call(this);
		};
	}
	let run: ReturnType<NonNullable<FontkitFont["layout"]>>;
	try {
		run = (
			source.layout as (
				s: string | FontkitGlyph[],
				...rest: unknown[]
			) => ReturnType<NonNullable<FontkitFont["layout"]>>
		)(
			input,
			ligatures ? {} : { liga: false, clig: false },
			undefined,
			undefined,
			rtl ? "rtl" : "ltr",
		);
	} catch {
		return null;
	} finally {
		if (engine && originalCleanup) {
			delete (engine as { cleanup?: unknown }).cleanup;
			if (engine.cleanup !== originalCleanup) engine.cleanup = originalCleanup;
		}
	}

	// fontkit hands right-to-left runs back in visual order; work logically.
	const glyphs = run.glyphs.slice();
	const positions = run.positions.slice();
	if (rtl) {
		glyphs.reverse();
		positions.reverse();
	}
	const captured = infos as Array<{ codePoints: number[] }> | null;
	const codePoints =
		captured && captured.length === glyphs.length
			? captured.map((info) => info.codePoints ?? [])
			: glyphs.map((g) => g.codePoints ?? []);
	return { glyphs, codePoints, positions };
}

function shapeRun(
	font: SlugFont,
	text: string,
	rtl: boolean,
	ligatures: boolean,
): RunGlyph[] {
	const source = resolveShapingSource(font);
	if (!source || typeof source.layout !== "function") {
		return mapRun(font, text);
	}
	const key = `${objectId(font)}|${rtl ? 1 : 0}|${ligatures ? 1 : 0}|${text}`;
	const hit = shapeCache.get(key);
	if (hit) return hit;

	const shaped = layoutWithCodePoints(source, text, rtl, ligatures);
	if (!shaped) return mapRun(font, text);
	const { glyphs, codePoints: glyphCps, positions } = shaped;

	// Code points of the run, with their UTF-16 offsets.
	const runCps: number[] = [];
	const cpOffsets: number[] = [];
	{
		let o = 0;
		for (const ch of text) {
			runCps.push(ch.codePointAt(0) ?? 0);
			cpOffsets.push(o);
			o += ch.length;
		}
		cpOffsets.push(o);
	}

	const ids = new Set<number>();
	for (const g of glyphs) ids.add(g.id);
	SlugGenerator.ensureGlyphs(font, ids);

	const out: RunGlyph[] = [];
	let cursor = 0;
	let lastStart = 0;
	for (let i = 0; i < glyphs.length; i++) {
		const g = glyphs[i];
		const cps = glyphCps[i];
		const pos = positions[i];
		const n = cps.length;
		let start = lastStart;
		let count = 0;
		if (n > 0) {
			// fontkit reports the characters each glyph stands for; find them in
			// the run, tolerating substitutions that changed the code point.
			start = Math.min(cursor, runCps.length - 1);
			for (let k = cursor; k < Math.min(runCps.length, cursor + 8); k++) {
				if (runCps[k] === cps[0]) {
					start = k;
					break;
				}
			}
			count = Math.min(n, runCps.length - start);
			cursor = Math.max(cursor, start + count);
			lastStart = start;
		}
		const cp =
			font.glyphs?.get(g.id) ??
			(n > 0 ? font.codePoints.get(cps[0]) : undefined) ??
			notdef(font);
		if (!cp) continue;
		out.push({
			cp,
			offset: cpOffsets[Math.max(0, start)] ?? 0,
			end: cpOffsets[Math.max(0, start) + Math.max(1, count)] ?? text.length,
			xAdvance: pos.xAdvance,
			xOffset: pos.xOffset,
			yOffset: pos.yOffset,
		});
	}

	if (shapeCache.size >= SHAPE_CACHE_MAX) {
		const first = shapeCache.keys().next().value;
		if (first !== undefined) shapeCache.delete(first);
	}
	shapeCache.set(key, out);
	return out;
}

// ── Paragraph ────────────────────────────────────────────────────────────

/**
 * Shapes one paragraph (no line breaks inside) given as styled segments.
 * Returns its clusters in logical order and its resolved base level.
 */
export function shapeParagraph<S extends ShapeStyle>(
	segments: ReadonlyArray<{ text: string; style: S }>,
	options: ShapeOptions = {},
): ShapedParagraph<S> {
	const direction = options.direction ?? "auto";
	const ligatures = options.ligatures ?? true;

	let text = "";
	const styleAt: S[] = [];
	for (const seg of segments) {
		text += seg.text;
		for (let i = 0; i < seg.text.length; i++) styleAt.push(seg.style);
	}
	if (text.length === 0) {
		return { clusters: [], baseLevel: direction === "rtl" ? 1 : 0 };
	}

	const needsBidi = direction === "rtl" || RTL_REGEX.test(text);
	const analysis = needsBidi ? bidiLevels(text, direction) : null;
	const levels = analysis?.levels ?? null;
	const levelAt = (i: number) => (levels ? levels[i] : 0);
	const baseLevel = analysis?.baseLevel ?? 0;

	// Mirror brackets and the like inside right-to-left runs (bidi L4).
	let shapeText = text;
	if (levels) {
		const b = bidi();
		let mirrored = "";
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			mirrored += levels[i] & 1 ? (b.getMirroredCharacter(ch) ?? ch) : ch;
		}
		shapeText = mirrored;
	}

	const graphemes = segmentGraphemes(text);
	const graphemeAt = new Int32Array(text.length);
	for (let g = 0; g < graphemes.length; g++) {
		const { start, text: gt } = graphemes[g];
		for (let k = 0; k < gt.length; k++) graphemeAt[start + k] = g;
	}
	const isEmojiGrapheme = graphemes.map(
		(g) => options.emoji !== false && EMOJI_REGEX.test(g.text),
	);

	// Glyphs per grapheme, and ligature merges (a glyph spanning graphemes).
	const glyphsOf: RunGlyph[][] = graphemes.map(() => []);
	const mergeTo = new Int32Array(graphemes.length);
	for (let g = 0; g < graphemes.length; g++) mergeTo[g] = g;

	// Itemize: runs of one font/size and one level, emoji kept out.
	let runStart = 0;
	const flushRun = (end: number) => {
		if (end <= runStart) return;
		const style = styleAt[runStart];
		const runText = shapeText.slice(runStart, end);
		const rtl = (levelAt(runStart) & 1) === 1;
		for (const rg of shapeRun(style.font, runText, rtl, ligatures)) {
			const at = runStart + rg.offset;
			const g0 = graphemeAt[Math.min(at, text.length - 1)];
			const g1 = graphemeAt[Math.min(runStart + rg.end - 1, text.length - 1)];
			glyphsOf[g0].push(rg);
			for (let g = g0 + 1; g <= g1; g++) mergeTo[g] = mergeTo[g0];
		}
	};
	for (let g = 0; g < graphemes.length; g++) {
		const start = graphemes[g].start;
		if (isEmojiGrapheme[g]) {
			flushRun(start);
			runStart = start + graphemes[g].text.length;
			continue;
		}
		if (start > runStart) {
			const prev = start - 1;
			if (
				styleAt[start].font !== styleAt[prev].font ||
				styleAt[start].fontSize !== styleAt[prev].fontSize ||
				levelAt(start) !== levelAt(prev)
			) {
				flushRun(start);
				runStart = start;
			}
		}
	}
	flushRun(text.length);

	// Build clusters from (merged) graphemes.
	const clusters: ShapedCluster<S>[] = [];
	for (let g = 0; g < graphemes.length; ) {
		let end = g + 1;
		while (end < graphemes.length && mergeTo[end] === g) end++;
		const start = graphemes[g].start;
		const stop = end < graphemes.length ? graphemes[end].start : text.length;
		const clusterText = text.slice(start, stop);
		const style = styleAt[start];
		const level = levelAt(start);
		const rtl = (level & 1) === 1;
		const scale = style.fontSize / style.font.unitsPerEm;
		const isEmoji = isEmojiGrapheme[g];
		const isSpace = SPACE_REGEX.test(clusterText);
		if (isIgnorableOnly(clusterText)) {
			// A stray joiner or variation selector: nothing to draw or count.
			g = end;
			continue;
		}

		const logical: RunGlyph[] = [];
		for (let k = g; k < end; k++) logical.push(...glyphsOf[k]);
		const visual = rtl ? logical.slice().reverse() : logical;

		const spacing = CURSIVE_REGEX.test(clusterText) ? 0 : style.letterSpacing;
		let glyphAdvance = 0;
		const glyphs: ShapedGlyph[] = [];
		if (isEmoji) {
			glyphAdvance = style.fontSize;
		} else {
			const lead = rtl ? spacing : 0;
			for (const rg of visual) {
				glyphs.push({
					cp: rg.cp,
					dx: lead + glyphAdvance + rg.xOffset * scale,
					dy: -rg.yOffset * scale,
				});
				glyphAdvance += rg.xAdvance * scale;
			}
		}
		const inkStart = rtl ? spacing : 0;
		clusters.push({
			text: clusterText,
			start,
			style,
			isSpace,
			isEmoji,
			level,
			glyphs,
			advance: glyphAdvance + spacing,
			spacing,
			inkStart,
			inkEnd: inkStart + glyphAdvance,
		});
		g = end;
	}

	return { clusters, baseLevel };
}

// ── Shaping straight from a fontkit font ─────────────────────────────────

/** Glyph-only stand-ins for fontkit fonts that are shaped but never drawn by Slug. */
const viewSources = new WeakMap<SlugFont, FontkitFont>();
const fontViews = new WeakMap<FontkitFont, SlugFont>();

/** A glyph map that makes a metrics-only record for any glyph id asked for. */
class GlyphRecordMap extends Map<number, SlugCodePoint> {
	constructor(private readonly source: FontkitFont) {
		super();
	}
	override get(id: number): SlugCodePoint | undefined {
		let record = super.get(id);
		if (!record) {
			let advanceWidth = 0;
			try {
				advanceWidth = this.source.getGlyph?.(id)?.advanceWidth ?? 0;
			} catch {
				advanceWidth = 0;
			}
			record = {
				codePoint: -2,
				glyphId: id,
				width: 0,
				height: 0,
				advanceWidth,
				bearingX: 0,
				bearingY: 0,
				bandCount: 0,
				bandDimX: 0,
				bandDimY: 0,
				bandsTexCoordX: 0,
				bandsTexCoordY: 0,
			};
			super.set(id, record);
		}
		return record;
	}
	override has(id: number): boolean {
		return this.get(id) !== undefined;
	}
}

function fontView(source: FontkitFont): SlugFont {
	let view = fontViews.get(source);
	if (!view) {
		const glyphs = new GlyphRecordMap(source);
		view = {
			codePoints: new Map([[-1, glyphs.get(0) as SlugCodePoint]]),
			glyphs,
			curvesTex: null as unknown as GPUTexture,
			bandsTex: null as unknown as GPUTexture,
			ascender: source.ascent || 0,
			descender: source.descent || 0,
			lineGap: source.lineGap || 0,
			unitsPerEm: source.unitsPerEm || 1000,
		};
		fontViews.set(source, view);
		viewSources.set(view, source);
	}
	return view;
}

export interface PositionedGlyph {
	glyphId: number;
	/** Pen position, font units from the line's left edge. */
	x: number;
	/** Baseline offset, font units, positive up. */
	y: number;
}

/**
 * Shapes and orders one line of text set straight from a fontkit font (for
 * geometry built from outlines, such as extruded 3D text). Positions are in
 * font units, left to right; `letterSpacing` is in font units too.
 */
export function shapeLineFromFont(
	source: FontkitFont,
	text: string,
	options: ShapeOptions & { letterSpacing?: number } = {},
): { glyphs: PositionedGlyph[]; width: number; baseLevel: number } {
	const font = fontView(source);
	const letterSpacing = options.letterSpacing ?? 0;
	const p = shapeParagraph(
		[{ text, style: { font, fontSize: font.unitsPerEm, letterSpacing } }],
		{
			direction: options.direction,
			ligatures: options.ligatures ?? letterSpacing === 0,
			emoji: false,
		},
	);
	const line = placeLine(p.clusters, p.baseLevel);
	const glyphs: PositionedGlyph[] = [];
	let width = 0;
	for (const { cluster, x } of line.clusters) {
		width = x + cluster.advance;
		for (const g of cluster.glyphs) {
			if (g.cp.glyphId === undefined) continue;
			glyphs.push({ glyphId: g.cp.glyphId, x: x + g.dx, y: -g.dy });
		}
	}
	return { glyphs, width, baseLevel: p.baseLevel };
}

// ── Lines ────────────────────────────────────────────────────────────────

/**
 * Greedy word wrap over one paragraph's clusters in logical order: breaks
 * only between whitespace and non-whitespace runs and never splits a word.
 * Whitespace a wrap leaves at the start of a line is dropped; the paragraph's
 * own leading whitespace (an indent) is kept.
 */
export function breakLines<S extends ShapeStyle>(
	clusters: ShapedCluster<S>[],
	maxWidth: number,
): ShapedCluster<S>[][] {
	const lines: ShapedCluster<S>[][] = [];
	let line: ShapedCluster<S>[] = [];
	let lineWidth = 0;

	let i = 0;
	while (i < clusters.length) {
		const isSpace = clusters[i].isSpace;
		let j = i;
		let tokenWidth = 0;
		while (j < clusters.length && clusters[j].isSpace === isSpace) {
			tokenWidth += clusters[j].advance;
			j++;
		}
		const token = clusters.slice(i, j);
		i = j;

		if (isSpace) {
			if (line.length === 0 && lines.length > 0) continue;
			line.push(...token);
			lineWidth += tokenWidth;
			continue;
		}
		const trailing = token[token.length - 1].spacing;
		const visualWidth = trailing > 0 ? tokenWidth - trailing : tokenWidth;
		if (lineWidth > 0 && lineWidth + visualWidth > maxWidth) {
			lines.push(line);
			line = [];
			lineWidth = 0;
		}
		line.push(...token);
		lineWidth += tokenWidth;
	}
	lines.push(line);
	return lines;
}

export interface PlacedCluster<S extends ShapeStyle = ShapeStyle> {
	cluster: ShapedCluster<S>;
	/** Left edge of the cluster on the line, px. */
	x: number;
}

export interface PlacedLine<S extends ShapeStyle = ShapeStyle> {
	/** Clusters left to right. */
	clusters: PlacedCluster<S>[];
	/** Visible extent of the line (whitespace and outer letter spacing excluded). */
	inkLeft: number;
	inkRight: number;
	/** The paragraph's indent (its leading whitespace), on the side it reads from. */
	indentLeft: number;
	indentRight: number;
}

/**
 * Orders one line's clusters for display (UAX #9 L1–L2) and lays them out
 * left to right from x = 0.
 */
export function placeLine<S extends ShapeStyle>(
	line: ShapedCluster<S>[],
	baseLevel: number,
): PlacedLine<S> {
	const n = line.length;
	const levels = new Array<number>(n);
	let maxLevel = 0;
	let minOdd = Number.POSITIVE_INFINITY;
	// L1: whitespace at the end of the line takes the paragraph level.
	let trailing = n;
	while (trailing > 0 && line[trailing - 1].isSpace) trailing--;
	for (let i = 0; i < n; i++) {
		const level = i >= trailing ? baseLevel : line[i].level;
		levels[i] = level;
		if (level > maxLevel) maxLevel = level;
		if (level & 1 && level < minOdd) minOdd = level;
	}

	const order = Array.from({ length: n }, (_, i) => i);
	// L2: from the highest level down to the lowest odd one, reverse every run at or above it.
	for (let level = maxLevel; level >= minOdd && level > 0; level--) {
		let i = 0;
		while (i < n) {
			if (levels[order[i]] < level) {
				i++;
				continue;
			}
			let j = i;
			while (j < n && levels[order[j]] >= level) j++;
			const slice = order.slice(i, j).reverse();
			for (let k = 0; k < slice.length; k++) order[i + k] = slice[k];
			i = j;
		}
	}

	const clusters: PlacedCluster<S>[] = [];
	let x = 0;
	let inkLeft = Number.POSITIVE_INFINITY;
	let inkRight = Number.NEGATIVE_INFINITY;
	for (const idx of order) {
		const c = line[idx];
		clusters.push({ cluster: c, x });
		if (!c.isSpace) {
			inkLeft = Math.min(inkLeft, x + c.inkStart);
			inkRight = Math.max(inkRight, x + c.inkEnd);
		}
		x += c.advance;
	}
	if (inkLeft > inkRight) {
		inkLeft = 0;
		inkRight = 0;
	}
	// Leading whitespace (kept only on a paragraph's first line) is an indent:
	// alignment keeps it, on the left for LTR paragraphs, the right for RTL.
	let indent = 0;
	for (let i = 0; i < n && line[i].isSpace; i++) indent += line[i].advance;
	const rtl = (baseLevel & 1) === 1;
	return {
		clusters,
		inkLeft,
		inkRight,
		indentLeft: rtl ? 0 : indent,
		indentRight: rtl ? indent : 0,
	};
}

/** Resolves `start`/`end` against a paragraph's direction. */
export function resolveAlign(
	align: "left" | "center" | "right" | "start" | "end",
	baseLevel: number,
): "left" | "center" | "right" {
	const rtl = (baseLevel & 1) === 1;
	if (align === "start") return rtl ? "right" : "left";
	if (align === "end") return rtl ? "left" : "right";
	return align;
}

/** Offset that aligns a placed line inside `width`. */
export function alignOffset(
	line: PlacedLine,
	align: "left" | "center" | "right",
	width: number,
): number {
	const left = line.inkLeft - line.indentLeft;
	const right = line.inkRight + line.indentRight;
	if (align === "center") {
		return (width - (right - left)) / 2 - left;
	}
	if (align === "right") return width - right;
	return -left;
}
