export interface SurfaceProvider {
	readonly width: number;
	readonly height: number;
	readonly colorFormat: GPUTextureFormat;
	/** Current frame's render target view */
	getCurrentTextureView(): GPUTextureView;
	/** Current frame's render target texture */
	getCurrentTexture(): GPUTexture;
	/** Present / flush the frame (browser: swap chain; node: no-op) */
	present(): void;
	/** Read RGBA pixels back to CPU (node: staging buffer; browser: copyToBuffer) */
	readPixels(): Promise<Uint8ClampedArray>;
	destroy(): void;
}

export class BrowserSurfaceProvider implements SurfaceProvider {
	readonly colorFormat: GPUTextureFormat;
	private context: GPUCanvasContext;
	private device: GPUDevice;
	private canvas: HTMLCanvasElement;
	private renderTarget!: GPUTexture;
	private stagingBuffer: GPUBuffer | null = null;
	private stagingBufferSize = 0;

	constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
		this.device = device;
		this.canvas = canvas;
		this.colorFormat =
			typeof navigator !== "undefined" &&
			"gpu" in navigator &&
			navigator.gpu &&
			typeof (
				navigator.gpu as unknown as {
					getPreferredCanvasFormat: () => GPUTextureFormat;
				}
			).getPreferredCanvasFormat === "function"
				? (
						navigator.gpu as unknown as {
							getPreferredCanvasFormat: () => GPUTextureFormat;
						}
					).getPreferredCanvasFormat()
				: "rgba8unorm";
		this.context = canvas.getContext("webgpu") as unknown as GPUCanvasContext;
		this.context.configure({
			device,
			format: this.colorFormat,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.COPY_SRC |
				GPUTextureUsage.COPY_DST,
			alphaMode: "premultiplied",
		});
		this.checkRenderTarget();
	}

	private checkRenderTarget(): void {
		if (
			!this.renderTarget ||
			this.renderTarget.width !== this.canvas.width ||
			this.renderTarget.height !== this.canvas.height
		) {
			if (this.renderTarget) {
				const toDestroy = this.renderTarget;
				this.device.queue
					.onSubmittedWorkDone()
					.then(() => {
						try {
							toDestroy.destroy();
						} catch (_) {}
					})
					.catch(() => {});
			}
			this.renderTarget = this.device.createTexture({
				size: [this.canvas.width, this.canvas.height],
				format: this.colorFormat,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT |
					GPUTextureUsage.COPY_SRC |
					GPUTextureUsage.COPY_DST,
			});
			if (this.stagingBuffer) {
				try {
					this.stagingBuffer.destroy();
				} catch (_) {}
				this.stagingBuffer = null;
				this.stagingBufferSize = 0;
			}
		}
	}

	get width(): number {
		return this.canvas.width;
	}

	get height(): number {
		return this.canvas.height;
	}

	getCurrentTextureView(): GPUTextureView {
		this.checkRenderTarget();
		return this.renderTarget.createView();
	}

	getCurrentTexture(): GPUTexture {
		this.checkRenderTarget();
		return this.renderTarget;
	}

	present(): void {
		this.checkRenderTarget();
		try {
			const canvasTexture = this.context.getCurrentTexture();
			const encoder = this.device.createCommandEncoder();
			encoder.copyTextureToTexture(
				{ texture: this.renderTarget },
				{ texture: canvasTexture },
				[this.width, this.height],
			);
			this.device.queue.submit([encoder.finish()]);
		} catch (err) {
			console.warn(
				"Failed to copy render target to canvas context on present:",
				err,
			);
		}
	}

	async readPixels(): Promise<Uint8ClampedArray> {
		this.checkRenderTarget();
		const bytesPerPixel = 4;
		const unpaddedBytesPerRow = this.width * bytesPerPixel;
		const align = 256;
		const bytesPerRow = Math.ceil(unpaddedBytesPerRow / align) * align;
		const bufferSize = bytesPerRow * this.height;

		if (!this.stagingBuffer || this.stagingBufferSize !== bufferSize) {
			if (this.stagingBuffer) {
				try {
					this.stagingBuffer.destroy();
				} catch (_) {}
			}
			this.stagingBuffer = this.device.createBuffer({
				size: bufferSize,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			});
			this.stagingBufferSize = bufferSize;
		}

		const encoder = this.device.createCommandEncoder();
		encoder.copyTextureToBuffer(
			{ texture: this.renderTarget },
			{ buffer: this.stagingBuffer, bytesPerRow },
			[this.width, this.height],
		);
		this.device.queue.submit([encoder.finish()]);

		await this.stagingBuffer.mapAsync(GPUMapMode.READ);
		const mappedRange = this.stagingBuffer.getMappedRange();
		const data = new Uint8ClampedArray(unpaddedBytesPerRow * this.height);
		const sourceView = new Uint8Array(mappedRange);

		if (bytesPerRow === unpaddedBytesPerRow) {
			data.set(sourceView);
		} else {
			for (let y = 0; y < this.height; y++) {
				const srcOffset = y * bytesPerRow;
				const dstOffset = y * unpaddedBytesPerRow;
				data.set(
					sourceView.subarray(srcOffset, srcOffset + unpaddedBytesPerRow),
					dstOffset,
				);
			}
		}

		this.stagingBuffer.unmap();

		if (this.colorFormat === "bgra8unorm") {
			for (let i = 0; i < data.length; i += 4) {
				const r = data[i];
				data[i] = data[i + 2];
				data[i + 2] = r;
			}
		}

		return data;
	}

	destroy(): void {
		if (this.renderTarget) {
			try {
				this.renderTarget.destroy();
			} catch (_) {}
		}
		// In Dawn Node WebGPU / Electron, calling destroy() on a buffer that was mapped and unmapped
		// triggers a native C++ fatal assertion error (wgpu::binding::GPUBuffer::DetachMappings on detached ArrayBuffer).
		// We let GC collect the unmapped stagingBuffer instead of calling destroy() explicitly.
		this.stagingBuffer = null;
		this.stagingBufferSize = 0;
	}
}

export class NodeSurfaceProvider implements SurfaceProvider {
	readonly width: number;
	readonly height: number;
	readonly colorFormat: GPUTextureFormat = "rgba8unorm";
	private device: GPUDevice;
	private renderTarget: GPUTexture;
	private stagingBuffer: GPUBuffer;
	private bytesPerRow: number;
	private unpaddedBytesPerRow: number;

	constructor(device: GPUDevice, width: number, height: number) {
		this.device = device;
		this.width = width;
		this.height = height;

		this.renderTarget = device.createTexture({
			size: [width, height],
			format: this.colorFormat,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		const bytesPerPixel = 4;
		this.unpaddedBytesPerRow = width * bytesPerPixel;
		const align = 256;
		this.bytesPerRow = Math.ceil(this.unpaddedBytesPerRow / align) * align;
		const bufferSize = this.bytesPerRow * height;

		this.stagingBuffer = device.createBuffer({
			size: bufferSize,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
	}

	getCurrentTextureView(): GPUTextureView {
		return this.renderTarget.createView();
	}

	getCurrentTexture(): GPUTexture {
		return this.renderTarget;
	}

	present(): void {
		// no-op in node
	}

	async readPixels(): Promise<Uint8ClampedArray> {
		const encoder = this.device.createCommandEncoder();
		encoder.copyTextureToBuffer(
			{ texture: this.renderTarget },
			{ buffer: this.stagingBuffer, bytesPerRow: this.bytesPerRow },
			[this.width, this.height],
		);
		this.device.queue.submit([encoder.finish()]);

		await this.device.queue.onSubmittedWorkDone();

		await this.stagingBuffer.mapAsync(GPUMapMode.READ);
		const mappedRange = this.stagingBuffer.getMappedRange();
		const data = new Uint8ClampedArray(this.unpaddedBytesPerRow * this.height);
		const sourceView = new Uint8Array(mappedRange);

		if (this.bytesPerRow === this.unpaddedBytesPerRow) {
			data.set(sourceView);
		} else {
			for (let y = 0; y < this.height; y++) {
				const srcOffset = y * this.bytesPerRow;
				const dstOffset = y * this.unpaddedBytesPerRow;
				data.set(
					sourceView.subarray(srcOffset, srcOffset + this.unpaddedBytesPerRow),
					dstOffset,
				);
			}
		}

		this.stagingBuffer.unmap();
		return data;
	}

	destroy(): void {
		if (this.renderTarget) {
			try {
				this.renderTarget.destroy();
			} catch (_) {}
		}
		// In Dawn Node WebGPU / Electron, calling destroy() on a buffer that was mapped and unmapped
		// triggers a native C++ fatal assertion error (wgpu::binding::GPUBuffer::DetachMappings on detached ArrayBuffer).
		// We let GC collect the unmapped stagingBuffer instead of calling destroy() explicitly.
		this.stagingBuffer = null as any;
	}
}
