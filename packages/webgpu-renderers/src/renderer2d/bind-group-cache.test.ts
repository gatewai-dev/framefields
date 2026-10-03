import { beforeEach, describe, expect, it } from "vitest";
import { BindGroupCache } from "./bind-group-cache.js";
import { createMockDevice, createMockTexture } from "./test-helpers.js";

describe("BindGroupCache", () => {
	let cache: BindGroupCache;
	let mockDevice: any;

	beforeEach(() => {
		cache = new BindGroupCache();
		mockDevice = createMockDevice();
	});

	it("should create and cache bind groups", () => {
		const layout = {} as GPUBindGroupLayout;
		const texture = createMockTexture() as any;
		const sampler = {} as GPUSampler;

		const bg1 = cache.getBindGroup(mockDevice, layout, texture, sampler);
		const bg2 = cache.getBindGroup(mockDevice, layout, texture, sampler);

		expect(bg1).toBe(bg2);
		expect(mockDevice.createBindGroup).toHaveBeenCalledTimes(1);
	});

	it("should cache separate bind groups for different layouts or textures", () => {
		const layout1 = { label: "l1" } as any;
		const layout2 = { label: "l2" } as any;
		const texture1 = createMockTexture() as any;
		const texture2 = createMockTexture() as any;
		const sampler = {} as GPUSampler;

		const bg1 = cache.getBindGroup(mockDevice, layout1, texture1, sampler);
		const bg2 = cache.getBindGroup(mockDevice, layout2, texture1, sampler);
		const bg3 = cache.getBindGroup(mockDevice, layout1, texture2, sampler);

		expect(bg1).not.toBe(bg2);
		expect(bg1).not.toBe(bg3);
		expect(mockDevice.createBindGroup).toHaveBeenCalledTimes(3);
	});

	it("should create and cache composite bind groups", () => {
		const layout = {} as GPUBindGroupLayout;
		const base = createMockTexture() as any;
		const overlay = createMockTexture() as any;
		const sampler = {} as GPUSampler;

		const bg1 = cache.getCompositeBindGroup(
			mockDevice,
			layout,
			base,
			overlay,
			sampler,
		);
		const bg2 = cache.getCompositeBindGroup(
			mockDevice,
			layout,
			base,
			overlay,
			sampler,
		);

		expect(bg1).toBe(bg2);
		expect(mockDevice.createBindGroup).toHaveBeenCalledTimes(1);
	});

	it("should cache separate composite bind groups for different textures", () => {
		const layout = {} as GPUBindGroupLayout;
		const base1 = createMockTexture() as any;
		const base2 = createMockTexture() as any;
		const overlay = createMockTexture() as any;
		const sampler = {} as GPUSampler;

		const bg1 = cache.getCompositeBindGroup(
			mockDevice,
			layout,
			base1,
			overlay,
			sampler,
		);
		const bg2 = cache.getCompositeBindGroup(
			mockDevice,
			layout,
			base2,
			overlay,
			sampler,
		);

		expect(bg1).not.toBe(bg2);
		expect(mockDevice.createBindGroup).toHaveBeenCalledTimes(2);
	});

	it("should clear the cache on destroy", () => {
		const layout = {} as GPUBindGroupLayout;
		const texture = createMockTexture() as any;
		const sampler = {} as GPUSampler;

		const bg1 = cache.getBindGroup(mockDevice, layout, texture, sampler);
		cache.destroy();
		const bg2 = cache.getBindGroup(mockDevice, layout, texture, sampler);

		expect(bg1).not.toBe(bg2);
		expect(mockDevice.createBindGroup).toHaveBeenCalledTimes(2);
	});
});
