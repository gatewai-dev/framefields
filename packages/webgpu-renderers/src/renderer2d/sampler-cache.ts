export interface SamplerDescriptor {
	magFilter?: GPUFilterMode;
	minFilter?: GPUFilterMode;
	mipmapFilter?: GPUMipmapFilterMode;
	addressModeU?: GPUAddressMode;
	addressModeV?: GPUAddressMode;
	maxAnisotropy?: number;
}

export class SamplerCache {
	private samplers = new Map<string, GPUSampler>();
	private lru: string[] = [];
	private maxCapacity: number;

	constructor(maxCapacity = 32) {
		this.maxCapacity = maxCapacity;
	}

	getSampler(device: GPUDevice, desc: SamplerDescriptor = {}): GPUSampler {
		const maxAnisotropy = Math.max(1, Math.min(16, desc.maxAnisotropy ?? 4));
		const key = `${desc.magFilter ?? "linear"}:${desc.minFilter ?? "linear"}:${desc.mipmapFilter ?? "linear"}:${desc.addressModeU ?? "clamp-to-edge"}:${desc.addressModeV ?? "clamp-to-edge"}:${maxAnisotropy}`;

		let sampler = this.samplers.get(key);
		if (!sampler) {
			sampler = device.createSampler({
				magFilter: desc.magFilter ?? "linear",
				minFilter: desc.minFilter ?? "linear",
				mipmapFilter: desc.mipmapFilter ?? "linear",
				addressModeU: desc.addressModeU ?? "clamp-to-edge",
				addressModeV: desc.addressModeV ?? "clamp-to-edge",
				maxAnisotropy,
			});

			if (this.samplers.size >= this.maxCapacity) {
				const evictKey = this.lru.pop();
				if (evictKey) {
					this.samplers.delete(evictKey);
				}
			}

			this.samplers.set(key, sampler);
		} else {
			this.lru = this.lru.filter((k) => k !== key);
		}

		this.lru.unshift(key);
		return sampler;
	}

	destroy(): void {
		this.samplers.clear();
		this.lru = [];
	}
}
