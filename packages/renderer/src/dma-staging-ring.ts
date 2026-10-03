import {
	type VideoColorPrimaries,
	VideoFrame,
	type VideoMatrixCoefficients,
	type VideoTransferCharacteristics,
} from "@napi-rs/webcodecs";

export type StagingSlotStatus = "idle" | "rendering" | "mapping" | "mapped";

export interface VideoColorSpaceConfig {
	readonly primaries?: VideoColorPrimaries;
	readonly transfer?: VideoTransferCharacteristics;
	readonly matrix?: VideoMatrixCoefficients;
	readonly fullRange?: boolean;
}

export interface DmaStagingRingOptions {
	readonly width: number;
	readonly height: number;
	readonly capacity?: number;
	readonly format?: GPUTextureFormat;
}

export interface StagingSlotInfo {
	readonly index: number;
	readonly status: StagingSlotStatus;
	readonly inFlightFrame: number | null;
}

interface StagingSlot {
	readonly index: number;
	readonly buffer: GPUBuffer;
	status: StagingSlotStatus;
	inFlightFrame: number | null;
	mapPromise: Promise<void> | null;
}

/**
 * Pipelined Asynchronous DMA Staging Ring for WebGPU.
 *
 * Implements double-buffered (or N-buffered) GPU staging buffers to overlap
 * GPU render passes with asynchronous DMA host transfers and WebCodecs hardware encoding.
 * Eliminates GPU stalls by allowing Frame i+1 to execute on the GPU while Frame i
 * is asynchronously mapped and consumed by the hardware video encoder.
 */
export class DmaStagingRing {
	readonly width: number;
	readonly height: number;
	readonly capacity: number;
	readonly bytesPerRow: number;
	readonly unpaddedBytesPerRow: number;
	readonly bufferSize: number;
	readonly format: GPUTextureFormat;

	readonly device: GPUDevice;
	private readonly slots: StagingSlot[];
	private isDestroyed = false;

	constructor(device: GPUDevice, options: DmaStagingRingOptions) {
		this.device = device;
		this.width = options.width;
		this.height = options.height;
		this.capacity = Math.max(2, options.capacity ?? 2);
		this.format = options.format ?? "rgba8unorm";

		const bytesPerPixel = 4;
		this.unpaddedBytesPerRow = this.width * bytesPerPixel;
		const rowAlignment = 256;
		this.bytesPerRow =
			Math.ceil(this.unpaddedBytesPerRow / rowAlignment) * rowAlignment;
		this.bufferSize = this.bytesPerRow * this.height;

		this.slots = [];
		for (let i = 0; i < this.capacity; i++) {
			const buffer = device.createBuffer({
				size: this.bufferSize,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			});
			this.slots.push({
				index: i,
				buffer,
				status: "idle",
				inFlightFrame: null,
				mapPromise: null,
			});
		}
	}

	/**
	 * Prepares the staging buffer slot for writing by ensuring any prior mapping
	 * from a previous cycle has been completed and unmapped.
	 */
	async prepareSlot(frameIndex: number): Promise<void> {
		this.checkDestroyed();
		const slot = this.slots[frameIndex % this.capacity];
		if (!slot) return;

		if (slot.status === "mapping" && slot.mapPromise) {
			await slot.mapPromise;
		}

		if (slot.status === "mapped") {
			slot.buffer.unmap();
			slot.status = "idle";
			slot.inFlightFrame = null;
			slot.mapPromise = null;
		}
	}

	/**
	 * Records a GPU-to-buffer DMA copy command into the provided command encoder.
	 */
	stageTexture(
		encoder: GPUCommandEncoder,
		texture: GPUTexture,
		frameIndex: number,
	): void {
		this.checkDestroyed();
		const slot = this.slots[frameIndex % this.capacity];
		if (!slot) {
			throw new Error(`Invalid slot index for frame ${frameIndex}`);
		}

		if (slot.status === "mapped" || slot.status === "mapping") {
			throw new Error(
				`Staging buffer slot ${slot.index} is busy (status: ${slot.status}) for frame ${frameIndex}. Call prepareSlot() before staging.`,
			);
		}

		encoder.copyTextureToBuffer(
			{ texture },
			{ buffer: slot.buffer, bytesPerRow: this.bytesPerRow },
			[this.width, this.height],
		);

		slot.status = "rendering";
		slot.inFlightFrame = frameIndex;
	}

	/**
	 * Initiates asynchronous DMA mapping on the slot for the specified frame.
	 * Must be called immediately after submitting the command encoder to the device queue.
	 */
	scheduleMap(frameIndex: number): Promise<void> {
		this.checkDestroyed();
		const slot = this.slots[frameIndex % this.capacity];
		if (!slot) {
			throw new Error(`Invalid slot index for frame ${frameIndex}`);
		}

		slot.status = "mapping";
		const mapPromise = slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
			slot.status = "mapped";
		});
		slot.mapPromise = mapPromise;
		return mapPromise;
	}

	/**
	 * Awaits asynchronous mapping and extracts pixels into a tightly packed Uint8Array.
	 * The slot remains in the "mapped" state until releaseFrame() is called.
	 */
	async readFramePixels(frameIndex: number): Promise<Uint8Array> {
		this.checkDestroyed();
		const slot = this.slots[frameIndex % this.capacity];
		if (!slot) {
			throw new Error(`Invalid slot index for frame ${frameIndex}`);
		}

		if (slot.mapPromise) {
			await slot.mapPromise;
		}

		if (slot.status !== "mapped") {
			throw new Error(
				`Staging slot ${slot.index} is not mapped (status: ${slot.status}) for frame ${frameIndex}`,
			);
		}

		const mappedRange = slot.buffer.getMappedRange();
		const sourceView = new Uint8Array(mappedRange);
		const output = new Uint8Array(this.unpaddedBytesPerRow * this.height);

		if (this.bytesPerRow === this.unpaddedBytesPerRow) {
			output.set(sourceView);
		} else {
			for (let y = 0; y < this.height; y++) {
				const srcOffset = y * this.bytesPerRow;
				const dstOffset = y * this.unpaddedBytesPerRow;
				output.set(
					sourceView.subarray(srcOffset, srcOffset + this.unpaddedBytesPerRow),
					dstOffset,
				);
			}
		}

		return output;
	}

	/**
	 * Awaits asynchronous mapping, extracts pixels, and immediately unmaps the staging buffer,
	 * returning the slot to "idle" state so it can be reused immediately.
	 */
	async readAndReleaseFrame(frameIndex: number): Promise<Uint8Array> {
		const pixels = await this.readFramePixels(frameIndex);
		this.releaseFrame(frameIndex);
		return pixels;
	}

	/**
	 * Directly reads the mapped staging buffer into a WebCodecs VideoFrame,
	 * bypassing redundant intermediate JS allocations when row pitches align,
	 * and immediately unmaps the buffer.
	 */
	async readFrameToVideoFrame(
		frameIndex: number,
		timestampUs: number,
		colorSpace?: VideoColorSpaceConfig,
		/** Sees the tightly packed RGBA pixels while they are mapped; must not keep them. */
		inspect?: (rgba: Uint8Array) => void,
	): Promise<VideoFrame> {
		this.checkDestroyed();
		const slot = this.slots[frameIndex % this.capacity];
		if (!slot) {
			throw new Error(`Invalid slot index for frame ${frameIndex}`);
		}

		if (slot.mapPromise) {
			await slot.mapPromise;
		}

		if (slot.status !== "mapped") {
			throw new Error(
				`Staging slot ${slot.index} is not mapped (status: ${slot.status}) for frame ${frameIndex}`,
			);
		}

		const mappedRange = slot.buffer.getMappedRange();
		const sourceView = new Uint8Array(mappedRange);

		let pixelData: Uint8Array;
		if (this.bytesPerRow === this.unpaddedBytesPerRow) {
			pixelData = sourceView;
		} else {
			pixelData = new Uint8Array(this.unpaddedBytesPerRow * this.height);
			for (let y = 0; y < this.height; y++) {
				const srcOffset = y * this.bytesPerRow;
				const dstOffset = y * this.unpaddedBytesPerRow;
				pixelData.set(
					sourceView.subarray(srcOffset, srcOffset + this.unpaddedBytesPerRow),
					dstOffset,
				);
			}
		}

		inspect?.(pixelData);

		const vf = new VideoFrame(pixelData, {
			format: "RGBA",
			codedWidth: this.width,
			codedHeight: this.height,
			timestamp: timestampUs,
			colorSpace: {
				primaries: colorSpace?.primaries ?? "bt709",
				transfer: colorSpace?.transfer ?? "bt709",
				matrix: colorSpace?.matrix ?? "bt709",
				fullRange: colorSpace?.fullRange ?? false,
			},
		});

		this.releaseFrame(frameIndex);
		return vf;
	}

	/**
	 * Unmaps the staging buffer for the specified frame and marks the slot idle.
	 */
	releaseFrame(frameIndex: number): void {
		const slot = this.slots[frameIndex % this.capacity];
		if (!slot) return;

		if (slot.status === "mapped") {
			try {
				slot.buffer.unmap();
			} catch (_) {}
			slot.status = "idle";
			slot.inFlightFrame = null;
			slot.mapPromise = null;
		}
	}

	/**
	 * Returns current status info for each slot in the ring.
	 */
	getSlotInfos(): readonly StagingSlotInfo[] {
		return this.slots.map((slot) => ({
			index: slot.index,
			status: slot.status,
			inFlightFrame: slot.inFlightFrame,
		}));
	}

	/**
	 * Destroys all staging buffers and releases resources.
	 */
	destroy(): void {
		if (this.isDestroyed) return;
		this.isDestroyed = true;

		for (const slot of this.slots) {
			if (slot.status === "mapped") {
				try {
					slot.buffer.unmap();
				} catch (_) {}
			}
			slot.status = "idle";
			slot.inFlightFrame = null;
			slot.mapPromise = null;
		}
		this.slots.length = 0;
	}

	private checkDestroyed(): void {
		if (this.isDestroyed) {
			throw new Error("DmaStagingRing has been destroyed");
		}
	}
}
