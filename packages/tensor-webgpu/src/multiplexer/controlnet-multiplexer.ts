import type {
	ControlNetConditioningOutputs,
	TensorViewExport,
} from "../types.js";

export class ControlNetMultiplexer {
	private textures = new Map<keyof ControlNetConditioningOutputs, GPUTexture>();

	public set(
		type: keyof ControlNetConditioningOutputs,
		texture: GPUTexture,
	): void {
		this.textures.set(type, texture);
	}

	public get(
		type: keyof ControlNetConditioningOutputs,
	): GPUTexture | undefined {
		return this.textures.get(type);
	}

	public has(type: keyof ControlNetConditioningOutputs): boolean {
		return this.textures.has(type);
	}

	public getOutputs(): ControlNetConditioningOutputs {
		return {
			canny: this.textures.get("canny"),
			depth: this.textures.get("depth"),
			normals: this.textures.get("normals"),
			poseSkeleton: this.textures.get("poseSkeleton"),
			segmentationMask: this.textures.get("segmentationMask"),
			faceLandmarks: this.textures.get("faceLandmarks"),
			motionVectors: this.textures.get("motionVectors"),
			deflickered: this.textures.get("deflickered"),
		};
	}

	public createBindGroupEntry(
		type: keyof ControlNetConditioningOutputs,
		bindingIndex: number,
	): GPUBindGroupEntry {
		const tex = this.textures.get(type);
		if (!tex) {
			throw new Error(
				`[ControlNetMultiplexer] Cannot create bind group entry: conditioning texture "${type}" is not registered in VRAM.`,
			);
		}
		return {
			binding: bindingIndex,
			resource: tex.createView({ label: `controlnet_${type}_view` }),
		};
	}

	public exportTensorView(
		type: keyof ControlNetConditioningOutputs,
	): TensorViewExport {
		const tex = this.textures.get(type);
		if (!tex) {
			throw new Error(
				`[ControlNetMultiplexer] Conditioning tensor "${type}" not found in multiplexer.`,
			);
		}
		return {
			texture: tex,
			width: tex.width,
			height: tex.height,
			format: tex.format,
		};
	}

	public async readPixelsAsync(
		device: GPUDevice,
		type: keyof ControlNetConditioningOutputs,
	): Promise<{
		width: number;
		height: number;
		format: GPUTextureFormat;
		data: Uint8Array;
	}> {
		const tex = this.textures.get(type);
		if (!tex) {
			throw new Error(
				`[ControlNetMultiplexer] Cannot read pixels: conditioning texture "${type}" is missing.`,
			);
		}

		const width = tex.width;
		const height = tex.height;
		const format = tex.format;

		// Compute bytes per row aligned to 256 bytes (WebGPU constraint)
		let bytesPerPixel = 4;
		if (format === "rgba16float" || format === "rg32float") {
			bytesPerPixel = 8;
		} else if (format === "r32float") {
			bytesPerPixel = 4;
		} else if (format === "rgba32float") {
			bytesPerPixel = 16;
		}

		const unalignedBytesPerRow = width * bytesPerPixel;
		const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
		const bufferSize = bytesPerRow * height;

		const stagingBuffer = device.createBuffer({
			size: bufferSize,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
			label: `controlnet_readback_staging_${type}`,
		});

		const encoder = device.createCommandEncoder({
			label: `readback_encoder_${type}`,
		});
		encoder.copyTextureToBuffer(
			{ texture: tex },
			{ buffer: stagingBuffer, bytesPerRow, rowsPerImage: height },
			[width, height, 1],
		);
		device.queue.submit([encoder.finish()]);

		await stagingBuffer.mapAsync(GPUMapMode.READ);
		const mappedRange = stagingBuffer.getMappedRange();

		// Strip padding if bytesPerRow > unalignedBytesPerRow
		const resultData = new Uint8Array(width * height * bytesPerPixel);
		const sourceBytes = new Uint8Array(mappedRange);

		if (bytesPerRow === unalignedBytesPerRow) {
			resultData.set(sourceBytes.subarray(0, width * height * bytesPerPixel));
		} else {
			for (let y = 0; y < height; y++) {
				const srcOffset = y * bytesPerRow;
				const dstOffset = y * unalignedBytesPerRow;
				resultData.set(
					sourceBytes.subarray(srcOffset, srcOffset + unalignedBytesPerRow),
					dstOffset,
				);
			}
		}

		stagingBuffer.unmap();
		stagingBuffer.destroy();

		return {
			width,
			height,
			format,
			data: resultData,
		};
	}

	public destroy(): void {
		for (const tex of this.textures.values()) {
			try {
				tex.destroy();
			} catch (_) {}
		}
		this.textures.clear();
	}
}
