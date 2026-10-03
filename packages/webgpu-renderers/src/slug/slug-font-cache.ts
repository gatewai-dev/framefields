import * as fontkit from "fontkit";
import type { FontkitFont } from "./slug-generator.js";
import { SlugGenerator } from "./slug-generator.js";
import type { SlugFont } from "./slug-loader.js";

/** Per-font load timings are debug output: shown only with LOG_LEVEL=debug or trace. */
const VERBOSE_FONT_LOGS =
	typeof process !== "undefined" &&
	/^(debug|trace)$/i.test(process.env?.LOG_LEVEL ?? "");

export type FontLoadListener = (fontFamily: string) => void;

export function parseFontWeight(fontWeight?: string | number): number {
	if (!fontWeight) return 400;
	if (fontWeight === "bold") return 700;
	if (fontWeight === "normal") return 400;
	if (typeof fontWeight === "number") return fontWeight;
	const parsed = parseInt(fontWeight, 10);
	return isNaN(parsed) ? 400 : parsed;
}

export function getFontCacheKey(
	fontFamily: string,
	fontWeight?: string | number,
	strokeWidth?: number,
	axes?: Record<string, number>,
): string {
	const weight = parseFontWeight(fontWeight);
	const suffix = strokeWidth ? `-stroke-${strokeWidth}` : "";
	const axesSuffix =
		axes && Object.keys(axes).length > 0
			? `-axes-${Object.entries(axes)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, v]) => `${k}_${v}`)
					.join("_")}`
			: "";
	return `${fontFamily}-${weight}${suffix}${axesSuffix}`;
}

/**
 * fontkit.create() accepts a Buffer at the type level, but works fine at
 * runtime with a plain Uint8Array (this keeps things portable between
 * Node.js and the browser, where a real `Buffer` may not exist). It can
 * also return a `FontCollection` for multi-font files (e.g. .ttc) instead
 * of a single `Font` — in that case we grab the first font in the
 * collection. Both quirks are isolated here at the fontkit boundary.
 */
function parseFontBuffer(bytes: Uint8Array): FontkitFont {
	const parsed = fontkit.create(bytes as unknown as Buffer);
	let font: FontkitFont;
	if (
		parsed &&
		typeof (parsed as unknown as { fonts?: FontkitFont[] }).fonts !==
			"undefined" &&
		Array.isArray((parsed as unknown as { fonts?: FontkitFont[] }).fonts) &&
		((parsed as unknown as { fonts: FontkitFont[] }).fonts.length ?? 0) > 0
	) {
		font = (parsed as unknown as { fonts: FontkitFont[] }).fonts[0];
	} else if (
		parsed &&
		typeof (parsed as unknown as { getFont?: unknown }).getFont ===
			"function" &&
		typeof (parsed as unknown as { getGlyph?: unknown }).getGlyph !== "function"
	) {
		font =
			(parsed as unknown as { fonts?: FontkitFont[] }).fonts?.[0] ||
			(parsed as unknown as FontkitFont);
	} else {
		font = parsed as unknown as FontkitFont;
	}
	return font;
}

function recreateTextures(device: GPUDevice, slugFont: SlugFont): void {
	if (slugFont.curvesTex) return;
	const raw = (slugFont as any)._raw;
	if (!raw) return;

	const TEXTURE_WIDTH = 4096;
	const curvesTexels = Math.ceil(raw.curvesList.length / 4);
	const curvesTexHeight = Math.max(1, Math.ceil(curvesTexels / TEXTURE_WIDTH));

	const curvesFloatArray = new Float32Array(
		TEXTURE_WIDTH * curvesTexHeight * 4,
	);
	curvesFloatArray.fill(-1.0);
	curvesFloatArray.set(raw.curvesList);

	slugFont.curvesTex = device.createTexture({
		label: "SlugGeneratedCurvesTexture",
		size: [TEXTURE_WIDTH, curvesTexHeight],
		format: "rgba32float",
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture(
		{ texture: slugFont.curvesTex },
		curvesFloatArray,
		{ bytesPerRow: TEXTURE_WIDTH * 16 },
		[TEXTURE_WIDTH, curvesTexHeight],
	);

	const bandsTexels =
		Math.floor(raw.bandOffsets.length / 2) +
		Math.floor(raw.curveOffsets.length / 2);
	const bandsTexHeight = Math.max(1, Math.ceil(bandsTexels / TEXTURE_WIDTH));

	const bandsUintArray = new Uint32Array(TEXTURE_WIDTH * bandsTexHeight * 2);
	bandsUintArray.set(raw.bandOffsets, 0);
	bandsUintArray.set(raw.curveOffsets, raw.bandOffsets.length);

	slugFont.bandsTex = device.createTexture({
		label: "SlugGeneratedBandsTexture",
		size: [TEXTURE_WIDTH, bandsTexHeight],
		format: "rg32uint",
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture(
		{ texture: slugFont.bandsTex },
		bandsUintArray,
		{ bytesPerRow: TEXTURE_WIDTH * 8 },
		[TEXTURE_WIDTH, bandsTexHeight],
	);
}

const GLOBAL_CACHE_KEY = Symbol.for("gatewai.slugFontCache.cache");
const GLOBAL_PARSED_KEY = Symbol.for("gatewai.slugFontCache.parsed");
const GLOBAL_PROMISES_KEY = Symbol.for("gatewai.slugFontCache.promises");
const GLOBAL_FAILED_KEY = Symbol.for("gatewai.slugFontCache.failed");

const g = globalThis as any;
g[GLOBAL_CACHE_KEY] = g[GLOBAL_CACHE_KEY] || new Map();
g[GLOBAL_PARSED_KEY] = g[GLOBAL_PARSED_KEY] || new Map();
g[GLOBAL_PROMISES_KEY] = g[GLOBAL_PROMISES_KEY] || new Map();
g[GLOBAL_FAILED_KEY] = g[GLOBAL_FAILED_KEY] || new Map();

export class SlugFontCache {
	private static get cache(): Map<string, SlugFont> {
		return g[GLOBAL_CACHE_KEY];
	}
	private static get parsedFontCache(): Map<string, FontkitFont> {
		return g[GLOBAL_PARSED_KEY];
	}

	/** Register an already parsed font (e.g. by FontManager) under a family name. */
	public static setParsed(fontFamily: string, font: FontkitFont): void {
		SlugFontCache.parsedFontCache.set(fontFamily, font);
	}

	public static getParsed(fontFamily: string): FontkitFont | null {
		return SlugFontCache.parsedFontCache.get(fontFamily) || null;
	}

	public static getAllParsed(): FontkitFont[] {
		return Array.from(SlugFontCache.parsedFontCache.values());
	}

	public static getFirstParsed(): FontkitFont | null {
		const iter = SlugFontCache.parsedFontCache.values().next();
		return iter.done ? null : iter.value;
	}

	public static hasPending(): boolean {
		return SlugFontCache.loadingPromises.size > 0;
	}

	private static listeners = new Set<FontLoadListener>();
	private static get loadingPromises(): Map<string, Promise<SlugFont>> {
		return g[GLOBAL_PROMISES_KEY];
	}
	private static get failedFonts(): Map<string, number> {
		if (g[GLOBAL_FAILED_KEY] instanceof Set) {
			g[GLOBAL_FAILED_KEY] = new Map();
		}
		return g[GLOBAL_FAILED_KEY];
	}

	public static emojiFontPath: string | null = null;
	public static emojiFontUrl: string | null = null;
	public static emojiTextureCache = new Map<string, GPUTexture>();

	private static emojiFontBuffer: Uint8Array | null = null;
	private static emojiFontLoadPromise: Promise<void> | null = null;
	private static emojiFontFaceLoadPromise: Promise<void> | null = null;
	private static cmapOffset = 0;
	private static cblcOffset = 0;
	private static cbdtOffset = 0;

	/**
	 * Parse the SFNT table directory from a raw font buffer and cache
	 * the offsets for cmap, CBLC, and CBDT tables.
	 */
	private static parseTableDirectory(uint8: Uint8Array): void {
		SlugFontCache.emojiFontBuffer = uint8;
		const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
		const numTables = view.getUint16(4);
		let offset = 12;
		for (let i = 0; i < numTables; i++) {
			const tag = String.fromCharCode(
				view.getUint8(offset),
				view.getUint8(offset + 1),
				view.getUint8(offset + 2),
				view.getUint8(offset + 3),
			);
			if (tag === "cmap") {
				SlugFontCache.cmapOffset = view.getUint32(offset + 8);
			} else if (tag === "CBLC") {
				SlugFontCache.cblcOffset = view.getUint32(offset + 8);
			} else if (tag === "CBDT") {
				SlugFontCache.cbdtOffset = view.getUint32(offset + 8);
			}
			offset += 16;
		}
	}

	/**
	 * Load the emoji font binary from a local filesystem path (Node.js only)
	 * or from an HTTP URL via fetch.
	 */
	private static async loadEmojiFontBinary(): Promise<void> {
		if (SlugFontCache.emojiFontBuffer) return;
		if (SlugFontCache.emojiFontLoadPromise) {
			await SlugFontCache.emojiFontLoadPromise;
			return;
		}

		SlugFontCache.emojiFontLoadPromise = (async () => {
			try {
				const isNode =
					!!(globalThis as Record<string, unknown>).__IS_HEADLESS_RENDERER__ ||
					typeof window === "undefined" ||
					typeof globalThis.document === "undefined";

				if (isNode && SlugFontCache.emojiFontPath) {
					const fs = await import(/* webpackIgnore: true */ "fs/promises");
					const nodeBuffer = await fs.readFile(SlugFontCache.emojiFontPath);
					const uint8 = new Uint8Array(
						nodeBuffer.buffer,
						nodeBuffer.byteOffset,
						nodeBuffer.byteLength,
					);
					SlugFontCache.parseTableDirectory(uint8);
					return;
				}

				const url = SlugFontCache.emojiFontUrl;
				if (!url) {
					console.warn("[SlugFontCache] No emoji font path or URL configured.");
					return;
				}

				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(
						`Failed to fetch emoji font from ${url}: ${response.statusText}`,
					);
				}
				const arrayBuffer = await response.arrayBuffer();
				SlugFontCache.parseTableDirectory(new Uint8Array(arrayBuffer));
			} catch (err) {
				console.error("[SlugFontCache] Failed to load emoji font binary:", err);
			}
		})();

		await SlugFontCache.emojiFontLoadPromise;
	}

	public static async getEmojiPngBuffer(
		codePoint: number,
	): Promise<{ buffer: Uint8Array; width: number; height: number } | null> {
		if (!SlugFontCache.emojiFontBuffer) {
			if (SlugFontCache.emojiFontPath || SlugFontCache.emojiFontUrl) {
				await SlugFontCache.loadEmojiFontBinary();
			}
		}
		const uint8 = SlugFontCache.emojiFontBuffer;
		if (!uint8) return null;

		const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
		const cmapHead = SlugFontCache.cmapOffset;
		if (!cmapHead) return null;

		const numSubTables = view.getUint16(cmapHead + 2);
		let format12Offset = 0;
		for (let i = 0; i < numSubTables; i++) {
			const subTableRecord = cmapHead + 4 + i * 8;
			const subOffset = view.getUint32(subTableRecord + 4);
			const format = view.getUint16(cmapHead + subOffset);
			if (format === 12) {
				format12Offset = cmapHead + subOffset;
				break;
			}
		}

		if (!format12Offset) return null;
		const numGroups = view.getUint32(format12Offset + 12);
		let glyphID = 0;
		for (let g = 0; g < numGroups; g++) {
			const groupOffset = format12Offset + 16 + g * 12;
			const startCharCode = view.getUint32(groupOffset);
			const endCharCode = view.getUint32(groupOffset + 4);
			const startGlyphID = view.getUint32(groupOffset + 8);
			if (codePoint >= startCharCode && codePoint <= endCharCode) {
				glyphID = startGlyphID + (codePoint - startCharCode);
				break;
			}
		}

		if (!glyphID) return null;

		const cblcOffset = SlugFontCache.cblcOffset;
		const cbdtOffset = SlugFontCache.cbdtOffset;
		if (!cblcOffset || !cbdtOffset) return null;

		const indexSubTableArrayOffset = view.getUint32(cblcOffset + 8);
		const numberOfIndexSubTables = view.getUint32(cblcOffset + 16);
		const arrayStart = cblcOffset + indexSubTableArrayOffset;

		let foundSubtable = null;
		for (let i = 0; i < numberOfIndexSubTables; i++) {
			const entryOffset = arrayStart + i * 8;
			const firstGlyph = view.getUint16(entryOffset);
			const lastGlyph = view.getUint16(entryOffset + 2);
			const subTableOffset = view.getUint32(entryOffset + 4);

			if (glyphID >= firstGlyph && glyphID <= lastGlyph) {
				foundSubtable = {
					firstGlyph,
					lastGlyph,
					subTableOffset: indexSubTableArrayOffset + subTableOffset,
				};
				break;
			}
		}

		if (!foundSubtable) return null;

		const subTableStart = cblcOffset + foundSubtable.subTableOffset;
		const indexFormat = view.getUint16(subTableStart);
		const imageFormat = view.getUint16(subTableStart + 2);
		const imageDataOffset = view.getUint32(subTableStart + 4);

		if (indexFormat !== 1 || imageFormat !== 17) {
			return null;
		}

		const idx = glyphID - foundSubtable.firstGlyph;
		const offsetArrayStart = subTableStart + 8;
		const startOffset = view.getUint32(offsetArrayStart + idx * 4);
		const endOffset = view.getUint32(offsetArrayStart + (idx + 1) * 4);
		const length = endOffset - startOffset;
		if (length <= 0) return null;

		const absoluteGlyphOffset = cbdtOffset + imageDataOffset + startOffset;
		const height = view.getUint8(absoluteGlyphOffset);
		const width = view.getUint8(absoluteGlyphOffset + 1);
		const dataLen = view.getUint32(absoluteGlyphOffset + 5);

		const pngStart = absoluteGlyphOffset + 9;
		const pngBuffer = new Uint8Array(
			uint8.buffer,
			uint8.byteOffset + pngStart,
			dataLen,
		);
		return { buffer: pngBuffer, width, height };
	}

	public static async preloadEmoji(
		device: GPUDevice,
		char: string,
		fontSize: number,
	): Promise<GPUTexture> {
		const key = `${char}-${fontSize}`;
		let tex = SlugFontCache.emojiTextureCache.get(key);
		if (tex) return tex;

		const isNode =
			!!(globalThis as Record<string, unknown>).__IS_HEADLESS_RENDERER__ ||
			typeof window === "undefined" ||
			typeof globalThis.document === "undefined";
		if (isNode) {
			const codePoint = char.codePointAt(0);
			if (!codePoint) throw new Error("No codepoint");

			const pngInfo = await SlugFontCache.getEmojiPngBuffer(codePoint);
			if (!pngInfo) {
				throw new Error(`Emoji glyph not found in font for ${char}`);
			}

			const sharp = (await import(/* webpackIgnore: true */ "sharp")).default;

			const resolutionScale = 4.0;
			const targetSize = Math.max(
				16,
				Math.ceil(fontSize * 1.5 * resolutionScale),
			);

			const { data, info } = await sharp(Buffer.from(pngInfo.buffer))
				.ensureAlpha()
				.resize(targetSize, targetSize, {
					fit: "contain",
					background: { r: 0, g: 0, b: 0, alpha: 0 },
					kernel: "lanczos3",
				})
				.raw()
				.toBuffer({ resolveWithObject: true });

			const pixels = new Uint8Array(data.length);
			pixels.set(data);
			for (let i = 0; i < pixels.length; i += 4) {
				const alpha = pixels[i + 3];
				if (alpha < 255) {
					const f = alpha / 255;
					pixels[i] = Math.round(pixels[i] * f);
					pixels[i + 1] = Math.round(pixels[i + 1] * f);
					pixels[i + 2] = Math.round(pixels[i + 2] * f);
				}
			}

			tex = device.createTexture({
				label: `Emoji-${char}`,
				size: [info.width, info.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});

			device.queue.writeTexture(
				{ texture: tex },
				pixels,
				{ bytesPerRow: info.width * 4 },
				[info.width, info.height],
			);
		} else {
			const resolutionScale = 4.0;
			const emojiSize = Math.max(
				16,
				Math.ceil(fontSize * 1.5 * resolutionScale),
			);
			const size = Math.ceil(emojiSize / 4) * 4;

			const canvas = new OffscreenCanvas(size, size);
			const c2d = canvas.getContext("2d");
			if (c2d) {
				c2d.font = `${fontSize * resolutionScale}px "NotoColorEmoji", "Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
				c2d.textBaseline = "middle";
				c2d.textAlign = "center";
				c2d.fillText(char, size / 2, size / 2);
			}

			tex = device.createTexture({
				label: `Emoji-${char}`,
				size: [size, size],
				format: "rgba8unorm",
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT,
			});

			device.queue.copyExternalImageToTexture(
				{ source: canvas },
				{ texture: tex, premultipliedAlpha: true },
				[size, size],
			);
		}

		SlugFontCache.emojiTextureCache.set(key, tex);
		return tex;
	}

	static getFont(
		fontFamily: string,
		fontWeight?: string | number,
		device?: GPUDevice | null,
		strokeWidth?: number,
		fontSize?: number,
		variableAxes?: Record<string, number>,
	): SlugFont | undefined {
		const effectiveAxes: Record<string, number> = { ...(variableAxes ?? {}) };
		const rawFont = SlugFontCache.parsedFontCache.get(fontFamily);
		if (
			rawFont?.variationAxes &&
			"opsz" in rawFont.variationAxes &&
			fontSize !== undefined &&
			effectiveAxes.opsz === undefined
		) {
			const axis = (
				rawFont.variationAxes as Record<string, { min?: number; max?: number }>
			).opsz;
			const minOpsz = axis?.min ?? 14;
			const maxOpsz = axis?.max ?? 32;
			effectiveAxes.opsz = Math.min(maxOpsz, Math.max(minOpsz, fontSize));
		}

		const cacheKey = getFontCacheKey(
			fontFamily,
			fontWeight,
			strokeWidth,
			effectiveAxes,
		);
		const cached = SlugFontCache.cache.get(cacheKey);
		if (cached) {
			if (device) {
				recreateTextures(device, cached);
			}
			return cached;
		}

		if (rawFont) {
			const weight = parseFontWeight(fontWeight);
			let variationFont = rawFont;
			let hasTrueWeight = false;
			if (
				rawFont.variationAxes &&
				Object.keys(rawFont.variationAxes).length > 0
			) {
				try {
					if (typeof rawFont.getVariation === "function") {
						const variationParams = { wght: weight, ...effectiveAxes };
						const vFont = rawFont.getVariation(variationParams);
						if (
							vFont &&
							(typeof vFont.getGlyph === "function" ||
								typeof vFont.glyphForCodePoint === "function")
						) {
							variationFont = vFont;
							hasTrueWeight = true;
						}
					}
				} catch (e) {
					console.warn(
						`[SlugFontCache] Failed to get variation for ${fontFamily} with weight ${weight}:`,
						e,
					);
				}
			}
			if (
				variationFont &&
				(typeof variationFont.getGlyph === "function" ||
					typeof variationFont.glyphForCodePoint === "function")
			) {
				try {
					const generator = new SlugGenerator({
						fullRange: false,
						strokeWidth: strokeWidth,
					});
					const generated = generator.generate(device ?? null, variationFont);
					generated.hasTrueWeight = hasTrueWeight;
					generated.weight = weight;
					generated.fontFamily = fontFamily;
					SlugFontCache.cache.set(cacheKey, generated);
					return generated;
				} catch (e) {
					console.warn(
						`[SlugFontCache] Failed to generate variation font for ${fontFamily}:`,
						e,
					);
				}
			}
		}

		const baseFont = SlugFontCache.cache.get(fontFamily);
		if (baseFont) {
			baseFont.fontFamily = fontFamily;
			if (device) {
				recreateTextures(device, baseFont);
			}
		}
		return baseFont;
	}

	static registerFont(fontFamily: string, font: SlugFont): void {
		font.fontFamily = fontFamily;
		SlugFontCache.cache.set(fontFamily, font);
	}

	public static ensureTextures(device: GPUDevice, font: SlugFont): void {
		recreateTextures(device, font);
	}

	static addListener(listener: FontLoadListener): () => void {
		SlugFontCache.listeners.add(listener);
		return () => {
			SlugFontCache.listeners.delete(listener);
		};
	}

	static isFailed(fontFamily: string): boolean {
		const failedAt = SlugFontCache.failedFonts.get(fontFamily);
		if (!failedAt) return false;
		if (Date.now() - failedAt > 5000) {
			SlugFontCache.failedFonts.delete(fontFamily);
			return false;
		}
		return true;
	}

	static clearFailed(fontFamily?: string): void {
		if (fontFamily) {
			SlugFontCache.failedFonts.delete(fontFamily);
		} else {
			SlugFontCache.failedFonts.clear();
		}
	}

	static async preloadSlugFont(
		device: GPUDevice | null,
		fontFamily: string,
		fontUrl: string,
		whitelist?: number[],
		renderId?: string,
	): Promise<SlugFont> {
		if (SlugFontCache.isFailed(fontFamily)) {
			throw new Error(`Font "${fontFamily}" recently failed to load.`);
		}
		let slugFont: SlugFont;
		const cached = SlugFontCache.cache.get(fontFamily);

		let delayHandle: any = null;
		if (typeof window !== "undefined") {
			const win = window as any;
			win.renderer_delayRenderHandles = win.renderer_delayRenderHandles || [];
			if (renderId) {
				delayHandle = `${renderId}-font-${Math.random()}`;
			} else {
				delayHandle = Math.random();
			}
			win.renderer_delayRenderHandles.push(delayHandle);
		}

		try {
			if (cached) {
				slugFont = cached;
			} else {
				let activePromise = SlugFontCache.loadingPromises.get(fontFamily);
				if (activePromise) {
					slugFont = await activePromise;
				} else {
					activePromise = (async () => {
						try {
							let buffer: ArrayBuffer;
							const isNode =
								!!(globalThis as Record<string, unknown>)
									.__IS_HEADLESS_RENDERER__ ||
								typeof window === "undefined" ||
								typeof globalThis.document === "undefined";
							const isHttp =
								fontUrl.startsWith("http://") || fontUrl.startsWith("https://");

							if (isNode && !isHttp) {
								// Node.js local file environment
								const fs = await import(
									/* webpackIgnore: true */ "fs/promises"
								);
								const path = await import(/* webpackIgnore: true */ "path");
								const candidates: string[] = [];
								if (fontUrl && !fontUrl.startsWith("//api/")) {
									let fontPath = fontUrl;
									if (fontUrl.startsWith("file://")) {
										try {
											fontPath = new URL(fontUrl).pathname;
										} catch {
											fontPath = fontUrl.replace(/^file:\/\//, "");
										}
									}
									candidates.push(fontPath);
									candidates.push(path.resolve(process.cwd(), fontPath));
								}
								const cleanFamily = fontFamily.replace(/['"]/g, "").trim();
								const variations = [
									cleanFamily,
									cleanFamily.replace(/ /g, ""),
									cleanFamily.replace(/ /g, "_"),
								];
								for (const v of variations) {
									candidates.push(
										path.resolve(process.cwd(), "assets/fonts", v + ".ttf"),
									);
									candidates.push(
										path.resolve(process.cwd(), "assets/fonts", v + ".otf"),
									);
									candidates.push(
										`/Users/okanaslankan/gitframes/assets/fonts/${v}.ttf`,
									);
									candidates.push(
										`/Users/okanaslankan/Gatewai/apps/gatewai-artifex/assets/fonts/${v}.ttf`,
									);
									candidates.push(
										`/Users/okanaslankan/Gatewai/apps/gatewai-backend/src/assets/fonts/${v}/font_file.ttf`,
									);
								}
								candidates.push(
									"/Users/okanaslankan/gitframes/assets/fonts/Inter.ttf",
								);
								candidates.push(
									"/Users/okanaslankan/Gatewai/apps/gatewai-artifex/assets/fonts/Inter.ttf",
								);

								let nodeBuffer: Buffer | null = null;
								for (const c of candidates) {
									try {
										nodeBuffer = await fs.readFile(c);
										if (nodeBuffer && nodeBuffer.length > 0) break;
									} catch {}
								}
								if (!nodeBuffer) {
									throw new Error(
										`Could not resolve font file for "${fontFamily}" (${fontUrl})`,
									);
								}
								buffer = nodeBuffer.buffer.slice(
									nodeBuffer.byteOffset,
									nodeBuffer.byteOffset + nodeBuffer.byteLength,
								) as ArrayBuffer;
							} else {
								// Browser/Web or remote URL environment
								const response = await fetch(fontUrl);
								if (!response.ok) {
									throw new Error(
										`Failed to fetch font from ${fontUrl}: ${response.statusText}`,
									);
								}
								buffer = await response.arrayBuffer();
							}

							const startTime = performance.now();
							const font = parseFontBuffer(new Uint8Array(buffer));
							const parseTime = performance.now();

							SlugFontCache.parsedFontCache.set(fontFamily, font);

							const generator = new SlugGenerator({
								fullRange: false,
								whitelist: whitelist || null,
							});

							const generated = generator.generate(device, font);
							const generateTime = performance.now();

							if (VERBOSE_FONT_LOGS)
								console.log(
									`[SlugFontCache] Preloaded and parsed font "${fontFamily}":\n` +
										`  - fontkit parse: ${(parseTime - startTime).toFixed(2)}ms\n` +
										`  - slug generation: ${(generateTime - parseTime).toFixed(2)}ms\n` +
										`  - total: ${(generateTime - startTime).toFixed(2)}ms`,
								);
							generated.fontFamily = fontFamily;
							SlugFontCache.cache.set(fontFamily, generated);

							// Notify listeners that the font is ready
							SlugFontCache.listeners.forEach((l) => {
								try {
									l(fontFamily);
								} catch (e) {
									console.error("[SlugFontCache] Error in listener:", e);
								}
							});

							return generated;
						} catch (err) {
							SlugFontCache.failedFonts.set(fontFamily, Date.now());
							throw err;
						} finally {
							SlugFontCache.loadingPromises.delete(fontFamily);
						}
					})();

					SlugFontCache.loadingPromises.set(fontFamily, activePromise);
					slugFont = await activePromise;
				}
			}
		} finally {
			if (delayHandle !== null && typeof window !== "undefined") {
				const win = window as any;
				if (win.renderer_delayRenderHandles) {
					const idx = win.renderer_delayRenderHandles.indexOf(delayHandle);
					if (idx > -1) {
						win.renderer_delayRenderHandles.splice(idx, 1);
					}
				}
			}
		}

		if (device) {
			const hadTex = !!slugFont.curvesTex;
			recreateTextures(device, slugFont);
			if (!hadTex && slugFont.curvesTex) {
				SlugFontCache.listeners.forEach((l) => {
					try {
						l(fontFamily);
					} catch (e) {
						console.error("[SlugFontCache] Error in listener:", e);
					}
				});
			}
		}

		return slugFont;
	}

	/**
	 * Preloads the emoji font in the browser using the Cache API and registers
	 * a FontFace so canvas 2D can render emojis natively.
	 * No-op in Node.js environments.
	 */
	static async preloadEmojiFontFace(url: string): Promise<void> {
		if (
			typeof window === "undefined" ||
			typeof caches === "undefined" ||
			typeof FontFace === "undefined"
		) {
			return;
		}

		SlugFontCache.emojiFontUrl = url;

		if (SlugFontCache.emojiFontFaceLoadPromise) {
			await SlugFontCache.emojiFontFaceLoadPromise;
			return;
		}

		SlugFontCache.emojiFontFaceLoadPromise = (async () => {
			try {
				const CACHE_NAME = "gatewai-emoji-font";
				const cache = await caches.open(CACHE_NAME);
				let response = await cache.match(url);

				if (!response) {
					const networkResponse = await fetch(url);
					if (!networkResponse.ok) {
						throw new Error(
							`Failed to fetch emoji font from ${url}: ${networkResponse.statusText}`,
						);
					}
					await cache.put(url, networkResponse.clone());
					response = networkResponse;
				}

				const arrayBuffer = await response.arrayBuffer();

				// Parse the binary for CBDT/CBLC table lookup
				SlugFontCache.parseTableDirectory(new Uint8Array(arrayBuffer));

				// Register as a FontFace so OffscreenCanvas/canvas 2D can use it
				const fontFace = new FontFace("NotoColorEmoji", arrayBuffer);
				const loadedFace = await fontFace.load();
				document.fonts.add(loadedFace);
				await document.fonts.ready;

				console.log(
					"[SlugFontCache] Emoji font preloaded and registered via Cache API.",
				);

				// Notify listeners that the emoji font is ready so that canvas compositions redraw
				SlugFontCache.listeners.forEach((l) => {
					try {
						l("NotoColorEmoji");
					} catch (e) {
						console.error("[SlugFontCache] Error in listener:", e);
					}
				});
			} catch (err) {
				console.warn("[SlugFontCache] Failed to preload emoji font face:", err);
				SlugFontCache.emojiFontFaceLoadPromise = null;
				throw err;
			}
		})();

		await SlugFontCache.emojiFontFaceLoadPromise;
	}

	static destroy(): void {
		for (const font of SlugFontCache.cache.values()) {
			font.curvesTex?.destroy();
			font.bandsTex?.destroy();
		}
		SlugFontCache.cache.clear();
		SlugFontCache.failedFonts.clear();
		for (const tex of SlugFontCache.emojiTextureCache.values()) {
			tex.destroy();
		}
		SlugFontCache.emojiTextureCache.clear();
		SlugFontCache.emojiFontBuffer = null;
		SlugFontCache.emojiFontLoadPromise = null;
		SlugFontCache.emojiFontFaceLoadPromise = null;
	}
}
