import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Polyfill WebGPU globals for the test runner environment
if (typeof globalThis.GPUBufferUsage === "undefined") {
	globalThis.GPUBufferUsage = {
		MAP_READ: 1,
		MAP_WRITE: 2,
		COPY_SRC: 4,
		COPY_DST: 8,
		INDEX: 16,
		VERTEX: 32,
		UNIFORM: 64,
		STORAGE: 128,
		INDIRECT: 256,
		QUERY_RESOLVE: 512,
	} as unknown as typeof GPUBufferUsage;
}

if (typeof globalThis.GPUTextureUsage === "undefined") {
	globalThis.GPUTextureUsage = {
		COPY_SRC: 1,
		COPY_DST: 2,
		TEXTURE_BINDING: 4,
		STORAGE_BINDING: 8,
		RENDER_ATTACHMENT: 16,
	} as unknown as typeof GPUTextureUsage;
}

import { LutStore } from "./lut-store.js";
import { createMockDevice } from "./renderer2d/test-helpers.js";

describe("LutStore", () => {
	let store: LutStore;
	let mockDevice: any;

	beforeEach(() => {
		store = new LutStore();
		mockDevice = createMockDevice();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("Cache and Listener Operations", () => {
		it("should register, trigger, and unsubscribe listeners", () => {
			const listener = vi.fn();
			const unsubscribe = store.onChange(listener);

			// Trigger via createOrUpdate
			store.createOrUpdate("test-key", mockDevice, [[0, 0, 0]], 2, "1D");
			expect(listener).toHaveBeenCalledWith("test-key");

			listener.mockClear();
			unsubscribe();

			store.createOrUpdate("test-key-2", mockDevice, [[0, 0, 0]], 2, "1D");
			expect(listener).not.toHaveBeenCalled();
		});

		it("should store and retrieve LUT by key and device", () => {
			const mockLut = {
				texture: {} as any,
				type: "1D" as const,
				size: 2,
				vertexBuffer: {} as any,
				vertexCount: 2,
			};

			store.set("my-key", mockDevice, mockLut);
			expect(store.get("my-key", mockDevice)).toBe(mockLut);
		});

		it("should retrieve any matching LUT using prefix", () => {
			const mockLut1 = {
				texture: {} as any,
				type: "1D" as const,
				size: 2,
				vertexBuffer: {} as any,
				vertexCount: 2,
			};
			const mockLut2 = {
				texture: {} as any,
				type: "3D" as const,
				size: 4,
				vertexBuffer: {} as any,
				vertexCount: 4,
			};

			store.set("prefix/item1", mockDevice, mockLut1);
			store.set("prefix/item2", mockDevice, mockLut2);

			expect(store.getAnyMatching("prefix/item", mockDevice)).toBe(mockLut2); // returns last match
			expect(store.getAnyMatching("non-existent", mockDevice)).toBeUndefined();
		});
	});

	describe("createOrUpdate", () => {
		it("should create GPU resources for 1D LUT", () => {
			const points: Array<[number, number, number]> = [
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
			];
			const lut = store.createOrUpdate("lut1d", mockDevice, points, 2, "1D");

			expect(lut.type).toBe("1D");
			expect(lut.size).toBe(2);
			expect(lut.vertexCount).toBe(2);
			expect(mockDevice.createTexture).toHaveBeenCalledWith({
				size: [2, 1, 1],
				dimension: "1d",
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			expect(mockDevice.createBuffer).toHaveBeenCalled();
			expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
			expect(mockDevice.queue.writeBuffer).toHaveBeenCalled();

			expect(store.getRawData("lut1d")).toEqual({
				points,
				size: 2,
				type: "1D",
			});
		});

		it("should create GPU resources for 3D LUT", () => {
			const points: Array<[number, number, number]> = Array(8).fill([
				0.5, 0.5, 0.5,
			]);
			const lut = store.createOrUpdate("lut3d", mockDevice, points, 2, "3D");

			expect(lut.type).toBe("3D");
			expect(lut.size).toBe(2);
			expect(lut.vertexCount).toBe(8);
			expect(mockDevice.createTexture).toHaveBeenCalledWith({
				size: [2, 2, 2],
				dimension: "3d",
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
		});

		it("should reuse and destroy existing texture/buffer when size or type changes", async () => {
			const points1: Array<[number, number, number]> = [[0.1, 0.2, 0.3]];
			const lut1 = store.createOrUpdate(
				"change-lut",
				mockDevice,
				points1,
				1,
				"1D",
			);

			const points2: Array<[number, number, number]> = Array(8).fill([
				0.5, 0.5, 0.5,
			]);
			// Change size and type
			const lut2 = store.createOrUpdate(
				"change-lut",
				mockDevice,
				points2,
				2,
				"3D",
			);

			expect(lut2.texture).not.toBe(lut1.texture);
			expect(lut2.vertexBuffer).not.toBe(lut1.vertexBuffer);

			// Trigger work done queue callbacks to destroy old resources
			await Promise.resolve();
			await Promise.resolve();
			expect(lut1.texture.destroy).toHaveBeenCalled();
			expect(lut1.vertexBuffer.destroy).toHaveBeenCalled();
		});

		it("should reuse texture/buffer if size and type remain the same", () => {
			const points1: Array<[number, number, number]> = [[0.1, 0.2, 0.3]];
			const lut1 = store.createOrUpdate(
				"reuse-lut",
				mockDevice,
				points1,
				1,
				"1D",
			);

			const points2: Array<[number, number, number]> = [[0.9, 0.8, 0.7]];
			const lut2 = store.createOrUpdate(
				"reuse-lut",
				mockDevice,
				points2,
				1,
				"1D",
			);

			expect(lut2.texture).toBe(lut1.texture);
			expect(lut2.vertexBuffer).toBe(lut1.vertexBuffer);
		});
	});

	describe("getOrLoad", () => {
		it("should load a valid 3D .cube file from URL", async () => {
			const cubeContent = `
# This is a comment
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: vi.fn().mockResolvedValue(cubeContent),
				}),
			);

			const lut = await store.getOrLoad(
				"http://example.com/lut3d.cube",
				mockDevice,
			);
			expect(globalThis.fetch).toHaveBeenCalledWith(
				"http://example.com/lut3d.cube",
				expect.any(Object),
			);
			expect(lut.type).toBe("3D");
			expect(lut.size).toBe(2);
			expect(lut.vertexCount).toBe(8);
		});

		it("should load a valid 1D .cube file from URL", async () => {
			const cubeContent = `
LUT_1D_SIZE 3
0.0 0.1 0.2
0.3 0.4 0.5
0.6 0.7 0.8
`;
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: vi.fn().mockResolvedValue(cubeContent),
				}),
			);

			const lut = await store.getOrLoad(
				"http://example.com/lut1d.cube",
				mockDevice,
			);
			expect(lut.type).toBe("1D");
			expect(lut.size).toBe(3);
			expect(lut.vertexCount).toBe(3);
		});

		it("should throw error if fetch response is not ok", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
					statusText: "Not Found",
				}),
			);

			await expect(
				store.getOrLoad("http://example.com/missing.cube", mockDevice),
			).rejects.toThrow("Failed to load LUT file: Not Found");
		});

		it("should throw error if no points are found", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: vi.fn().mockResolvedValue("# Empty file"),
				}),
			);

			await expect(
				store.getOrLoad("http://example.com/empty.cube", mockDevice),
			).rejects.toThrow("No valid color mappings found in LUT file.");
		});

		it("should support AbortSignal in fetch and abort loading", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockImplementation((_, init) => {
					return new Promise((_, reject) => {
						if (init?.signal?.aborted) {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
							return;
						}
						init?.signal?.addEventListener("abort", () => {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
						});
					});
				}),
			);

			const controller = new AbortController();
			const promise = store.getOrLoad(
				"http://example.com/abort.cube",
				mockDevice,
				controller.signal,
			);
			controller.abort();

			await expect(promise).rejects.toThrow("The operation was aborted.");
		});

		it("should immediately throw if signal is already aborted before loading", async () => {
			const controller = new AbortController();
			controller.abort();

			await expect(
				store.getOrLoad(
					"http://example.com/abort-early.cube",
					mockDevice,
					controller.signal,
				),
			).rejects.toThrow("The operation was aborted.");
		});

		it("should return cached promise for parallel requests to the same URL", async () => {
			const cubeContent = `LUT_1D_SIZE 2\n0 0 0\n1 1 1`;
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: vi.fn().mockResolvedValue(cubeContent),
				}),
			);

			const [lut1, lut2] = await Promise.all([
				store.getOrLoad("http://example.com/lut.cube", mockDevice),
				store.getOrLoad("http://example.com/lut.cube", mockDevice),
			]);

			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
			expect(lut1).toBe(lut2);
		});
	});

	describe("runtime:// protocol", () => {
		it("should resolve deferred runtime promise when createOrUpdate is called", async () => {
			const promise = store.getOrLoad("runtime://mylut", mockDevice);

			const points: Array<[number, number, number]> = [
				[1, 0, 0],
				[0, 1, 0],
			];
			const expectedLut = store.createOrUpdate(
				"runtime://mylut",
				mockDevice,
				points,
				2,
				"1D",
			);

			const lut = await promise;
			expect(lut).toStrictEqual(expectedLut);
		});

		it("should reject deferred runtime promise when rejectRawDataPromise is called", async () => {
			const promise = store.getOrLoad("runtime://mylut", mockDevice);

			store.rejectRawDataPromise("runtime://mylut", new Error("Render Failed"));

			await expect(promise).rejects.toThrow("Render Failed");
		});

		it("should timeout when runtime promise is not resolved within 5000ms", async () => {
			const promise = store.getOrLoad("runtime://mylut-timeout", mockDevice);

			// Advance time by 5001ms
			vi.advanceTimersByTime(5001);

			await expect(promise).rejects.toThrow(
				'Timeout waiting for runtime LUT "runtime://mylut-timeout" after 5000ms.',
			);
		});

		it("should NOT timeout if globalThis.__GATEWAI_DELAYS__ or window.renderer_delayRenderHandles indicates loading", async () => {
			// Setup dynamic delays
			const gatewaiDelays = new Set(["some-delay"]);
			globalThis.__GATEWAI_DELAYS__ = gatewaiDelays as any;

			const promise = store.getOrLoad("runtime://mylut-delay", mockDevice);
			// Prevent unhandled rejection warnings in test runner
			promise.catch(() => {});

			// Advance past 5000ms
			vi.advanceTimersByTime(5500);

			// Verify promise is still pending
			let isResolved = false;
			promise
				.then(() => {
					isResolved = true;
				})
				.catch(() => {});
			await Promise.resolve();
			expect(isResolved).toBe(false);

			// Clear delay
			gatewaiDelays.clear();

			// Advance again to trigger timeout
			vi.advanceTimersByTime(5500);

			await expect(promise).rejects.toThrow(
				'Timeout waiting for runtime LUT "runtime://mylut-delay" after 5000ms.',
			);
			delete (globalThis as any).__GATEWAI_DELAYS__;
		});

		it("should abort runtime promise via AbortSignal", async () => {
			const controller = new AbortController();
			const promise = store.getOrLoad(
				"runtime://mylut-abort",
				mockDevice,
				controller.signal,
			);

			controller.abort();

			await expect(promise).rejects.toThrow("The operation was aborted.");
		});
	});

	describe("evict and destroy", () => {
		it("should evict LUT and call destroy on old texture/buffer", async () => {
			const points: Array<[number, number, number]> = [[0, 0, 0]];
			const lut = store.createOrUpdate(
				"evict-key",
				mockDevice,
				points,
				1,
				"1D",
			);

			store.evict("evict-key", mockDevice);

			expect(store.get("evict-key", mockDevice)).toBeUndefined();

			await Promise.resolve();
			await Promise.resolve();
			expect(lut.texture.destroy).toHaveBeenCalled();
			expect(lut.vertexBuffer.destroy).toHaveBeenCalled();
		});

		it("should awaitAllPending for pending promises", async () => {
			let resolveFetch!: (value: any) => void;
			const fetchPromise = new Promise((resolve) => {
				resolveFetch = resolve;
			});
			vi.stubGlobal("fetch", vi.fn().mockReturnValue(fetchPromise));

			const promise = store.getOrLoad(
				"http://example.com/pending.cube",
				mockDevice,
			);

			let isAllDone = false;
			store
				.awaitAllPending(mockDevice)
				.then(() => {
					isAllDone = true;
				})
				.catch(() => {});

			expect(isAllDone).toBe(false);

			resolveFetch({
				ok: true,
				text: () => "LUT_1D_SIZE 2\n0 0 0\n1 1 1",
			});

			await promise;
			await store.awaitAllPending(mockDevice);

			expect(isAllDone).toBe(true);
		});

		it("should clear all caches on destroy", () => {
			const points: Array<[number, number, number]> = [[0, 0, 0]];
			store.createOrUpdate("destroy-key", mockDevice, points, 1, "1D");

			store.destroy();

			expect(store.get("destroy-key", mockDevice)).toBeUndefined();
			expect(store.getRawData("destroy-key")).toBeUndefined();
		});
	});
});
