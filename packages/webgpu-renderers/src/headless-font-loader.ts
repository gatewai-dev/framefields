import { BASE_URL } from "@gitframes/client-utils";

let tempDir: string | null = null;
const fontPathCache = new Map<string, string>();
const registeredFonts = new Set<string>();
const fontPaths = new Map<string, string>();
const fontDataCache = new Map<string, Uint8Array>();

async function getLocalFontPath(family: string, url: string): Promise<string> {
	let resolvedUrl = url;
	if (url.startsWith("/")) {
		if (BASE_URL) {
			resolvedUrl = `${BASE_URL}${url}`;
		} else {
			const fs = await import(/* webpackIgnore: true */ "fs/promises");
			try {
				await fs.access(url);
			} catch {
				throw new Error(
					`Relative font URL "${url}" cannot be resolved because BASE_URL is not configured.`,
				);
			}
		}
	}

	if (fontPathCache.has(resolvedUrl)) {
		return fontPathCache.get(resolvedUrl)!;
	}

	if (resolvedUrl.startsWith("file://")) {
		try {
			let fontPath = new URL(resolvedUrl).pathname;
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

	if (!tempDir) {
		tempDir = path.join(os.tmpdir(), "gatewai-fonts");
		await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
	}

	const safeFamily = family.replace(/[^a-zA-Z0-9_-]/g, "_");
	const urlObj = new URL(resolvedUrl);
	let ext = path.extname(urlObj.pathname);
	if (!ext || ext.length > 5) {
		ext = ".ttf";
	}
	const destPath = path.join(tempDir, `${safeFamily}-${Date.now()}${ext}`);

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

export async function registerHeadlessFont(
	family: string,
	url: string,
): Promise<string | undefined> {
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
		console.log(
			`[registerHeadlessFont] Headless font registered: "${family}" from URL: ${url} -> saved to local path: ${fontPath}`,
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
			console.log(
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
