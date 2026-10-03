export class TextureCache {
	private textures = new Map<string, GPUTexture>();
	private refs = new Map<string, number>();
	private lruMap = new Map<string, true>(); // insertion order = recency order
	public activeKeys = new Set<string>();

	acquire(key: string): GPUTexture | undefined {
		const tex = this.textures.get(key);
		if (tex) {
			const count = this.refs.get(key) ?? 0;
			this.refs.set(key, count + 1);
			this.updateLru(key);
		}
		return tex;
	}

	has(key: string): boolean {
		return this.textures.has(key);
	}

	hasPrefix(prefix: string): boolean {
		for (const key of this.textures.keys()) {
			if (key.startsWith(prefix)) return true;
		}
		return false;
	}

	contains(str: string): boolean {
		for (const key of this.textures.keys()) {
			if (key.includes(str)) return true;
		}
		return false;
	}

	set(key: string, tex: GPUTexture, device?: GPUDevice): void {
		if (this.textures.has(key)) {
			this.evict(key, device);
		}
		this.textures.set(key, tex);
		this.refs.set(key, 1);
		this.updateLru(key);
	}

	create(
		key: string,
		device: GPUDevice,
		width: number,
		height: number,
		format: GPUTextureFormat = "rgba8unorm",
	): GPUTexture {
		const tex = device.createTexture({
			size: [width, height],
			format,
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});
		this.set(key, tex, device);
		return tex;
	}

	release(key: string): void {
		const count = this.refs.get(key);
		if (count !== undefined && count > 0) {
			const nextCount = count - 1;
			this.refs.set(key, nextCount);
		}
	}

	evict(key: string, device?: GPUDevice): void {
		const tex = this.textures.get(key);
		if (tex) {
			try {
				if (device) {
					const toDestroy = tex;
					device.queue
						.onSubmittedWorkDone()
						.then(() => {
							try {
								toDestroy.destroy();
							} catch (_) {}
						})
						.catch(() => {});
				} else {
					tex.destroy();
				}
			} catch (_) {}
			this.textures.delete(key);
		}
		this.refs.delete(key);
		this.lruMap.delete(key);
	}

	prune(device?: GPUDevice, maxInactive = 30): void {
		// Count how many are inactive
		let inactiveCount = 0;
		for (const key of this.textures.keys()) {
			const count = this.refs.get(key) ?? 0;
			if (count === 0 && !this.activeKeys.has(key)) {
				inactiveCount++;
			}
		}

		// Evict least recently used inactive textures until inactiveCount <= maxInactive
		const lruKeys = Array.from(this.lruMap.keys());
		for (let i = lruKeys.length - 1; i >= 0; i--) {
			if (inactiveCount <= maxInactive) {
				break;
			}
			const key = lruKeys[i];
			const count = this.refs.get(key) ?? 0;
			if (count === 0 && !this.activeKeys.has(key)) {
				const tex = this.textures.get(key);
				if (tex) {
					try {
						if (device) {
							const toDestroy = tex;
							device.queue
								.onSubmittedWorkDone()
								.then(() => {
									try {
										toDestroy.destroy();
									} catch (_) {}
								})
								.catch(() => {});
						} else {
							tex.destroy();
						}
					} catch (_) {}
					this.textures.delete(key);
				}
				this.refs.delete(key);
				this.lruMap.delete(key);
				inactiveCount--;
			}
		}
	}

	private updateLru(key: string): void {
		this.lruMap.delete(key);
		this.lruMap.set(key, true);
	}

	destroy(): void {
		for (const [_, tex] of this.textures) {
			try {
				tex.destroy();
			} catch (_) {}
		}
		this.textures.clear();
		this.refs.clear();
		this.lruMap.clear();
	}
}

export const textureCache = new TextureCache();
