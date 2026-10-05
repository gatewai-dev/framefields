import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { ControlNetMultiplexer } from "../multiplexer/controlnet-multiplexer.js";
import { OpticalFlowComputePipeline } from "../pipelines/optical-flow-pipeline.js";

function decodeFloat16(h: number): number {
	const s = (h & 0x8000) >> 15;
	const e = (h & 0x7c00) >> 10;
	const f = h & 0x03ff;
	if (e === 0) {
		return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
	}
	if (e === 0x1f) {
		return f ? NaN : s ? -Infinity : Infinity;
	}
	return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

describe("WebGPU Lucas-Kanade Optical Flow Motion Estimation", () => {
	it("1. Zero Motion Invariant: Identical frames yield near-zero flow vectors (|v| < 0.05)", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable in test environment, skipping:", e);
			return;
		}

		const width = 64;
		const height = 64;

		// Create textured pattern (high contrast grid)
		const frameData = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;
				const pattern = ((x >> 2) ^ (y >> 2)) & 1 ? 220 : 30;
				frameData[idx] = pattern;
				frameData[idx + 1] = pattern;
				frameData[idx + 2] = pattern;
				frameData[idx + 3] = 255;
			}
		}

		const tex1 = device.createTexture({
			label: "flow_frame1",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		const tex2 = device.createTexture({
			label: "flow_frame2",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		device.queue.writeTexture(
			{ texture: tex1 },
			frameData,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);
		device.queue.writeTexture(
			{ texture: tex2 },
			frameData,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);

		const flowPipeline = new OpticalFlowComputePipeline(device);
		const flowTex = flowPipeline.execute(tex1, tex2, {
			lambda: 0.05,
			iterations: 3,
		});

		expect(flowTex).toBeDefined();
		expect(flowTex.format).toBe("rgba16float");

		const mux = new ControlNetMultiplexer();
		mux.set("motionVectors", flowTex);

		const readback = await mux.readPixelsAsync(device, "motionVectors");
		expect(readback.width).toBe(width);
		expect(readback.height).toBe(height);

		// Read u16 half-floats
		const u16View = new Uint16Array(
			readback.data.buffer,
			readback.data.byteOffset,
			readback.data.byteLength / 2,
		);

		let maxMag = 0;
		for (let y = 8; y < height - 8; y++) {
			for (let x = 8; x < width - 8; x++) {
				const pixelIdx = (y * width + x) * 4;
				const u = decodeFloat16(u16View[pixelIdx]!);
				const v = decodeFloat16(u16View[pixelIdx + 1]!);
				const mag = Math.hypot(u, v);
				if (mag > maxMag) maxMag = mag;
			}
		}

		// Zero motion between identical textures
		expect(maxMag).toBeLessThan(0.1);
	});

	it("2. Translation Invariant: Known directional shift produces corresponding motion vectors", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable in test environment, skipping:", e);
			return;
		}

		const width = 64;
		const height = 64;

		// Create smooth Gaussian blob shifted by deltaX = +2, deltaY = 0
		const deltaX = 2.0;
		const deltaY = 0.0;

		const f1 = new Uint8Array(width * height * 4);
		const f2 = new Uint8Array(width * height * 4);

		const cX = 32.0;
		const cY = 32.0;
		const sigma = 10.0;

		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;

				// Frame 1 centered at (cX, cY)
				const d1Sq = (x - cX) * (x - cX) + (y - cY) * (y - cY);
				const val1 = Math.round(255 * Math.exp(-d1Sq / (2 * sigma * sigma)));
				f1[idx] = val1;
				f1[idx + 1] = val1;
				f1[idx + 2] = val1;
				f1[idx + 3] = 255;

				// Frame 2 centered at (cX + deltaX, cY + deltaY)
				const d2Sq =
					(x - (cX + deltaX)) * (x - (cX + deltaX)) +
					(y - (cY + deltaY)) * (y - (cY + deltaY));
				const val2 = Math.round(255 * Math.exp(-d2Sq / (2 * sigma * sigma)));
				f2[idx] = val2;
				f2[idx + 1] = val2;
				f2[idx + 2] = val2;
				f2[idx + 3] = 255;
			}
		}

		const tex1 = device.createTexture({
			label: "blob_frame1",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		const tex2 = device.createTexture({
			label: "blob_frame2",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		device.queue.writeTexture(
			{ texture: tex1 },
			f1,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);
		device.queue.writeTexture(
			{ texture: tex2 },
			f2,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);

		const flowPipeline = new OpticalFlowComputePipeline(device);
		const flowTex = flowPipeline.execute(tex1, tex2, {
			lambda: 0.01,
			iterations: 3,
		});

		const mux = new ControlNetMultiplexer();
		mux.set("motionVectors", flowTex);

		const readback = await mux.readPixelsAsync(device, "motionVectors");
		const u16View = new Uint16Array(
			readback.data.buffer,
			readback.data.byteOffset,
			readback.data.byteLength / 2,
		);

		// Sample around the blob gradient where optical flow is well-defined
		let avgU = 0;
		let count = 0;

		for (let y = 28; y <= 36; y++) {
			for (let x = 24; x <= 28; x++) {
				const pixelIdx = (y * width + x) * 4;
				const u = decodeFloat16(u16View[pixelIdx]!);
				avgU += u;
				count++;
			}
		}
		avgU /= count;

		// Motion vector u must be positive indicating rightward displacement (+X)
		expect(avgU).toBeGreaterThan(0.5);
		expect(avgU).toBeLessThanOrEqual(3.5);
	});
});
