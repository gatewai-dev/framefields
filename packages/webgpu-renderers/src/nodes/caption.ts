import { GetFontAssetUrl } from "@gitframes/client-utils";
import type { RenderContextValue } from "../render-context.js";
import { SlugFontCache } from "../slug/slug-font-cache.js";
import { SlugGeometry } from "../slug/slug-geometry.js";
import { drawParagraphNode } from "./paragraph.js";
import type { CaptionNodeProps } from "./types.js";

export interface Caption {
	text: string;
	startMs: number;
	endMs: number;
	timestampMs: number | null;
	confidence: number | null;
	words?: Array<{
		word?: string;
		text?: string;
		startMs: number;
		endMs: number;
	}>;
}

function toSeconds(time: string): number {
	const clean = time.trim().replace(",", ".");
	const parts = clean.split(":");
	if (parts.length < 2 || parts.length > 3) {
		throw new Error(`Invalid timestamp: ${time}`);
	}

	if (parts.length === 2) {
		const [m, s] = parts;
		return parseInt(m, 10) * 60 + parseFloat(s);
	}

	const [h, m, s] = parts;
	return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
}

export function parseSrt(input: string): { captions: Caption[] } {
	const inputLines = input.replace(/\r\n/g, "\n").split("\n");
	const captions: Caption[] = [];

	for (let i = 0; i < inputLines.length; i++) {
		const line = inputLines[i];
		const nextLine = inputLines[i + 1];
		if (line?.match(/([0-9]+)/) && nextLine?.includes(" --> ")) {
			const nextLineSplit = nextLine.split(" --> ");
			const start = toSeconds(nextLineSplit[0] as string);
			const end = toSeconds(nextLineSplit[1] as string);
			captions.push({
				text: "",
				startMs: start * 1000,
				endMs: end * 1000,
				confidence: 1,
				timestampMs: ((start + end) / 2) * 1000,
			});
		} else if (line?.includes(" --> ")) {
		} else if (line?.trim() === "") {
			if (captions.length > 0) {
				captions[captions.length - 1].text =
					captions[captions.length - 1].text.trim();
			}
		} else {
			if (captions.length > 0) {
				captions[captions.length - 1].text += line + "\n";
			}
		}
	}

	return {
		captions: captions.map((l) => ({
			...l,
			text: l.text.trimEnd(),
		})),
	};
}

export function getActiveCaptionCue(
	captions: Caption[],
	currentMs: number,
	isVideoMode = true,
): Caption | null {
	if (!captions || captions.length === 0) return null;
	const cue = captions.find(
		(c) => currentMs >= c.startMs && currentMs < c.endMs,
	);
	if (cue) return cue;
	if (!isVideoMode && captions.length > 0) {
		return captions[0];
	}
	return null;
}

export function measureMaxCaptionHeight(
	captions: Caption[],
	style: {
		fontFamily?: string;
		fontSize?: number;
		fontWeight?: string | number;
		letterSpacing?: number;
		lineHeight?: number;
		padding?: number;
		background?: string;
	},
	maxWidth?: number,
): number {
	if (!captions || captions.length === 0) return 160;
	const fontSize = style.fontSize ?? 48;
	const letterSpacing = style.letterSpacing ?? 0;
	const calculatedLineHeight =
		style.lineHeight !== undefined && style.lineHeight < 10
			? style.lineHeight * fontSize
			: (style.lineHeight ?? fontSize * 1.2);
	const padding = style.padding ?? (style.background ? 12 : 0);
	const availableW = maxWidth
		? Math.max(10, maxWidth - padding * 2)
		: undefined;

	let fontFamily = style.fontFamily ?? "Inter";
	if (SlugFontCache.isFailed(fontFamily)) {
		fontFamily = "Inter";
	}
	const slugFont = SlugFontCache.getFont(fontFamily, style.fontWeight, null);

	let maxH = 0;
	for (const cue of captions) {
		if (!cue.text) continue;
		let cueH = 0;
		if (slugFont && slugFont.codePoints) {
			const measured = SlugGeometry.measure(
				cue.text,
				slugFont,
				fontSize,
				letterSpacing,
				calculatedLineHeight,
				availableW,
			);
			cueH = Math.ceil(measured.height);
		} else {
			const lines = cue.text.split("\n");
			let totalWrappedLines = 0;
			for (const l of lines) {
				if (availableW) {
					const estLineWidth =
						l.length * fontSize * 0.55 + letterSpacing * l.length;
					const wrapCount = Math.max(1, Math.ceil(estLineWidth / availableW));
					totalWrappedLines += wrapCount;
				} else {
					totalWrappedLines += 1;
				}
			}
			cueH = Math.ceil(totalWrappedLines * calculatedLineHeight);
		}
		const totalH = cueH + padding * 2;
		if (totalH > maxH) maxH = totalH;
	}
	return Math.max(20, maxH || 160);
}

class SrtLoaderCache {
	private cache = new Map<string, Promise<Caption[]>>();
	private resolvedCache = new Map<string, Caption[]>();

	getCached(src: string): Caption[] | undefined {
		return this.resolvedCache.get(src);
	}

	setCached(src: string, captions: Caption[]) {
		this.resolvedCache.set(src, captions);
	}

	clear() {
		this.cache.clear();
		this.resolvedCache.clear();
	}

	async load(src: string): Promise<Caption[]> {
		if (!src) return [];
		const cached = this.resolvedCache.get(src);
		if (cached) return cached;
		let promise = this.cache.get(src);
		if (!promise) {
			promise = (async () => {
				let srtString = "";
				if (src.startsWith("data:")) {
					const commaIndex = src.indexOf(",");
					if (commaIndex !== -1) {
						const metadata = src.substring(0, commaIndex);
						const data = src.substring(commaIndex + 1);
						const isBase64 = metadata.includes(";base64");
						srtString = isBase64
							? typeof Buffer !== "undefined"
								? Buffer.from(data, "base64").toString("utf-8")
								: new TextDecoder().decode(
										Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
									)
							: decodeURIComponent(data);
					}
				} else if (src.includes("-->")) {
					srtString = src;
				} else if (
					src.startsWith("http://") ||
					src.startsWith("https://")
				) {
					const res = await fetch(src);
					if (!res.ok) throw new Error(`Failed to fetch SRT: ${src}`);
					srtString = await res.text();
				} else {
					let filePath = src;
					if (filePath.startsWith("file://")) {
						try {
							filePath = new URL(filePath).pathname;
						} catch {
							filePath = filePath.replace(/^file:\/\//, "");
						}
					}
					if (typeof process !== "undefined" && process.versions?.node) {
						try {
							const fs = await import(/* webpackIgnore: true */ "node:fs/promises");
							srtString = await fs.readFile(filePath, "utf-8");
						} catch {
							const res = await fetch(src);
							if (!res.ok) throw new Error(`Failed to fetch SRT: ${src}`);
							srtString = await res.text();
						}
					} else {
						const res = await fetch(src);
						if (!res.ok) throw new Error(`Failed to fetch SRT: ${src}`);
						srtString = await res.text();
					}
				}
				const list = parseSrt(srtString).captions;
				this.resolvedCache.set(src, list);
				return list;
			})();
			this.cache.set(src, promise);
			promise.catch(() => {
				this.cache.delete(src);
				this.resolvedCache.delete(src);
			});
		}
		return promise;
	}
}

export const srtLoader = new SrtLoaderCache();

export async function drawCaptionNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: CaptionNodeProps,
): Promise<void> {
	if (!props.src) return;
	const captions = await srtLoader.load(props.src);
	if (!captions || captions.length === 0) return;
	const currentMs = (props.frame / props.fps) * 1000;

	const caption = getActiveCaptionCue(
		captions,
		currentMs,
		props.isVideoMode !== false,
	);

	if (!caption) return;

	const text = caption.text;

	// Measurement and Positioning within container dstRect
	const containerWidth = props.dstRect.width;
	const padding = props.padding ?? (props.textBackgroundColor ? 12 : 0);

	const maxAvailableWidth = Math.max(10, containerWidth - padding * 2);
	const maxWidth =
		props.maxWidth !== undefined
			? Math.min(props.maxWidth, maxAvailableWidth)
			: maxAvailableWidth;

	const fontSize = props.fontSize ?? 48;
	let fontFamily = props.fontFamily ?? "Inter";
	if (SlugFontCache.isFailed(fontFamily)) {
		fontFamily = "Inter";
	}
	if (SlugFontCache.isFailed(fontFamily)) {
		return;
	}
	const letterSpacing = props.letterSpacing ?? 0;

	const slugFont = SlugFontCache.getFont(
		fontFamily,
		props.fontWeight,
		ctx.device,
	);

	if (!slugFont || !slugFont.curvesTex) {
		const fontUrl = GetFontAssetUrl(fontFamily);
		SlugFontCache.preloadSlugFont(
			ctx.device,
			fontFamily,
			fontUrl,
			undefined,
			props.renderId,
		).catch((err) => {
			console.warn(
				`[drawCaptionNode] Failed to load Slug font for ${fontFamily}:`,
				err,
			);
		});
		return;
	}

	const calculatedLineHeight =
		props.lineHeight !== undefined && props.lineHeight < 10
			? props.lineHeight * fontSize
			: (props.lineHeight ?? fontSize * 1.2);

	const measured = SlugGeometry.measure(
		text,
		slugFont,
		fontSize,
		letterSpacing,
		calculatedLineHeight,
		maxWidth,
	);

	const finalWidth = measured.width;
	const finalHeight = measured.height;

	const rectWidth = finalWidth + padding * 2;
	const rectHeight = finalHeight + padding * 2;

	const align = props.align ?? "center";
	let rectX = 0;
	if (align === "center") {
		rectX = Math.max(0, (containerWidth - rectWidth) / 2);
	} else if (align === "right") {
		rectX = Math.max(0, containerWidth - rectWidth);
	}

	const containerHeight = props.dstRect.height;

	const verticalAlign =
		props.verticalAlign ?? props.textAlignVertical ?? "bottom";
	let rectY = 0;
	if (verticalAlign === "top") {
		rectY = 0;
	} else if (verticalAlign === "middle") {
		rectY = (containerHeight - rectHeight) / 2;
	} else {
		rectY = containerHeight - rectHeight;
	}

	const dstRect = {
		x: props.dstRect.x + rectX,
		y: props.dstRect.y + rectY,
		width: rectWidth,
		height: rectHeight,
	};

	const opacity = props.opacity ?? 1;

	if (props.textBackgroundColor) {
		const radius = props.strokeRadius ?? props.borderRadius ?? 8;
		ctx.renderer.drawRRect(
			pass,
			{
				rect: dstRect,
				rx: radius,
				ry: radius,
			},
			props.textBackgroundColor,
			{ opacity },
		);
	}

	const paragraphDstRect = {
		x: dstRect.x + padding,
		y: dstRect.y + padding,
		width: finalWidth,
		height: finalHeight,
	};

	drawParagraphNode(ctx, pass, {
		...props,
		text,
		dstRect: paragraphDstRect,
		width: maxWidth,
		height: finalHeight,
		align,
		opacity,
		isCaption: true,
		animation: undefined,
		textBackgroundColor: undefined,
	});
}
