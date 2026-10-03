export interface GPUModelLut {
	texture: GPUTexture;
	type: "1D" | "3D";
	size: number;
	vertexBuffer: GPUBuffer;
	vertexCount: number;
}

export interface RawLutData {
	points: Array<[number, number, number]>;
	size: number;
	type: "1D" | "3D";
}

export class LutStore {
	private deviceCaches = new WeakMap<GPUDevice, Map<string, GPUModelLut>>();
	private devicePromises = new WeakMap<
		GPUDevice,
		Map<string, Promise<GPUModelLut>>
	>();
	private rawDataCache = new Map<string, RawLutData>();
	private rawDataPromises = new Map<
		string,
		{
			promise: Promise<RawLutData>;
			resolve: (data: RawLutData) => void;
			reject: (err: any) => void;
		}
	>();
	private listeners = new Set<(key: string) => void>();

	onChange(listener: (key: string) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(key: string): void {
		for (const listener of this.listeners) {
			try {
				listener(key);
			} catch {}
		}
	}

	getAnyMatching(prefix: string, device: GPUDevice): GPUModelLut | undefined {
		const cache = this.getCache(device);
		const keys = Array.from(cache.keys());
		for (let i = keys.length - 1; i >= 0; i--) {
			const key = keys[i];
			if (key.startsWith(prefix)) {
				return cache.get(key);
			}
		}
		return undefined;
	}

	private getOrCreateRawDataPromise(key: string) {
		let deferred = this.rawDataPromises.get(key);
		if (!deferred) {
			let resolve!: (data: RawLutData) => void;
			let reject!: (err: any) => void;
			const promise = new Promise<RawLutData>((res, rej) => {
				resolve = res;
				reject = rej;
			});
			deferred = { promise, resolve, reject };
			this.rawDataPromises.set(key, deferred);
		}
		return deferred;
	}

	rejectRawDataPromise(key: string, error: any): void {
		const deferred = this.rawDataPromises.get(key);
		if (deferred) {
			deferred.reject(error);
			this.rawDataPromises.delete(key);
		}
		this.emit(key);
	}

	private getCache(device: GPUDevice): Map<string, GPUModelLut> {
		let cache = this.deviceCaches.get(device);
		if (!cache) {
			cache = new Map();
			this.deviceCaches.set(device, cache);
		}
		return cache;
	}

	private getPromises(device: GPUDevice): Map<string, Promise<GPUModelLut>> {
		let promises = this.devicePromises.get(device);
		if (!promises) {
			promises = new Map();
			this.devicePromises.set(device, promises);
		}
		return promises;
	}

	get(key: string, device: GPUDevice): GPUModelLut | undefined {
		return this.getCache(device).get(key);
	}

	set(key: string, device: GPUDevice, lut: GPUModelLut): void {
		const cache = this.getCache(device);
		const existing = cache.get(key);
		if (existing && existing !== lut) {
			if (existing.texture !== lut.texture) {
				const oldTex = existing.texture;
				device.queue
					.onSubmittedWorkDone()
					.then(() => {
						try {
							oldTex.destroy();
						} catch {}
					})
					.catch(() => {});
			}
			if (existing.vertexBuffer !== lut.vertexBuffer) {
				const oldBuf = existing.vertexBuffer;
				device.queue
					.onSubmittedWorkDone()
					.then(() => {
						try {
							oldBuf.destroy();
						} catch {}
					})
					.catch(() => {});
			}
		}
		cache.set(key, lut);
	}

	/** Get cached raw (device-independent) data for a key. */
	getRawData(key: string): RawLutData | undefined {
		return this.rawDataCache.get(key);
	}

	/** Get any available raw LUT data from cache. */
	getAnyRawData(): RawLutData | undefined {
		const values = Array.from(this.rawDataCache.values());
		return values[values.length - 1];
	}

	createOrUpdate(
		key: string,
		device: GPUDevice,
		points: Array<[number, number, number]>,
		size: number,
		type: "1D" | "3D",
	): GPUModelLut {
		const raw: RawLutData = { points, size, type };
		// Cache raw data so any device can rebuild GPU resources from it
		this.rawDataCache.set(key, raw);

		const deferred = this.rawDataPromises.get(key);
		if (deferred) {
			deferred.resolve(raw);
			this.rawDataPromises.delete(key);
		}
		// Build vertex data for the point cloud visualization
		const vertices: number[] = [];
		if (type === "3D") {
			let index = 0;
			for (let b = 0; b < size; b++) {
				for (let g = 0; g < size; g++) {
					for (let r = 0; r < size; r++) {
						const inR = r / (size - 1 || 1);
						const inG = g / (size - 1 || 1);
						const inB = b / (size - 1 || 1);
						const outColor = points[index] || [inR, inG, inB];
						index++;
						vertices.push(inR - 0.5, inG - 0.5, inB - 0.5);
						vertices.push(outColor[0], outColor[1], outColor[2]);
					}
				}
			}
		} else {
			for (let i = 0; i < points.length; i++) {
				const inVal = i / (points.length - 1 || 1);
				const outColor = points[i];
				vertices.push(inVal - 0.5, 0.0, 0.0);
				vertices.push(outColor[0], outColor[1], outColor[2]);
			}
		}
		const vertexData = new Float32Array(vertices);

		const existing = this.get(key, device);

		// If texture size/type changed or doesn't exist, create a new one
		let texture = existing?.texture;
		if (!texture || existing?.size !== size || existing?.type !== type) {
			if (existing) {
				const oldTex = existing.texture;
				device.queue
					.onSubmittedWorkDone()
					.then(() => {
						try {
							oldTex.destroy();
						} catch {}
					})
					.catch(() => {});
			}
			if (type === "3D") {
				texture = device.createTexture({
					size: [size, size, size],
					dimension: "3d",
					format: "rgba8unorm",
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
				});
			} else {
				texture = device.createTexture({
					size: [size, 1, 1],
					dimension: "1d",
					format: "rgba8unorm",
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
				});
			}
		}

		// Write color mapping values to GPU texture
		if (type === "3D") {
			const bytesPerPixel = 4;
			const bytesPerRowPadded = Math.ceil((size * bytesPerPixel) / 256) * 256;
			const data = new Uint8Array(bytesPerRowPadded * size * size);
			let index = 0;
			for (let b = 0; b < size; b++) {
				for (let g = 0; g < size; g++) {
					for (let r = 0; r < size; r++) {
						const inR = r / (size - 1 || 1);
						const inG = g / (size - 1 || 1);
						const inB = b / (size - 1 || 1);
						const outColor = points[index] || [inR, inG, inB];
						index++;

						const dstIdx =
							r * bytesPerPixel +
							g * bytesPerRowPadded +
							b * bytesPerRowPadded * size;
						data[dstIdx] = Math.max(
							0,
							Math.min(255, Math.round(outColor[0] * 255)),
						);
						data[dstIdx + 1] = Math.max(
							0,
							Math.min(255, Math.round(outColor[1] * 255)),
						);
						data[dstIdx + 2] = Math.max(
							0,
							Math.min(255, Math.round(outColor[2] * 255)),
						);
						data[dstIdx + 3] = 255;
					}
				}
			}
			device.queue.writeTexture(
				{ texture },
				data,
				{
					bytesPerRow: bytesPerRowPadded,
					rowsPerImage: size,
				},
				[size, size, size],
			);
		} else {
			const bytesPerPixel = 4;
			const data = new Uint8Array(size * bytesPerPixel);
			for (let i = 0; i < size; i++) {
				const outColor = points[i] || [i / (size - 1 || 1), 0, 0];
				const idx = i * bytesPerPixel;
				data[idx] = Math.max(0, Math.min(255, Math.round(outColor[0] * 255)));
				data[idx + 1] = Math.max(
					0,
					Math.min(255, Math.round(outColor[1] * 255)),
				);
				data[idx + 2] = Math.max(
					0,
					Math.min(255, Math.round(outColor[2] * 255)),
				);
				data[idx + 3] = 255;
			}
			device.queue.writeTexture({ texture }, data, {}, [size, 1, 1]);
		}

		// Create/update vertex buffer
		let vertexBuffer = existing?.vertexBuffer;
		if (!vertexBuffer || vertexBuffer.size < vertexData.byteLength) {
			if (existing) {
				const oldBuf = existing.vertexBuffer;
				device.queue
					.onSubmittedWorkDone()
					.then(() => {
						try {
							oldBuf.destroy();
						} catch {}
					})
					.catch(() => {});
			}
			vertexBuffer = device.createBuffer({
				size: vertexData.byteLength,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			});
		}
		device.queue.writeBuffer(vertexBuffer, 0, vertexData);

		const lut: GPUModelLut = {
			texture,
			type,
			size,
			vertexBuffer,
			vertexCount: points.length,
		};

		this.set(key, device, lut);
		this.emit(key);
		return lut;
	}

	async getOrLoad(
		src: string,
		device: GPUDevice,
		signal?: AbortSignal,
	): Promise<GPUModelLut> {
		if (signal?.aborted) {
			throw new DOMException("The operation was aborted.", "AbortError");
		}

		const cached = this.get(src, device);
		if (cached) return cached;

		// If raw data was already extracted (e.g. by ExtractLUT on another device),
		// rebuild GPU resources for this device without fetching.
		const raw = this.rawDataCache.get(src);
		if (raw) {
			return this.createOrUpdate(src, device, raw.points, raw.size, raw.type);
		}

		const promises = this.getPromises(device);
		let promise = promises.get(src);
		if (!promise) {
			promise = (async () => {
				if (src.startsWith("runtime://")) {
					const deferred = this.getOrCreateRawDataPromise(src);
					let timeoutId: any;
					const timeoutPromise = new Promise<never>((_, reject) => {
						const checkTimeout = () => {
							timeoutId = setTimeout(() => {
								const isImgOrVidLoading = () => {
									if (typeof window !== "undefined") {
										const rendererHandles = (window as any)
											.renderer_delayRenderHandles;
										if (
											Array.isArray(rendererHandles) &&
											rendererHandles.length > 0
										) {
											return true;
										}
									}
									if (typeof globalThis !== "undefined") {
										const gatewaiDelays = (globalThis as any)
											.__GATEWAI_DELAYS__;
										if (
											gatewaiDelays instanceof Set &&
											gatewaiDelays.size > 0
										) {
											return true;
										}
									}
									return false;
								};

								if (isImgOrVidLoading()) {
									checkTimeout();
								} else {
									reject(
										new Error(
											`Timeout waiting for runtime LUT "${src}" after 5000ms.`,
										),
									);
								}
							}, 5000);
						};
						checkTimeout();
					});

					let onAbort: (() => void) | undefined;
					let abortPromise: Promise<never> | undefined;
					if (signal) {
						abortPromise = new Promise<never>((_, reject) => {
							onAbort = () => {
								reject(
									new DOMException("The operation was aborted.", "AbortError"),
								);
							};
							signal.addEventListener("abort", onAbort);
						});
					}

					try {
						const promisesToRace = [deferred.promise, timeoutPromise];
						if (abortPromise) {
							promisesToRace.push(abortPromise);
						}
						const result = await Promise.race(promisesToRace);
						return this.createOrUpdate(
							src,
							device,
							result.points,
							result.size,
							result.type,
						);
					} finally {
						clearTimeout(timeoutId);
						if (onAbort && signal) {
							signal.removeEventListener("abort", onAbort);
						}
					}
				}

				const response = await fetch(src, { signal });
				if (!response.ok) {
					throw new Error(`Failed to load LUT file: ${response.statusText}`);
				}
				const text = await response.text();

				const lines = text.split(/\r?\n/);
				let size = 33;
				let type: "1D" | "3D" = "3D";
				const points: Array<[number, number, number]> = [];

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith("#")) {
						continue;
					}

					if (trimmed.startsWith("LUT_3D_SIZE")) {
						const parts = trimmed.split(/\s+/);
						size = parseInt(parts[1], 10);
						type = "3D";
						continue;
					}

					if (trimmed.startsWith("LUT_1D_SIZE")) {
						const parts = trimmed.split(/\s+/);
						size = parseInt(parts[1], 10);
						type = "1D";
						continue;
					}

					if (trimmed.match(/^[a-zA-Z]/)) {
						continue;
					}

					const parts = trimmed.split(/\s+/).map(Number);
					if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
						points.push([parts[0], parts[1], parts[2]]);
					}
				}

				if (points.length === 0) {
					throw new Error("No valid color mappings found in LUT file.");
				}

				return this.createOrUpdate(src, device, points, size, type);
			})();

			promises.set(src, promise);
			promise.catch(() => {
				promises.delete(src);
			});
		}

		return promise;
	}

	evict(key: string, device: GPUDevice): void {
		const cache = this.getCache(device);
		const cached = cache.get(key);
		if (cached) {
			const oldTex = cached.texture;
			const oldBuf = cached.vertexBuffer;
			device.queue
				.onSubmittedWorkDone()
				.then(() => {
					try {
						oldTex.destroy();
					} catch {}
					try {
						oldBuf.destroy();
					} catch {}
				})
				.catch(() => {});
			cache.delete(key);
		}
		this.getPromises(device).delete(key);
	}

	hasPending(device: GPUDevice): boolean {
		const promises = this.devicePromises.get(device);
		return (
			(promises !== undefined && promises.size > 0) ||
			this.rawDataPromises.size > 0
		);
	}

	async awaitAllPending(device: GPUDevice): Promise<void> {
		const promises = Array.from(this.getPromises(device).values());
		await Promise.all(promises);
	}

	destroy(): void {
		this.deviceCaches = new WeakMap();
		this.devicePromises = new WeakMap();
		this.rawDataCache.clear();
		this.rawDataPromises.clear();
	}
}

const globalKey = "__GATEWAI_LUT_STORE__";
export const lutStore: LutStore = (() => {
	if (!(globalThis as any)[globalKey]) {
		(globalThis as any)[globalKey] = new LutStore();
	}
	return (globalThis as any)[globalKey];
})();
