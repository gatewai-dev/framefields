export class BindGroupCache {
	private cache = new WeakMap<
		GPUTexture,
		Map<GPUBindGroupLayout, GPUBindGroup>
	>();
	private dualCache = new WeakMap<
		GPUTexture,
		WeakMap<GPUTexture, Map<GPUBindGroupLayout, GPUBindGroup>>
	>();

	getBindGroup(
		device: GPUDevice,
		layout: GPUBindGroupLayout,
		texture: GPUTexture,
		sampler: GPUSampler,
	): GPUBindGroup {
		let layoutMap = this.cache.get(texture);
		if (!layoutMap) {
			layoutMap = new Map();
			this.cache.set(texture, layoutMap);
		}

		let bg = layoutMap.get(layout);
		if (!bg) {
			bg = device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: texture.createView() },
					{ binding: 1, resource: sampler },
				],
			});
			layoutMap.set(layout, bg);
		}
		return bg;
	}

	getCompositeBindGroup(
		device: GPUDevice,
		layout: GPUBindGroupLayout,
		baseTexture: GPUTexture,
		overlayTexture: GPUTexture,
		sampler: GPUSampler,
	): GPUBindGroup {
		let overlayWeakMap = this.dualCache.get(baseTexture);
		if (!overlayWeakMap) {
			overlayWeakMap = new WeakMap();
			this.dualCache.set(baseTexture, overlayWeakMap);
		}

		let layoutMap = overlayWeakMap.get(overlayTexture);
		if (!layoutMap) {
			layoutMap = new Map();
			overlayWeakMap.set(overlayTexture, layoutMap);
		}

		let bg = layoutMap.get(layout);
		if (!bg) {
			bg = device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: baseTexture.createView() },
					{ binding: 1, resource: overlayTexture.createView() },
					{ binding: 2, resource: sampler },
				],
			});
			layoutMap.set(layout, bg);
		}
		return bg;
	}

	destroy(): void {
		this.cache = new WeakMap();
		this.dualCache = new WeakMap();
	}
}
