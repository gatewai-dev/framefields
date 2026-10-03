export class BufferPool {
	private buffers: GPUBuffer[] = [];
	private index = 0;
	private size: number;
	private usage: GPUBufferUsageFlags;

	constructor(size: number, usage: GPUBufferUsageFlags) {
		this.size = size;
		this.usage = usage;
	}

	getBuffer(device: GPUDevice, data: ArrayBufferView): GPUBuffer {
		const requiredSize = Math.max(this.size, data.byteLength);

		if (this.index >= this.buffers.length) {
			const buf = device.createBuffer({
				size: requiredSize,
				usage: this.usage,
			});
			this.buffers.push(buf);
		}

		let buf = this.buffers[this.index];
		if (buf.size < requiredSize) {
			const oldBuf = buf;
			device.queue.onSubmittedWorkDone().then(() => {
				try {
					oldBuf.destroy();
				} catch {}
			});
			buf = device.createBuffer({
				size: requiredSize,
				usage: this.usage,
			});
			this.buffers[this.index] = buf;
		}

		this.index++;
		device.queue.writeBuffer(buf, 0, data);
		return buf;
	}

	reset(): void {
		this.index = 0;
	}

	destroy(): void {
		for (const buf of this.buffers) {
			buf.destroy();
		}
		this.buffers = [];
	}
}
