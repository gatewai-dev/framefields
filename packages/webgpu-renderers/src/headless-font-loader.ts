import { debugLog } from "./debug-log.js";

let tempDir: Promise<string> | null = null;
const fontPathCache = new Map<string, string>();
const registeredFonts = new Set<string>();
const fontPaths = new Map<string, string>();
const fontDataCache = new Map<string, Uint8Array>();

async function getLocalFontPath(family: string, url: string): Promise<string> {
	const resolvedUrl = url;
	if (url.startsWith("/")) {
		const fs = await import(/* webpackIgnore: true */ "fs/promises");
		try {
			await fs.access(url);
		} catch {
			throw new Error(`Font file "${url}" not found.`);
		}
	}

	if (fontPathCache.has(resolvedUrl)) {
		return fontPathCache.get(resolvedUrl)!;
	}

	if (resolvedUrl.startsWith("file://")) {
		try {
			// A URL path is percent-encoded ("My%20Film"); files aren't.
			let fontPath = decodeURIComponent(new URL(resolvedUrl).pathname);
			if (process.platform === "win32" && fontPath.startsWith("/")) {
				fontPath = fontPath.slice(1);
			}
			fontPathCache.set(resolvedUrl, fontPath);
			return fontPath;
		} catch {
			const fontPath = resolvedUrl.replace(/^file:\/\//, "");
			fontPathCache.set(resolvedUrl, fontPath);
			return fontPath;
		}
	}

	if (
		!resolvedUrl.startsWith("http://") &&
		!resolvedUrl.startsWith("https://")
	) {
		return resolvedUrl;
	}

	const fs = await import(/* webpackIgnore: true */ "fs/promises");
	const path = await import(/* webpackIgnore: true */ "path");
	const os = await import(/* webpackIgnore: true */ "os");

	// A fresh dir per session, so clearHeadlessFonts() can delete the last
	// one without racing new downloads.
	tempDir ??= fs
		.mkdtemp(path.join(os.tmpdir(), "gatewai-fonts-"))
		.catch((err) => {
			tempDir = null;
			throw err;
		});
	const dir = await tempDir;

	const safeFamily = family.replace(/[^a-zA-Z0-9_-]/g, "_");
	const urlObj = new URL(resolvedUrl);
	let ext = path.extname(urlObj.pathname);
	if (!ext || ext.length > 5) {
		ext = ".ttf";
	}
	const destPath = path.join(dir, `${safeFamily}-${Date.now()}${ext}`);

	const response = await fetch(resolvedUrl);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch font from ${resolvedUrl}: ${response.statusText}`,
		);
	}
	const buffer = await response.arrayBuffer();
	await fs.writeFile(destPath, Buffer.from(buffer));

	fontPathCache.set(resolvedUrl, destPath);
	return destPath;
}

/**
 * Forgets every registered font and deletes the fonts downloaded from URLs.
 * A long-lived process calls it between jobs (via `resetRenderCaches`): the
 * next job may register the same family from another file, or fetch a URL
 * whose font changed.
 */
export async function clearHeadlessFonts(): Promise<void> {
	fontPathCache.clear();
	fontPaths.clear();
	fontDataCache.clear();
	registeredFonts.clear();
	const pending = tempDir;
	tempDir = null;
	if (pending) {
		const fs = await import(/* webpackIgnore: true */ "fs/promises");
		const dir = await pending.catch(() => undefined);
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * A browser page rather than Node or the headless renderer: there is no
 * file system, and text draws from the registered source (Slug, FontFace).
 */
function inBrowserPage(): boolean {
	return (
		!(globalThis as Record<string, unknown>).__IS_HEADLESS_RENDERER__ &&
		typeof window !== "undefined" &&
		typeof globalThis.document !== "undefined"
	);
}

export async function registerHeadlessFont(
	family: string,
	url: string,
): Promise<string | undefined> {
	// The local copy is for skia-canvas and DotLottie in Node; a page would
	// only try (and warn about) a temp-dir download it can't make.
	if (inBrowserPage()) return undefined;
	if (fontPaths.has(family)) {
		return fontPaths.get(family);
	}

	const anyGlobal = globalThis as unknown as {
		OffscreenCanvas?: {
			registerFont?: (path: string, options: { family: string }) => void;
		};
	};

	try {
		const fontPath = await getLocalFontPath(family, url);
		fontPaths.set(family, fontPath);
		debugLog(
			fontPath === url
				? `[registerHeadlessFont] Registered "${family}" from ${fontPath}`
				: `[registerHeadlessFont] Registered "${family}" from ${url} (cached at ${fontPath})`,
		);

		try {
			if (
				anyGlobal.OffscreenCanvas &&
				typeof anyGlobal.OffscreenCanvas.registerFont === "function"
			) {
				anyGlobal.OffscreenCanvas.registerFont(fontPath, { family });
				registeredFonts.add(family);
			}
		} catch (skiaErr) {
			// SkiaCanvas registration is optional — font data is still usable for DotLottie WASM
			console.warn(
				`[registerHeadlessFont] SkiaCanvas registration failed for "${family}" (non-fatal):`,
				skiaErr,
			);
		}

		return fontPath;
	} catch (e) {
		console.warn(
			`[registerHeadlessFont] Failed to download font "${family}" from ${url}:`,
			e,
		);
	}
	return undefined;
}

/** Local file path of a font registered via {@link registerHeadlessFont}, if any. */
export function getHeadlessFontPath(family: string): string | undefined {
	return fontPaths.get(family);
}

// Shared by every copy of the engine on a page, as SlugFontCache's maps are.
const FONT_SOURCES_KEY = Symbol.for("framefields.fontSources");
const sharedGlobals = globalThis as Record<symbol, unknown>;
sharedGlobals[FONT_SOURCES_KEY] ??= new Map();
const fontSources = sharedGlobals[FONT_SOURCES_KEY] as Map<
	string,
	string | Uint8Array
>;

/**
 * Records where a registered family's font came from (its path or URL, or
 * its bytes), so loaders use it instead of guessing a file by family name.
 */
export function setRegisteredFontSource(
	family: string,
	source: string | Uint8Array,
): void {
	fontSources.set(family, source);
}

/** The path, URL or bytes a family was registered from, if it was. */
export function getRegisteredFontSource(
	family: string,
): string | Uint8Array | undefined {
	return fontSources.get(family);
}

export async function getHeadlessFontData(
	family: string,
): Promise<Uint8Array | undefined> {
	const cached = fontDataCache.get(family);
	if (cached) return cached;

	const path = fontPaths.get(family);
	if (path) {
		try {
			const fs = await import(/* webpackIgnore: true */ "fs/promises");
			const buf = await fs.readFile(path);
			// Copy the bytes to a fresh Uint8Array to ensure a clean, isolated ArrayBuffer
			// because Node.js Buffer instances can share an internal global pool.
			const uint8 = new Uint8Array(buf.length);
			uint8.set(buf);
			debugLog(
				`[getHeadlessFontData] Read local font binary for "${family}" from: ${path} (${uint8.length} bytes)`,
			);
			fontDataCache.set(family, uint8);
			return uint8;
		} catch (e) {
			console.warn(
				`[getHeadlessFontData] Failed to read font file from ${path}:`,
				e,
			);
		}
	}
	return undefined;
}
