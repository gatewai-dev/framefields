import { registerHeadlessFont } from "@framefields/webgpu-renderers";

/**
 * Preloads a font into the browser or headless environment.
 */
export async function preloadFont(
	family: string,
	source: string | Uint8Array,
): Promise<void> {
	if (typeof window !== "undefined" && typeof FontFace !== "undefined") {
		const from = typeof source === "string" ? source : "its registered bytes";
		try {
			const font = new FontFace(
				family,
				typeof source === "string" ? `url(${source})` : source,
			);
			const loadedFace = await font.load();
			(document.fonts as any).add(loadedFace);
			await document.fonts.ready;
		} catch (e) {
			console.warn(
				`[preloadFont] Failed to load font "${family}" from ${from}:`,
				e,
			);
		}
	} else {
		// Headless / Node.js mode: bytes have no file to register (FontManager
		// registers the file of a font it read from one).
		if (typeof source === "string") await registerHeadlessFont(family, source);
	}
}
