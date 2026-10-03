import type { Rect } from "./index.js";

export interface AtlasRegion {
	src: Rect;
}

export class TextAtlas {
	private device: GPUDevice;
	private texture: GPUTexture;
	private cache = new Map<string, AtlasRegion>();

	private currentX = 0;
	private currentY = 0;
	private rowHeight = 0;
	private atlasSize = 8192;

	constructor(device: GPUDevice) {
		this.device = device;
		this.texture = device.createTexture({
			size: [this.atlasSize, this.atlasSize],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});
	}

	get size(): number {
		return this.atlasSize;
	}

	get(key: string): AtlasRegion | undefined {
		return this.cache.get(key);
	}

	getTexture(): GPUTexture {
		return this.texture;
	}

	upload(key: string, canvas: OffscreenCanvas): AtlasRegion {
		const width = canvas.width;
		const height = canvas.height;

		if (width > this.atlasSize || height > this.atlasSize) {
			throw new Error("Text dimensions exceed atlas size");
		}

		if (this.currentX + width > this.atlasSize) {
			this.currentX = 0;
			this.currentY += this.rowHeight;
			this.rowHeight = 0;
		}

		if (this.currentY + height > this.atlasSize) {
			// Atlas is full, clear and reset
			this.currentX = 0;
			this.currentY = 0;
			this.rowHeight = 0;
			this.cache.clear();
		}

		this.rowHeight = Math.max(this.rowHeight, height);
		const region: Rect = {
			x: this.currentX,
			y: this.currentY,
			width,
			height,
		};
		this.currentX += width;

		try {
			this.device.queue.copyExternalImageToTexture(
				{ source: canvas as unknown as GPUCopyExternalImageSource },
				{
					texture: this.texture,
					origin: [region.x, region.y, 0],
					premultipliedAlpha: true,
				},
				[width, height],
			);
		} catch {
			const c2d = canvas.getContext(
				"2d",
			) as unknown as OffscreenCanvasRenderingContext2D;
			const imgData = c2d.getImageData(0, 0, width, height);
			this.device.queue.writeTexture(
				{ texture: this.texture, origin: [region.x, region.y, 0] },
				imgData.data,
				{ bytesPerRow: width * 4 },
				[width, height],
			);
		}

		const atlasRegion: AtlasRegion = { src: region };
		this.cache.set(key, atlasRegion);
		return atlasRegion;
	}

	destroy(): void {
		this.texture.destroy();
		this.cache.clear();
		this.currentX = 0;
		this.currentY = 0;
		this.rowHeight = 0;
	}
}
