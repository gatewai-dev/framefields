import { resetDeviceInstance } from "./device.js";
import { inputStore } from "./input-store.js";
import { lutStore } from "./lut-store.js";
import { mediaDecoderCache } from "./nodes/media-decoder.js";
import { clearAllVideoCache } from "./nodes/video.js";
import { SlugFontCache } from "./slug/slug-font-cache.js";
import { textureCache } from "./texture-cache.js";

/**
 * Drops every cache keyed by a file path or URL: media inputs and decoders,
 * textures, LUTs and parsed fonts. Runs anywhere (Node, a page, a worker).
 * Between jobs, because the same path may now hold different bytes; between
 * the chunks of an on-device export, to give their memory back. Compiled
 * pipelines and the GPU device stay. Fonts are parsed again on next use, so
 * preload them before drawing.
 */
export function clearMediaCaches(): void {
	clearAllVideoCache();
	mediaDecoderCache.destroy();
	textureCache.destroy();
	inputStore.clear();
	lutStore.destroy();
	SlugFontCache.destroy();
}

/**
 * Gives back everything the GPU device holds: clears the media caches, then
 * destroys the device, so pipelines, buffers and the per-device caches go
 * with it. The next `ensureDevice()` makes a new one. For memory pressure
 * between jobs or export chunks; nothing may be drawing.
 */
export function releaseDevice(device: GPUDevice): void {
	clearMediaCaches();
	resetDeviceInstance();
	device.destroy();
}
