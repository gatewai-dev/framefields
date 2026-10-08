import { GetFontAssetUrl } from "@framefields/client-utils";
import type { TextSpan } from "@framefields/core";
import { SlugFontCache, SlugGeometry } from "@framefields/webgpu-renderers";

export interface TextMeasureStyle {
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: string | number;
	fontStyle?: string;
	letterSpacing?: number;
	lineHeight?: number;
	padding?: number;
	align?: "left" | "center" | "right";
	width?: number;
	height?: number;
	autoDimensions?: boolean;
	strokeWidth?: number;
	strokeAlign?: "inside" | "center" | "outside";
	keepNaturalWidth?: boolean;
	spans?: TextSpan[];
}

export interface TextMeasureResult {
	width: number;
	height: number;
}

const cache = new Map<string, TextMeasureResult>();

function getCacheKey(text: string, style: TextMeasureStyle): string {
	return JSON.stringify({ text, ...style });
}

/**
 * Shared text measurer that uses SlugGeometry.measure for all environments.
 */
export function measureText(
	text: string | null | undefined,
	style: TextMeasureStyle,
): TextMeasureResult {
	const safeText = text ? String(text) : " ";
	const cacheKey = getCacheKey(safeText, style);
	const cached = cache.get(cacheKey);
	if (cached) return cached;

	const fontSize = style.fontSize ?? 48;
	let fontFamily = style.fontFamily ?? "Inter";
	if (SlugFontCache.isFailed(fontFamily)) {
		fontFamily = "Inter";
	}

	const letterSpacing = style.letterSpacing ?? 0;
	const calculatedLineHeight =
		style.lineHeight !== undefined && style.lineHeight < 10
			? style.lineHeight * fontSize
			: (style.lineHeight ?? fontSize * 1.2);

	const slugFont = SlugFontCache.getFont(fontFamily, style.fontWeight, null);

	const padding = style.padding ?? 0;

	if (!slugFont) {
		// Trigger preload for future calls if it hasn't failed yet
		if (!SlugFontCache.isFailed(fontFamily)) {
			const fontUrl = GetFontAssetUrl(fontFamily);
			SlugFontCache.preloadSlugFont(null, fontFamily, fontUrl).catch(() => {});
		}

		// Fallback estimation with word wrap support
		const lines = safeText.split("\n");
		let totalWrappedLines = 0;
		const maxW =
			style.width !== undefined ? Math.max(10, style.width - padding * 2) : 0;
		for (const line of lines) {
			if (maxW > 0) {
				const estLineWidth =
					line.length * fontSize * 0.55 + letterSpacing * line.length;
				const wrapCount = Math.max(1, Math.ceil(estLineWidth / maxW));
				totalWrappedLines += wrapCount;
			} else {
				totalWrappedLines += 1;
			}
		}
		const letterGaps = Math.max(0, safeText.length - 1);
		const result = {
			width:
				style.width !== undefined
					? style.width
					: Math.ceil(
							safeText.length * fontSize * 0.6 + letterSpacing * letterGaps,
						) +
						padding * 2,
			height:
				style.height !== undefined
					? style.height
					: Math.ceil(totalWrappedLines * calculatedLineHeight) + padding * 2,
		};
		cache.set(cacheKey, result);
		return result;
	}

	const measured = SlugGeometry.measure(
		safeText,
		slugFont,
		fontSize,
		letterSpacing,
		calculatedLineHeight,
		style.width !== undefined
			? Math.max(0, style.width - padding * 2)
			: undefined,
		style.spans,
	);

	const result = {
		width:
			style.width !== undefined && !style.keepNaturalWidth
				? style.width
				: Math.ceil(measured.width) + padding * 2,
		height:
			style.height !== undefined
				? style.height
				: Math.ceil(measured.height) + padding * 2,
	};
	cache.set(cacheKey, result);
	return result;
}

/**
 * Async variant of measureText. Preloads the Slug font and yields to the browser.
 */
export function measureTextAsync(
	text: string | null | undefined,
	style: TextMeasureStyle,
): Promise<TextMeasureResult> {
	let fontFamily = style.fontFamily ?? "Inter";
	if (SlugFontCache.isFailed(fontFamily)) {
		fontFamily = "Inter";
	}

	if (SlugFontCache.isFailed(fontFamily)) {
		return Promise.resolve(measureText(text, style));
	}

	const fontUrl = GetFontAssetUrl(fontFamily);

	return SlugFontCache.preloadSlugFont(null, fontFamily, fontUrl)
		.then(() => measureText(text, style))
		.catch(() => measureText(text, style));
}
