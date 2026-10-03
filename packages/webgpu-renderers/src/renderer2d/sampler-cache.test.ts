import { beforeEach, describe, expect, it } from "vitest";
import { SamplerCache } from "./sampler-cache.js";
import { createMockDevice } from "./test-helpers.js";

describe("SamplerCache", () => {
	let cache: SamplerCache;
	let mockDevice: any;

	beforeEach(() => {
		cache = new SamplerCache(3); // Small capacity for easy testing
		mockDevice = createMockDevice();
	});

	it("should return a sampler and cache it", () => {
		const s1 = cache.getSampler(mockDevice, { magFilter: "linear" });
		const s2 = cache.getSampler(mockDevice, { magFilter: "linear" });

		expect(s1).toBe(s2);
		expect(mockDevice.createSampler).toHaveBeenCalledTimes(1);
	});

	it("should use default descriptor options if not provided", () => {
		cache.getSampler(mockDevice);
		expect(mockDevice.createSampler).toHaveBeenCalledWith({
			magFilter: "linear",
			minFilter: "linear",
			mipmapFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
			maxAnisotropy: 4,
		});
	});

	it("should evict least recently used items when capacity is exceeded", () => {
		const s1 = cache.getSampler(mockDevice, { magFilter: "nearest" }); // key: nearest:...
		cache.getSampler(mockDevice, { minFilter: "nearest" }); // key: linear:nearest:...
		cache.getSampler(mockDevice, { mipmapFilter: "nearest" }); // key: linear:linear:nearest...

		expect(mockDevice.createSampler).toHaveBeenCalledTimes(3);

		// Now add a fourth item to trigger eviction of s1 (nearest:...)
		cache.getSampler(mockDevice, { addressModeU: "repeat" });
		expect(mockDevice.createSampler).toHaveBeenCalledTimes(4);

		// Check that s1 was evicted (nearest:...) by getting it again. This should create a new sampler instead of cache hit.
		const s1Again = cache.getSampler(mockDevice, { magFilter: "nearest" });
		expect(mockDevice.createSampler).toHaveBeenCalledTimes(5);
		expect(s1Again).not.toBe(s1);
	});

	it("should update LRU order on cache hit", () => {
		const s1 = cache.getSampler(mockDevice, { magFilter: "nearest" });
		const s2 = cache.getSampler(mockDevice, { minFilter: "nearest" });
		cache.getSampler(mockDevice, { mipmapFilter: "nearest" });

		// Access s1 again, moving it to the front of LRU (most recently used)
		cache.getSampler(mockDevice, { magFilter: "nearest" });

		// Now add a fourth item. The LRU stack is: s1 (MRU), s3, s2 (LRU).
		// Thus, s2 should be evicted, NOT s1.
		cache.getSampler(mockDevice, { addressModeU: "repeat" });

		// s1 should still be a cache hit (createSampler won't be called)
		const s1Again = cache.getSampler(mockDevice, { magFilter: "nearest" });
		expect(s1Again).toBe(s1);

		// s2 should have been evicted and thus created again
		const s2Again = cache.getSampler(mockDevice, { minFilter: "nearest" });
		expect(s2Again).not.toBe(s2);
	});

	it("should clear cached samplers on destroy", () => {
		const s1 = cache.getSampler(mockDevice);
		cache.destroy();
		const s2 = cache.getSampler(mockDevice);

		expect(s1).not.toBe(s2);
		expect(mockDevice.createSampler).toHaveBeenCalledTimes(2);
	});
});
