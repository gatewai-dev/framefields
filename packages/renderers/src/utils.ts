import { registerHeadlessFont } from "@gitframes/webgpu-renderers";

/**
 * Preloads a font into the browser or headless environment.
 */
export async function preloadFont(family: string, url: string): Promise<void> {
	if (typeof window !== "undefined" && typeof FontFace !== "undefined") {
		try {
			const font = new FontFace(family, `url(${url})`);
			const loadedFace = await font.load();
			(document.fonts as any).add(loadedFace);
			await document.fonts.ready;
		} catch (e) {
			console.warn(
				`[preloadFont] Failed to load font "${family}" from ${url}:`,
				e,
			);
		}
	} else {
		// Headless / Node.js mode
		await registerHeadlessFont(family, url);
	}
}
