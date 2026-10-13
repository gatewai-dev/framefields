import { toLocalPath } from "../local-path.js";
import type { RenderContextValue } from "../render-context.js";
import { textureCache } from "../texture-cache.js";
import { createImageTexture } from "./image-texture.js";
import type { ImageNodeProps } from "./types.js";

interface LoadedImageData {
	width: number;
	height: number;
	bitmap?: ImageBitmap;
	buffer?: Uint8Array;
}

class ImageLoader {
	private pending = new Map<string, Promise<LoadedImageData>>();

	async load(src: string, isHeadless: boolean): Promise<LoadedImageData> {
		const key = `${src}-${isHeadless}`;
		let promise = this.pending.get(key);
		if (!promise) {
			promise = (async () => {
				let arrayBuffer: ArrayBuffer;
				const isRemote =
					src.startsWith("http://") ||
					src.startsWith("https://") ||
					src.startsWith("data:");

				if (isRemote || !isHeadless) {
					const response = await fetch(src);
					if (!response.ok) {
						throw new Error(`Failed to fetch image: ${src}`);
					}
					arrayBuffer = await response.arrayBuffer();
				} else {
					// Local filesystem file in headless Node.js
					const filePath = (await toLocalPath(src)) ?? src;
					const fs = await import(/* webpackIgnore: true */ "fs/promises");
					const fileBuf = await fs.readFile(filePath);
					arrayBuffer = fileBuf.buffer.slice(
						fileBuf.byteOffset,
						fileBuf.byteOffset + fileBuf.byteLength,
					);
				}

				if (isHeadless) {
					const sharp = (await import(/* webpackIgnore: true */ "sharp"))
						.default;
					const { data, info } = await sharp(Buffer.from(arrayBuffer))
						.ensureAlpha()
						.raw()
						.toBuffer({ resolveWithObject: true });
					return {
						width: info.width,
						height: info.height,
						buffer: new Uint8Array(data),
					};
				}

				const blob = new Blob([arrayBuffer]);
				const bitmap = await createImageBitmap(blob);
				return { width: bitmap.width, height: bitmap.height, bitmap };
			})();
			this.pending.set(key, promise);
			promise.catch((err) => {
				this.pending.delete(key);
				console.error(`Failed to load image texture from ${src}:`, err);
			});
		}
		return promise;
	}
}

export const imageLoader = new ImageLoader();

export async function drawImageNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: ImageNodeProps,
): Promise<void> {
	let tex = textureCache.acquire(props.src);

	if (!tex) {
		try {
			const isHeadless =
				props.isHeadless ??
				(typeof window === "undefined" ||
					(globalThis as any).__IS_HEADLESS_RENDERER__);
			const data = await imageLoader.load(props.src, isHeadless);

			// Check the cache again in case another concurrent render task already created and cached the texture!
			tex = textureCache.acquire(props.src);
			if (!tex) {
				tex = createImageTexture(ctx.device, data);

				textureCache.set(props.src, tex, ctx.device);
			}
		} catch (err) {
			console.error("Failed to load image texture:", err);
			return;
		}
	}

	ctx.renderer.drawTexture(pass, tex, props.dstRect, {
		opacity: props.opacity ?? 1,
		transform: props.matrix,
	});

	textureCache.release(props.src);
}
