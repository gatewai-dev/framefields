import { beforeEach, describe, expect, it } from "vitest";
import { BufferPool } from "./buffer-pool.js";
import { createMockDevice } from "./test-helpers.js";

describe("BufferPool", () => {
	let mockDevice: any;

	beforeEach(() => {
		mockDevice = createMockDevice();
		globalThis.GPUBufferUsage = {
			UNIFORM: 1,
			VERTEX: 2,
			COPY_DST: 4,
		} as any;
	});

	it("should create a new buffer if pool is empty", () => {
		const pool = new BufferPool(1024, 1 | 4);
		const data = new Float32Array(10); // 40 bytes

		const buf = pool.getBuffer(mockDevice, data);

		expect(buf).toBeDefined();
		expect(mockDevice.createBuffer).toHaveBeenCalledTimes(1);
		expect(mockDevice.createBuffer).toHaveBeenCalledWith({
			size: 1024, // max(1024, 40)
			usage: 1 | 4,
		});
		expect(mockDevice.queue.writeBuffer).toHaveBeenCalledWith(buf, 0, data);
	});

	it("should reuse the existing buffer in subsequent frames after reset", () => {
		const pool = new BufferPool(1024, 1 | 4);
		const data = new Float32Array(10);

		const buf1 = pool.getBuffer(mockDevice, data);
		pool.reset();
		const buf2 = pool.getBuffer(mockDevice, data);

		expect(buf1).toBe(buf2);
		expect(mockDevice.createBuffer).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(2);
	});

	it("should allocate multiple buffers if requested sequentially before reset", () => {
		const pool = new BufferPool(1024, 1 | 4);
		const data = new Float32Array(10);

		const buf1 = pool.getBuffer(mockDevice, data);
		const buf2 = pool.getBuffer(mockDevice, data);

		expect(buf1).not.toBe(buf2);
		expect(mockDevice.createBuffer).toHaveBeenCalledTimes(2);
	});

	it("should resize and replace the buffer if data is larger than initial size", async () => {
		const pool = new BufferPool(100, 1 | 4);
		const data1 = new Uint8Array(50);
		const data2 = new Uint8Array(200);

		const buf1 = pool.getBuffer(mockDevice, data1);
		expect(buf1.size).toBe(100);

		pool.reset(); // Reset index to 0 to target the same buffer slot for resizing

		const buf2 = pool.getBuffer(mockDevice, data2);
		expect(buf2).not.toBe(buf1);
		expect(buf2.size).toBe(200);

		// Old buffer should be scheduled to be destroyed
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(buf1.destroy).toHaveBeenCalledTimes(1);
	});

	it("should resize a reused buffer in subsequent frames", async () => {
		const pool = new BufferPool(100, 1 | 4);
		const data1 = new Uint8Array(50);
		const data2 = new Uint8Array(200);

		const buf1 = pool.getBuffer(mockDevice, data1);
		pool.reset();

		const buf2 = pool.getBuffer(mockDevice, data2);
		expect(buf2).not.toBe(buf1);
		expect(buf2.size).toBe(200);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(buf1.destroy).toHaveBeenCalledTimes(1);
	});

	it("should destroy all buffers on destroy", () => {
		const pool = new BufferPool(100, 1 | 4);
		const data = new Uint8Array(50);

		const buf1 = pool.getBuffer(mockDevice, data);
		pool.destroy();

		expect(buf1.destroy).toHaveBeenCalledTimes(1);
	});
});
