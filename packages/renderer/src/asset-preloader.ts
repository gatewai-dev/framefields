import type { VirtualMediaData } from "@framefields/core";
import { preloadCompositionFonts } from "@framefields/renderers";
import { rendererLogger } from "@framefields/server-utils";
import type {} from "webgpu";

/**
 * Preloads only the fonts (and emoji) a VirtualMediaData tree's text uses, so
 * typography renders correctly on Node.js without loading its media. Shared
 * with the browser preview; emoji need a font set with
 * `FontManager.registerEmojiFont()`.
 */
export async function preloadFonts(
	media: VirtualMediaData,
	device: GPUDevice | null = null,
): Promise<void> {
	if (!media) return;
	await preloadCompositionFonts(media, device, (err, what) =>
		rendererLogger.error(
			err,
			`[HeadlessMediaRenderer] Failed to preload ${what}`,
		),
	);
}
