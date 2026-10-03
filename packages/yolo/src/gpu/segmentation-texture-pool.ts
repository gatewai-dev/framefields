export interface SegmentationTextureOptions {
	readonly width: number;
	readonly height: number;
	readonly format?: "r8unorm" | "rgba8unorm";
	readonly label?: string;
}

export class SegmentationTexturePool {
	private device: GPUDevice;
	private pool = new Map<string, GPUTexture>();

	constructor(device: GPUDevice) {
		this.device = device;
	}

	public getOrCreateTexture(
		key: string,
		options: SegmentationTextureOptions,
	): GPUTexture {
		const existing = this.pool.get(key);
		if (
			existing &&
			existing.width === options.width &&
			existing.height === options.height
		) {
			return existing;
		}

		if (existing) {
			existing.destroy();
		}

		const format = options.format ?? "rgba8unorm";
		const texture = this.device.createTexture({
			label: options.label ?? `Yolo_Segmentation_${key}`,
			size: [options.width, options.height, 1],
			format,
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.pool.set(key, texture);
		return texture;
	}

	public uploadMask(
		key: string,
		maskData: Uint8Array | Float32Array,
		width: number,
		height: number,
	): GPUTexture {
		const isRgba = maskData.length >= width * height * 4;
		const format = isRgba ? "rgba8unorm" : "r8unorm";
		const texture = this.getOrCreateTexture(key, { width, height, format });

		let uploadBytes: Uint8Array;
		if (maskData instanceof Float32Array) {
			uploadBytes = new Uint8Array(maskData.length);
			for (let i = 0; i < maskData.length; i++) {
				uploadBytes[i] = Math.round(
					Math.max(0, Math.min(1, maskData[i])) * 255,
				);
			}
		} else {
			uploadBytes = maskData;
		}

		const bytesPerPixel = isRgba ? 4 : 1;
		const bytesPerRow = width * bytesPerPixel;
		const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;

		let finalBuffer: Uint8Array;
		if (alignedBytesPerRow === bytesPerRow) {
			finalBuffer = uploadBytes;
		} else {
			finalBuffer = new Uint8Array(alignedBytesPerRow * height);
			for (let y = 0; y < height; y++) {
				finalBuffer.set(
					uploadBytes.subarray(y * bytesPerRow, (y + 1) * bytesPerRow),
					y * alignedBytesPerRow,
				);
			}
		}

		this.device.queue.writeTexture(
			{ texture },
			finalBuffer.buffer,
			{
				offset: finalBuffer.byteOffset,
				bytesPerRow: alignedBytesPerRow,
				rowsPerImage: height,
			},
			{ width, height },
		);

		return texture;
	}

	public destroy(): void {
		for (const tex of this.pool.values()) {
			tex.destroy();
		}
		this.pool.clear();
	}
}
