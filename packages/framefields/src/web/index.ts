/// <reference lib="dom" />
/**
 * `framefields/web`: renders a composition to MP4 on the viewer's own device
 * (Safari and WKWebView on iOS 26+, any browser with WebGPU and WebCodecs),
 * from a web bundle made by `framefields bundle`. Framework-free.
 *
 * The engine ships inside the bundle (`engine/`), so the composition and the
 * engine that draws it are the same modules; this loader only imports the
 * bundle's `engine/web.mjs`. A page can also import that file itself.
 *
 * ```ts
 * import { openBundle } from "framefields/web";
 * const bundle = await openBundle("/film/");
 * const { file } = await bundle.exportVideo({ onProgress: (p) => console.log(p.message) });
 * ```
 */
import type { WebBundle } from "./types.js";

export type * from "./queue.js";
export type * from "./types.js";

/** Opens the web bundle at `base`: the folder holding its `manifest.json`. */
export async function openBundle(base: string | URL): Promise<WebBundle> {
	const root = new URL(String(base), globalThis.location?.href);
	const href = root.href.endsWith("/") ? root.href : `${root.href}/`;
	const runtime = (await import(
		/* @vite-ignore */ new URL("engine/web.mjs", href).href
	)) as { openBundle(base: string): Promise<WebBundle> };
	return runtime.openBundle(href);
}
