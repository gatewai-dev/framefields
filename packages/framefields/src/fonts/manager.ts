import fs from "node:fs/promises";
import path from "node:path";
import {
	registerHeadlessFont,
	SlugFontCache,
	SlugGeometry,
	setRegisteredFontSource,
} from "@framefields/webgpu-renderers";
import * as fontkit from "fontkit";

export interface RegisterFontOptions {
	family?: string;
	source: string | Uint8Array;
	weight?: number | string;
	style?: "normal" | "italic" | "oblique";
}

export interface RegisteredFont {
	family: string;
	source: string | Uint8Array;
	filePath?: string;
	format: "truetype" | "opentype";
	postscriptName?: string;
	unitsPerEm?: number;
	weight?: number | string;
	style?: string;
}

interface ResolvedSource {
	buffer: Uint8Array;
	filePath?: string;
}

const SFNT_TRUETYPE_1 = 0x00010000;
const SFNT_TRUETYPE_TRUE = 0x74727565; // 'true'
const SFNT_TRUETYPE_TYP1 = 0x74797031; // 'typ1'
const SFNT_OPENTYPE_CFF = 0x4f54544f; // 'OTTO'
const SFNT_COLLECTION = 0x74746366; // 'ttcf'

function validateFontBinaryHeader(
	bytes: Uint8Array,
	sourceLabel: string,
): "truetype" | "opentype" {
	if (bytes.length < 12) {
		throw new Error(
			`Invalid font binary for "${sourceLabel}": File size (${bytes.length} bytes) is too small to be a valid TrueType or OpenType font.`,
		);
	}

	const tag =
		((bytes[0] ?? 0) << 24) |
		((bytes[1] ?? 0) << 16) |
		((bytes[2] ?? 0) << 8) |
		(bytes[3] ?? 0);

	if (
		tag === SFNT_TRUETYPE_1 ||
		tag === SFNT_TRUETYPE_TRUE ||
		tag === SFNT_TRUETYPE_TYP1 ||
		tag === SFNT_COLLECTION
	) {
		return "truetype";
	}

	if (tag === SFNT_OPENTYPE_CFF) {
		return "opentype";
	}

	const hexTag = (tag >>> 0).toString(16).padStart(8, "0");
	throw new Error(
		`Invalid font format for "${sourceLabel}": Expected a valid TrueType (.ttf) or OpenType (.otf) font binary. Found header tag: 0x${hexTag}.`,
	);
}

async function resolveSourceBuffer(
	source: string | Uint8Array,
): Promise<ResolvedSource> {
	if (source instanceof Uint8Array) {
		return { buffer: source };
	}

	if (typeof source !== "string") {
		throw new TypeError(
			`Font source must be a file path string or Uint8Array, received: ${typeof source}`,
		);
	}

	let cleanPath = source;
	if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
		const res = await fetch(cleanPath);
		if (!res.ok) {
			throw new Error(
				`Failed to download font from "${cleanPath}": HTTP ${res.status} ${res.statusText}`,
			);
		}
		const arrayBuffer = await res.arrayBuffer();
		return {
			buffer: new Uint8Array(arrayBuffer),
			filePath: cleanPath,
		};
	}

	if (cleanPath.startsWith("file://")) {
		try {
			cleanPath = new URL(cleanPath).pathname;
		} catch {
			cleanPath = cleanPath.replace(/^file:\/\//, "");
		}
	}

	const candidates: string[] = [
		cleanPath,
		path.resolve(process.cwd(), cleanPath),
		path.resolve(process.cwd(), "assets/fonts", cleanPath),
		path.resolve(process.cwd(), "assets/fonts", path.basename(cleanPath)),
	];

	// Upward traversal to locate fonts in parent monorepo roots
	let currentDir = process.cwd();
	for (let i = 0; i < 5; i++) {
		candidates.push(path.resolve(currentDir, cleanPath));
		candidates.push(
			path.resolve(currentDir, "assets/fonts", path.basename(cleanPath)),
		);
		const parent = path.dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
	}

	let resolvedPath: string | null = null;
	let fileBuffer: Buffer | null = null;

	for (const candidate of candidates) {
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile()) {
				resolvedPath = candidate;
				fileBuffer = await fs.readFile(candidate);
				break;
			}
		} catch {
			// Continue searching next candidate
		}
	}

	if (!resolvedPath || !fileBuffer) {
		throw new Error(
			`Font file not found: "${source}". Checked candidate locations:\n  - ${candidates.join("\n  - ")}`,
		);
	}

	return {
		buffer: new Uint8Array(
			fileBuffer.buffer,
			fileBuffer.byteOffset,
			fileBuffer.byteLength,
		),
		filePath: resolvedPath,
	};
}

/**
 * Central singleton manager for font registration, TTF validation, and compositor typography binding.
 */
export interface MeasureTextOptions {
	fontFamily: string;
	fontSize?: number;
	fontWeight?: string | number;
	/** Extra px between characters, as on `Layer.text`. */
	letterSpacing?: number;
	/** Multiplier of fontSize when < 10, else px. Default 1.2. */
	lineHeight?: number;
	/** Wrap width in px; omit for one line per `\n`. */
	width?: number;
	align?: "left" | "center" | "right";
	/** Paragraph base direction, as on `Layer.text`. Default "auto". */
	direction?: "ltr" | "rtl" | "auto";
}

export interface MeasuredGlyph {
	char: string;
	/** Index into the string (code units), matching `text.slice`. */
	index: number;
	/** Left edge of the glyph, relative to the text box. */
	x: number;
	/** Baseline-relative top of the line box. */
	y: number;
	/** Advance width in px. */
	width: number;
	line: number;
	/** Part of a right-to-left run: reading continues to the left. */
	rtl?: boolean;
}

export interface TextMetrics {
	width: number;
	height: number;
	lines: number;
	/** Line box height in px. */
	lineHeight: number;
	glyphs: MeasuredGlyph[];
	/**
	 * X of a caret placed after `count` characters (0 = before the first),
	 * relative to the text box. In right-to-left text the caret sits on the
	 * left of the last character. Pair with a `.keys("text", …)` reveal to make
	 * a cursor follow typing exactly.
	 */
	caretX(count: number): number;
	/** Width of the first `count` characters (same as `caretX` on one line). */
	widthOf(count: number): number;
}

export class FontManager {
	private static instance: FontManager | null = null;
	private readonly fonts = new Map<string, RegisteredFont>();

	private constructor() {}

	/**
	 * Returns the singleton FontManager instance.
	 */
	public static getInstance(): FontManager {
		if (!FontManager.instance) {
			FontManager.instance = new FontManager();
		}
		return FontManager.instance;
	}

	/**
	 * Registers a TrueType/OpenType font into the Framefields engine with validation.
	 */
	public static async register(
		optionsOrFamilyOrSource: RegisterFontOptions | string,
		source?: string | Uint8Array,
	): Promise<RegisteredFont> {
		return FontManager.getInstance().register(optionsOrFamilyOrSource, source);
	}

	/**
	 * Sets the color emoji font text draws emoji with, for the preview and the
	 * export alike: a CBDT/CBLC bitmap font such as Noto Color Emoji, as a file
	 * path, URL or bytes. framefields ships none; without one, exports draw
	 * nothing for emoji.
	 */
	public static async registerEmojiFont(
		source: string | Uint8Array,
	): Promise<void> {
		const { buffer, filePath } = await resolveSourceBuffer(source);
		const label =
			filePath ?? (typeof source === "string" ? source : "Uint8Array");
		validateFontBinaryHeader(buffer, label);
		SlugFontCache.setEmojiFont(buffer, filePath);
	}

	/**
	 * Measures text with the real font, exactly as `Layer.text` lays it out:
	 * box size, line count, per-glyph positions and caret offsets. Use it to
	 * size containers, place cursors, underline a word or center by ink
	 * instead of guessing advances. The family must be registered first.
	 *
	 * ```ts
	 * const m = FontManager.measure("Hello", { fontFamily: "Inter", fontSize: 60 });
	 * m.width; m.caretX(3); m.glyphs[1].x
	 * ```
	 */
	public static measure(
		text: string,
		options: MeasureTextOptions,
	): TextMetrics {
		const fontSize = options.fontSize ?? 48;
		const font = SlugFontCache.getFont(
			options.fontFamily,
			options.fontWeight,
			null,
			undefined,
			fontSize,
		);
		if (!font) {
			throw new Error(
				`FontManager.measure: font "${options.fontFamily}" is not registered. ` +
					"Call `await FontManager.register(...)` first.",
			);
		}
		const lineHeight =
			options.lineHeight !== undefined && options.lineHeight < 10
				? options.lineHeight * fontSize
				: (options.lineHeight ?? fontSize * 1.2);
		const letterSpacing = options.letterSpacing ?? 0;
		const { width, height, layout } = SlugGeometry.measure(
			text,
			font,
			fontSize,
			letterSpacing,
			lineHeight,
			options.width,
			undefined,
			options.direction,
		);
		const scale = fontSize / font.unitsPerEm;
		// One entry per cluster (a letter with its marks, or a ligature), in
		// reading order; textIndex maps it back to the string.
		const glyphs: MeasuredGlyph[] = [];
		const seen = new Set<number>();
		let cursor = 0;
		for (const g of layout.glyphs) {
			let index = g.textIndex;
			if (index === undefined) {
				const at = text.indexOf(g.char, cursor);
				index = at >= 0 ? at : cursor;
			}
			if (seen.has(index)) continue;
			seen.add(index);
			cursor = index + g.char.length;
			const advance =
				g.clusterAdvance ?? g.cp.advanceWidth * (g.fontScale ?? scale);
			glyphs.push({
				char: g.char,
				index,
				x: g.clusterX ?? g.x,
				y: g.y,
				width: advance + letterSpacing,
				line: g.lineIndex,
				...(g.rtl && { rtl: true }),
			});
		}
		const caretX = (count: number): number => {
			if (count <= 0 || glyphs.length === 0) {
				const first = glyphs[0];
				if (!first) return 0;
				return first.rtl ? first.x + first.width - letterSpacing : first.x;
			}
			const before = glyphs.filter((g) => g.index < count);
			const last = before[before.length - 1];
			if (!last) return 0;
			return last.rtl ? last.x : last.x + last.width - letterSpacing;
		};
		return {
			width,
			height,
			lines: layout.linesCount,
			lineHeight,
			glyphs,
			caretX,
			widthOf: (count: number) => caretX(count) - (glyphs[0]?.x ?? 0),
		};
	}

	/**
	 * Retrieves registered font metadata by family name.
	 */
	public static get(family: string): RegisteredFont | undefined {
		return FontManager.getInstance().get(family);
	}

	/**
	 * Checks if a font family has been registered.
	 */
	public static has(family: string): boolean {
		return FontManager.getInstance().has(family);
	}

	/**
	 * Returns all currently registered fonts.
	 */
	public static getAll(): RegisteredFont[] {
		return FontManager.getInstance().getAll();
	}

	/**
	 * Returns relative or absolute file paths of all registered fonts for composition spec serialization.
	 */
	public static getRegisteredFontPaths(): string[] {
		return FontManager.getInstance().getRegisteredFontPaths();
	}

	/**
	 * Clears all registered fonts from the manager.
	 */
	public static clear(): void {
		FontManager.getInstance().clear();
	}

	/**
	 * Instance registration method with format validation and Slug WebGPU cache population.
	 */
	public async register(
		optionsOrFamilyOrSource: RegisterFontOptions | string,
		source?: string | Uint8Array,
	): Promise<RegisteredFont> {
		let family: string | undefined;
		let rawSource: string | Uint8Array;
		let weight: number | string | undefined;
		let style: "normal" | "italic" | "oblique" | undefined;

		if (
			typeof optionsOrFamilyOrSource === "object" &&
			optionsOrFamilyOrSource !== null
		) {
			family = optionsOrFamilyOrSource.family;
			rawSource = optionsOrFamilyOrSource.source;
			weight = optionsOrFamilyOrSource.weight;
			style = optionsOrFamilyOrSource.style;
		} else if (
			typeof optionsOrFamilyOrSource === "string" &&
			source !== undefined
		) {
			family = optionsOrFamilyOrSource;
			rawSource = source;
		} else if (typeof optionsOrFamilyOrSource === "string") {
			family = undefined;
			rawSource = optionsOrFamilyOrSource;
		} else {
			throw new TypeError("Invalid arguments passed to FontManager.register");
		}

		const { buffer, filePath } = await resolveSourceBuffer(rawSource);
		const sourceLabel =
			filePath ?? (typeof rawSource === "string" ? rawSource : "Uint8Array");
		const format = validateFontBinaryHeader(buffer, sourceLabel);

		let parsedFontkit: fontkit.Font;
		try {
			const parsed = fontkit.create(buffer as unknown as Buffer);
			if (
				parsed &&
				"fonts" in parsed &&
				Array.isArray(parsed.fonts) &&
				parsed.fonts.length > 0
			) {
				parsedFontkit = parsed.fonts[0] as fontkit.Font;
			} else {
				parsedFontkit = parsed as fontkit.Font;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Failed to parse TrueType/OpenType font binary for "${sourceLabel}": ${msg}`,
			);
		}

		const detectedFamily =
			parsedFontkit.familyName ||
			parsedFontkit.postscriptName ||
			path.parse(sourceLabel).name;
		const resolvedFamily = family?.trim() || detectedFamily;

		const registered: RegisteredFont = {
			family: resolvedFamily,
			source: rawSource,
			filePath,
			format,
			postscriptName: parsedFontkit.postscriptName,
			unitsPerEm: parsedFontkit.unitsPerEm,
			weight,
			style,
		};

		this.fonts.set(resolvedFamily, registered);

		setRegisteredFontSource(resolvedFamily, filePath ?? rawSource);
		// Populate headless font registries
		if (filePath) {
			await registerHeadlessFont(resolvedFamily, filePath);
		}
		SlugFontCache.setParsed(resolvedFamily, parsedFontkit);

		return registered;
	}

	public get(family: string): RegisteredFont | undefined {
		return this.fonts.get(family);
	}

	public has(family: string): boolean {
		return this.fonts.has(family);
	}

	public getAll(): RegisteredFont[] {
		return Array.from(this.fonts.values());
	}

	public getRegisteredFontPaths(): string[] {
		const paths: string[] = [];
		for (const font of this.fonts.values()) {
			if (font.filePath) {
				paths.push(font.filePath);
			} else if (typeof font.source === "string") {
				paths.push(font.source);
			}
		}
		return paths;
	}

	public clear(): void {
		this.fonts.clear();
	}
}
