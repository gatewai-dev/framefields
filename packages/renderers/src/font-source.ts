import { GetFontAssetUrl } from "@framefields/client-utils";
import {
	getHeadlessFontPath,
	getRegisteredFontSource,
} from "@framefields/webgpu-renderers";

/**
 * Where a family's font loads from: the file, URL or bytes it was registered
 * with (`FontManager.register`), else the `assets/fonts/<Family>.ttf`
 * naming convention, which would miss e.g. "Foo-Regular.ttf" or bytes.
 */
export function fontSource(family: string): string | Uint8Array {
	return (
		getRegisteredFontSource(family) ??
		getHeadlessFontPath(family) ??
		GetFontAssetUrl(family)
	);
}

/** {@link fontSource} as a URL or path, for loaders that only take one. */
export function fontUrl(family: string): string {
	const source = fontSource(family);
	return typeof source === "string" ? source : GetFontAssetUrl(family);
}
