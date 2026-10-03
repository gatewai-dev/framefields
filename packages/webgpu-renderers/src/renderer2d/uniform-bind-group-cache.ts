/**
 * Caches GPUBindGroups for uniform buffers, keyed by GPUBuffer identity.
 *
 * BufferPool reuses the same GPUBuffer objects across frames (via reset()),
 * so bind groups remain valid. Uses WeakMap so entries are garbage-collected
 * when buffers are destroyed.
 */
export class UniformBindGroupCache {
	private cache = new WeakMap<GPUBuffer, GPUBindGroup>();

	getBindGroup(
		device: GPUDevice,
		layout: GPUBindGroupLayout,
		buffer: GPUBuffer,
	): GPUBindGroup {
		let bg = this.cache.get(buffer);
		if (!bg) {
			bg = device.createBindGroup({
				layout,
				entries: [{ binding: 0, resource: { buffer } }],
			});
			this.cache.set(buffer, bg);
		}
		return bg;
	}

	destroy(): void {
		this.cache = new WeakMap();
	}
}
