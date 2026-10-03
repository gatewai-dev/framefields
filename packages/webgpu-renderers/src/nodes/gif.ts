import { decompressFrames, parseGIF } from "gifuct-js";
import type { RenderContextValue } from "../render-context.js";
import { textureCache } from "../texture-cache.js";
import type { GifNodeProps } from "./types.js";

export interface GifFrameData {
	buffer: Uint8Array;
	delayMs: number;
	startMs: number;
	endMs: number;
}

export interface GifTable {
	width: number;
	height: number;
	frames: GifFrameData[];
	totalMs: number;
}

class GifLoader {
	private cache = new Map<string, Promise<GifTable>>();

	async load(src: string): Promise<GifTable> {
		let promise = this.cache.get(src);
		if (!promise) {
			promise = (async () => {
				const res = await fetch(src);
				if (!res.ok) throw new Error(`Failed to fetch GIF: ${src}`);
				const buffer = await res.arrayBuffer();

				const gif = parseGIF(buffer);
				const rawFrames = decompressFrames(gif, true);

				if (rawFrames.length === 0) {
					throw new Error(`GIF has no frames: ${src}`);
				}

				const width = rawFrames[0].dims.width;
				const height = rawFrames[0].dims.height;
				const fullCanvasBuffer = new Uint8ClampedArray(width * height * 4);
				const frames: GifFrameData[] = [];
				let currentMs = 0;

				for (const rf of rawFrames) {
					const { dims, patch, delay } = rf;
					const delayMs = delay ?? 100;

					for (let y = 0; y < dims.height; y++) {
						for (let x = 0; x < dims.width; x++) {
							const patchIdx = (y * dims.width + x) * 4;
							const targetIdx = ((y + dims.top) * width + (x + dims.left)) * 4;
							if (patch[patchIdx + 3] > 0) {
								fullCanvasBuffer[targetIdx] = patch[patchIdx];
								fullCanvasBuffer[targetIdx + 1] = patch[patchIdx + 1];
								fullCanvasBuffer[targetIdx + 2] = patch[patchIdx + 2];
								fullCanvasBuffer[targetIdx + 3] = patch[patchIdx + 3];
							}
						}
					}

					frames.push({
						buffer: new Uint8Array(fullCanvasBuffer),
						delayMs,
						startMs: currentMs,
						endMs: currentMs + delayMs,
					});

					currentMs += delayMs;
				}

				return { width, height, frames, totalMs: currentMs };
			})();
			this.cache.set(src, promise);
			promise.catch(() => this.cache.delete(src));
		}
		return promise;
	}
}

export const gifLoader = new GifLoader();

export async function drawGifNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: GifNodeProps,
): Promise<void> {
	const table = await gifLoader.load(props.src);
	if (table.frames.length === 0) return;

	const elapsedMs = (props.frame / props.fps) * 1000;
	const loopedMs = table.totalMs > 0 ? elapsedMs % table.totalMs : 0;

	let targetFrame = table.frames[0];
	for (const f of table.frames) {
		if (loopedMs >= f.startMs && loopedMs < f.endMs) {
			targetFrame = f;
			break;
		}
	}

	const cacheKey = `${props.src}@@${props.frame}`;
	let tex = textureCache.acquire(cacheKey);

	if (!tex) {
		tex = ctx.device.createTexture({
			size: [table.width, table.height],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});

		ctx.device.queue.writeTexture(
			{ texture: tex },
			targetFrame.buffer,
			{ bytesPerRow: table.width * 4 },
			[table.width, table.height],
		);

		textureCache.set(cacheKey, tex, ctx.device);
	}

	ctx.renderer.drawTexture(pass, tex, props.dstRect, {
		opacity: props.opacity ?? 1,
		transform: props.matrix,
	});

	textureCache.release(cacheKey);
}
