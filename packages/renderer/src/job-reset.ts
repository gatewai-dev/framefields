import {
	clearAllVideoCache,
	inputStore,
	lutStore,
	mediaDecoderCache,
	SlugFontCache,
	textureCache,
} from "@framefields/webgpu-renderers";

/**
 * Drops every cache keyed by a file path or URL: media inputs and decoders,
 * textures, LUTs and fonts. A long-lived worker calls this between jobs,
 * because the next checkout may hold different bytes at the same path. The
 * GPU device and compiled pipelines stay warm.
 */
export function resetRenderCaches(): void {
	clearAllVideoCache();
	mediaDecoderCache.destroy();
	textureCache.destroy();
	inputStore.clear();
	lutStore.destroy();
	SlugFontCache.destroy();
}
