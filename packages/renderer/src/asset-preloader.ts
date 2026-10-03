import {
	GetFontAssetUrl,
	R2_CUSTOM_DOMAIN,
} from "@gitframes/client-utils";
import type { VirtualMediaData } from "@gitframes/core";
import { preloadFont } from "@gitframes/renderers";
import { rendererLogger } from "@gitframes/server-utils";
import {
	getHeadlessFontPath,
	SlugFontCache,
} from "@gitframes/webgpu-renderers";
import type {} from "webgpu";

/**
 * Recursively scans and preloads only the required font assets inside a VirtualMediaData tree.
 * This ensures typography renders correctly on Node.js without pre-loading or memory bloating from large media assets.
 */
export async function preloadFonts(
	media: VirtualMediaData,
	device: GPUDevice | null = null,
): Promise<void> {
	if (!media) return;

	const promises: Promise<unknown>[] = [];
	const op = media.operation;

	// Configure emoji font source: prefer R2 CDN, fallback to local file
	if (R2_CUSTOM_DOMAIN) {
		SlugFontCache.emojiFontUrl = `https://${R2_CUSTOM_DOMAIN}/static/NotoColorEmoji.ttf`;
	}

	// Local fallback for environments without R2 (e.g., local dev)
	if (!SlugFontCache.emojiFontPath) {
		try {
			const isDev = import.meta.url.endsWith(".ts");
			const emojiLocalUrl = new URL(
				isDev
					? "./assets/NotoColorEmoji.ttf"
					: "../src/assets/NotoColorEmoji.ttf",
				import.meta.url,
			).href;

			let fontPath = emojiLocalUrl;
			if (emojiLocalUrl.startsWith("file://")) {
				try {
					fontPath = new URL(emojiLocalUrl).pathname;
				} catch {
					fontPath = emojiLocalUrl.replace(/^file:\/\//, "");
				}
			}
			SlugFontCache.emojiFontPath = fontPath;
		} catch {
			// Local font not available — rely on R2 URL
		}
	}

	if (op) {
		const opText = op as Record<string, unknown>;
		const isTextNode =
			opText.op === "text" ||
			opText.kind === "text" ||
			opText.op === "caption" ||
			opText.kind === "caption" ||
			typeof opText.text === "string";
		const fontFamily =
			(opText.fontFamily as string) || (isTextNode ? "Inter" : undefined);
		if (fontFamily) {
			// Fonts registered through FontManager carry their real file path; the
			// asset URL is only a naming convention and would miss e.g. "Foo-Regular.ttf".
			const fontUrl =
				getHeadlessFontPath(fontFamily) ?? GetFontAssetUrl(fontFamily);
			promises.push(
				preloadFont(fontFamily, fontUrl).catch((err) => {
					rendererLogger.error(
						err,
						`[HeadlessMediaRenderer] Failed to preload font "${fontFamily}" from ${fontUrl}`,
					);
				}),
			);
			if (device) {
				promises.push(
					SlugFontCache.preloadSlugFont(device, fontFamily, fontUrl).catch(
						(err) => {
							rendererLogger.error(
								err,
								`[HeadlessMediaRenderer] Failed to preload Slug font "${fontFamily}" from ${fontUrl}`,
							);
						},
					),
				);
			}
		}
		if (opText.op === "text" && opText.text && device) {
			const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
			const matches = (opText.text as string).match(EMOJI_REGEX);
			if (matches) {
				const fontSize = (opText.fontSize as number) ?? 48;
				for (const char of matches) {
					promises.push(
						SlugFontCache.preloadEmoji(device, char, fontSize).catch((err) => {
							rendererLogger.error(
								err,
								`[HeadlessMediaRenderer] Failed to preload emoji texture for "${char}"`,
							);
						}),
					);
				}
			}
		}
	}

	// Recurse into nested children
	if (media.children && media.children.length > 0) {
		for (const child of media.children) {
			promises.push(preloadFonts(child, device));
		}
	}

	await Promise.all(promises);
}
