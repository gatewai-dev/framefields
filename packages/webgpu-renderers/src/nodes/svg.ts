import type { RenderContextValue } from "../render-context.js";
import { textureCache } from "../texture-cache.js";
import type { SVGNodeProps } from "./types.js";

interface SvgData {
	width: number;
	height: number;
	bitmap?: ImageBitmap;
	buffer?: Uint8Array;
}

class SvgLoader {
	private cache = new Map<string, Promise<SvgData>>();

	async load(
		src: string,
		width: number,
		height: number,
		isHeadless: boolean,
	): Promise<SvgData> {
		const resolvedWidth = Math.max(1, Math.ceil(width));
		const resolvedHeight = Math.max(1, Math.ceil(height));
		const key = `${src}-${resolvedWidth}-${resolvedHeight}-${isHeadless}`;
		let promise = this.cache.get(key);
		if (!promise) {
			promise = (async () => {
				let text: string;
				const isRemote =
					src.startsWith("http://") ||
					src.startsWith("https://") ||
					src.startsWith("data:");

				if (isRemote || !isHeadless) {
					const res = await fetch(src);
					if (!res.ok) throw new Error(`Failed to fetch SVG: ${src}`);
					text = await res.text();
				} else {
					let filePath = src;
					if (filePath.startsWith("file://")) {
						try {
							filePath = new URL(filePath).pathname;
						} catch {
							filePath = filePath.replace(/^file:\/\//, "");
						}
					}
					try {
						const fs = await import(/* webpackIgnore: true */ "fs/promises");
						text = await fs.readFile(filePath, "utf-8");
					} catch {
						const res = await fetch(src);
						if (!res.ok) throw new Error(`Failed to fetch SVG: ${src}`);
						text = await res.text();
					}
				}

				if (isHeadless) {
					const { renderAsync } = await import(
						/* webpackIgnore: true */ "@resvg/resvg-js"
					);
					const rendered = await renderAsync(text, {
						fitTo: { mode: "width", value: resolvedWidth },
					});
					return {
						width: rendered.width,
						height: rendered.height,
						buffer: new Uint8Array(rendered.pixels),
					};
				}

				const blob = new Blob([text], { type: "image/svg+xml" });
				const url = URL.createObjectURL(blob);
				const img = new Image();
				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve();
					img.onerror = () =>
						reject(new Error(`Failed to load SVG image: ${src}`));
					img.src = url;
				});

				const canvas = new OffscreenCanvas(resolvedWidth, resolvedHeight);
				const c2d = canvas.getContext(
					"2d",
				) as unknown as OffscreenCanvasRenderingContext2D;
				c2d.drawImage(img, 0, 0, resolvedWidth, resolvedHeight);
				URL.revokeObjectURL(url);

				const bitmap = await createImageBitmap(canvas);
				return { width: resolvedWidth, height: resolvedHeight, bitmap };
			})();
			this.cache.set(key, promise);
			promise.catch(() => this.cache.delete(key));
		}
		return promise;
	}
}

export const svgLoader = new SvgLoader();

export async function drawSvgNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: SVGNodeProps,
): Promise<void> {
	const resolvedWidth = Math.max(1, Math.ceil(props.dstRect.width));
	const resolvedHeight = Math.max(1, Math.ceil(props.dstRect.height));
	const cacheKey = `${props.src}-${resolvedWidth}-${resolvedHeight}`;
	let tex = textureCache.acquire(cacheKey);

	if (!tex) {
		try {
			const data = await svgLoader.load(
				props.src,
				resolvedWidth,
				resolvedHeight,
				props.isHeadless ?? false,
			);

			// Check the cache again in case another concurrent render task already created and cached the texture!
			tex = textureCache.acquire(cacheKey);
			if (!tex) {
				tex = ctx.device.createTexture({
					size: [data.width, data.height],
					format: "rgba8unorm",
					usage:
						GPUTextureUsage.TEXTURE_BINDING |
						GPUTextureUsage.COPY_DST |
						GPUTextureUsage.RENDER_ATTACHMENT,
				});

				if (data.bitmap) {
					ctx.device.queue.copyExternalImageToTexture(
						{ source: data.bitmap },
						{ texture: tex },
						[data.width, data.height],
					);
				} else if (data.buffer) {
					ctx.device.queue.writeTexture(
						{ texture: tex },
						data.buffer,
						{ bytesPerRow: data.width * 4 },
						[data.width, data.height],
					);
				}

				textureCache.set(cacheKey, tex, ctx.device);
			}
		} catch (err) {
			console.error("Failed to load SVG texture:", err);
			return;
		}
	}

	ctx.renderer.drawTexture(pass, tex, props.dstRect, {
		opacity: props.opacity ?? 1,
		transform: props.matrix,
	});

	textureCache.release(cacheKey);
}
