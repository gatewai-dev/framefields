import type { VirtualMediaData } from "@framefields/core";
import { emojiGraphemes, SlugFontCache } from "@framefields/webgpu-renderers";
import { fontSource, fontUrl } from "./font-source.js";
import { preloadFont } from "./utils.js";

type Device = Parameters<typeof SlugFontCache.preloadSlugFont>[0];

let warnedNoEmojiFont = false;

/**
 * Loads every font a composition's text uses (for layout and for drawing) and
 * the emoji it draws. The browser preview and the export both call this, so
 * they start each render from the same glyphs.
 */
export async function preloadCompositionFonts(
	media: VirtualMediaData,
	device: Device | null,
	onError: (err: unknown, what: string) => void = (err, what) =>
		console.warn(`[framefields] ${what}`, err),
): Promise<void> {
	const families = new Set<string>();
	const emoji = new Map<string, number>();
	(function walk(node: VirtualMediaData) {
		const op = node.operation as Record<string, unknown> | undefined;
		if (op) {
			const isText =
				op.op === "text" ||
				op.kind === "text" ||
				op.op === "caption" ||
				op.kind === "caption" ||
				typeof op.text === "string";
			const family = (op.fontFamily as string) || (isText ? "Inter" : "");
			if (family) families.add(family);
			// Text layers arrive as `{ op: "CompositorLayer", kind: "text" }`.
			if (isText && typeof op.text === "string") {
				const fontSize = (op.fontSize as number) ?? 48;
				for (const char of emojiGraphemes(op.text)) {
					emoji.set(`${char}-${fontSize}`, fontSize);
				}
			}
		}
		for (const child of node.children ?? []) walk(child);
	})(media);

	const tasks: Promise<unknown>[] = [];
	for (const family of families) {
		// A registered family loads from what it was registered with; a family
		// SlugFontCache has parsed already never fetches `url`.
		const source = fontSource(family);
		const url = fontUrl(family);
		const from = typeof source === "string" ? source : "its registered bytes";
		tasks.push(
			preloadFont(family, source).catch((err) =>
				onError(err, `font "${family}" from ${from}`),
			),
		);
		if (device) {
			tasks.push(
				SlugFontCache.preloadSlugFont(device, family, url).catch((err) =>
					onError(err, `Slug font "${family}" from ${url}`),
				),
			);
		}
	}
	if (device && emoji.size > 0) {
		if (!SlugFontCache.hasEmojiFont() && !warnedNoEmojiFont) {
			warnedNoEmojiFont = true;
			console.warn(
				"[framefields] Text uses emoji but no emoji font is registered, so exports draw nothing for them. Run `npx framefields fonts add emoji` and call the generated `registerFonts()`, or register a color emoji font (e.g. Noto Color Emoji) with FontManager.registerEmojiFont(path). `comp.lint()` names the layers (missing_emoji_font).",
			);
		}
		for (const [key, fontSize] of emoji) {
			const char = key.slice(0, key.lastIndexOf("-"));
			tasks.push(
				SlugFontCache.preloadEmoji(device, char, fontSize).catch((err) => {
					// Already reported above when no font is set.
					if (SlugFontCache.hasEmojiFont()) onError(err, `emoji "${char}"`);
				}),
			);
		}
	}
	await Promise.all(tasks);
}
