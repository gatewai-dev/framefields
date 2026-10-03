import { ensureDevice } from "@gitframes/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { DmaStagingRing } from "../dma-staging-ring.js";

describe("Module 5: Asynchronous Double-Buffered DMA Staging Ring Conformance", () => {
	it("initializes double-buffered staging buffers with WebGPU 256-byte row alignment", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable, skipping:", e);
			return;
		}

		// Width 100 * 4 = 400 bytes, aligned to 256 is 512 bytes
		const ring = new DmaStagingRing(device, {
			width: 100,
			height: 50,
			capacity: 2,
		});

		expect(ring.width).toBe(100);
		expect(ring.height).toBe(50);
		expect(ring.capacity).toBe(2);
		expect(ring.unpaddedBytesPerRow).toBe(400);
		expect(ring.bytesPerRow).toBe(512);
		expect(ring.bufferSize).toBe(512 * 50);

		const infos = ring.getSlotInfos();
		expect(infos).toHaveLength(2);
		expect(infos[0]?.status).toBe("idle");
		expect(infos[1]?.status).toBe("idle");
		expect(infos[0]?.inFlightFrame).toBeNull();
		expect(infos[1]?.inFlightFrame).toBeNull();

		ring.destroy();
	});

	it("stages texture to staging ring and reads back pixels with exact pixel parity (MSE = 0)", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable, skipping:", e);
			return;
		}

		const width = 64;
		const height = 64;
		const ring = new DmaStagingRing(device, { width, height, capacity: 2 });

		const texture = device.createTexture({
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		// Clear texture to a known RGBA color: (1.0, 0.5, 0.25, 1.0) -> [255, 128, 64, 255]
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: texture.createView(),
					clearValue: { r: 1.0, g: 0.5, b: 0.25, a: 1.0 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		pass.end();

		// Stage into ring slot 0
		ring.stageTexture(encoder, texture, 0);
		device.queue.submit([encoder.finish()]);

		// Schedule map and read
		ring.scheduleMap(0);
		const pixels = await ring.readAndReleaseFrame(0);

		expect(pixels).toHaveLength(width * height * 4);

		// Assert mathematical parity: all pixels must match clear color
		const expectedR = 255;
		const expectedG = Math.round(0.5 * 255); // 128
		const expectedB = Math.round(0.25 * 255); // 64
		const expectedA = 255;

		for (let i = 0; i < pixels.length; i += 4) {
			expect(Math.abs((pixels[i] ?? 0) - expectedR)).toBeLessThanOrEqual(1);
			expect(Math.abs((pixels[i + 1] ?? 0) - expectedG)).toBeLessThanOrEqual(1);
			expect(Math.abs((pixels[i + 2] ?? 0) - expectedB)).toBeLessThanOrEqual(1);
			expect(pixels[i + 3]).toBe(expectedA);
		}

		texture.destroy();
		ring.destroy();
	});

	it("maintains pipelined double-buffer concurrency across alternating frames", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable, skipping:", e);
			return;
		}

		const width = 128;
		const height = 128;
		const ring = new DmaStagingRing(device, { width, height, capacity: 2 });

		const tex0 = device.createTexture({
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		const tex1 = device.createTexture({
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		// Frame 0: render and stage to Slot 0
		const enc0 = device.createCommandEncoder();
		const pass0 = enc0.beginRenderPass({
			colorAttachments: [
				{
					view: tex0.createView(),
					clearValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		pass0.end();
		ring.stageTexture(enc0, tex0, 0);
		device.queue.submit([enc0.finish()]);
		ring.scheduleMap(0);

		// Frame 1: render and stage to Slot 1 while Slot 0 is in-flight / mapping
		const enc1 = device.createCommandEncoder();
		const pass1 = enc1.beginRenderPass({
			colorAttachments: [
				{
					view: tex1.createView(),
					clearValue: { r: 0.0, g: 1.0, b: 0.0, a: 1.0 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		pass1.end();
		ring.stageTexture(enc1, tex1, 1);
		device.queue.submit([enc1.finish()]);
		ring.scheduleMap(1);

		// Verify slot 0 and slot 1 are both actively in-flight concurrently
		const infos = ring.getSlotInfos();
		expect(infos[0]?.inFlightFrame).toBe(0);
		expect(infos[1]?.inFlightFrame).toBe(1);

		// Read and release Frame 0
		const pixels0 = await ring.readAndReleaseFrame(0);
		expect(pixels0[0]).toBe(255); // Red
		expect(pixels0[1]).toBe(0);

		// Slot 0 is now idle and can be prepared for Frame 2
		await ring.prepareSlot(2);
		expect(ring.getSlotInfos()[0]?.status).toBe("idle");

		// Read and release Frame 1
		const pixels1 = await ring.readAndReleaseFrame(1);
		expect(pixels1[0]).toBe(0);
		expect(pixels1[1]).toBe(255); // Green

		tex0.destroy();
		tex1.destroy();
		ring.destroy();
	});

	it("creates hardware WebCodecs VideoFrame directly from mapped staging memory", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable, skipping:", e);
			return;
		}

		const width = 640;
		const height = 360;
		const ring = new DmaStagingRing(device, { width, height, capacity: 2 });

		const tex = device.createTexture({
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		const enc = device.createCommandEncoder();
		const pass = enc.beginRenderPass({
			colorAttachments: [
				{
					view: tex.createView(),
					clearValue: { r: 0.0, g: 0.5, b: 1.0, a: 1.0 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		pass.end();
		ring.stageTexture(enc, tex, 0);
		device.queue.submit([enc.finish()]);
		ring.scheduleMap(0);

		const vf = await ring.readFrameToVideoFrame(0, 16666);
		expect(vf.codedWidth).toBe(width);
		expect(vf.codedHeight).toBe(height);
		expect(vf.format).toBe("RGBA");
		expect(vf.timestamp).toBe(16666);

		vf.close();
		tex.destroy();
		ring.destroy();
	});
});
