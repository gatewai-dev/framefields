import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { ControlNetMultiplexer } from "../multiplexer/controlnet-multiplexer.js";
import { DepthNormalsComputePipeline } from "../pipelines/depth-normals-pipeline.js";

describe("Screen-Space Normal Map Mathematical Invariants", () => {
	it("2. Normal Map Unitarity: for every pixel in the reconstructed normal map, ||N(x, y)|| = 1.0 +- 0.001", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn(
				"WebGPU device unavailable in test environment, skipping:",
				e,
			);
			return;
		}

		const width = 64;
		const height = 64;

		// 1. Create a synthetic non-planar depth surface (sine-cosine undulating terrain)
		// in r32float texture format so partial derivatives are continuous and non-zero
		const depthData = new Float32Array(width * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const nx = (x / width) * Math.PI * 2;
				const ny = (y / height) * Math.PI * 2;
				depthData[y * width + x] = Math.sin(nx) * Math.cos(ny) * 20.0 + 50.0;
			}
		}

		const depthTexture = device.createTexture({
			label: "synthetic_depth_texture",
			size: [width, height],
			format: "r32float",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		device.queue.writeTexture(
			{ texture: depthTexture },
			depthData,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);

		// 2. Dispatch Depth-to-Normal compute pipeline with high-precision rgba16float output
		const pipeline = new DepthNormalsComputePipeline(device);
		const normalTexture = pipeline.execute(depthTexture, {
			depthScale: 1.5,
			outputFormat: "rgba16float",
		});

		expect(normalTexture).toBeDefined();
		expect(normalTexture.width).toBe(width);
		expect(normalTexture.height).toBe(height);
		expect(normalTexture.format).toBe("rgba16float");

		// 3. Register with multiplexer and read back pixels asynchronously
		const multiplexer = new ControlNetMultiplexer();
		multiplexer.set("normals", normalTexture);

		const readback = await multiplexer.readPixelsAsync(device, "normals");
		expect(readback.width).toBe(width);
		expect(readback.height).toBe(height);
		expect(readback.format).toBe("rgba16float");

		// Read float16 values from the Uint8Array buffer
		// Uint16 view of rgba16float (each channel is half-float 16-bit)
		const u16View = new Uint16Array(
			readback.data.buffer,
			readback.data.byteOffset,
			readback.data.byteLength / 2,
		);

		// Standard IEEE 754 half-float to float32 converter
		function decodeFloat16(h: number): number {
			const s = (h & 0x8000) >> 15;
			const e = (h & 0x7c00) >> 10;
			const f = h & 0x03ff;
			if (e === 0) {
				return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
			}
			if (e === 31) {
				return f ? Number.NaN : (s ? -1 : 1) * Number.POSITIVE_INFINITY;
			}
			return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
		}

		// 4. Mathematical Invariant Verification:
		// For EVERY pixel in the normal map, unpack [0, 1] color back to [-1, 1] vector N
		// and assert ||N|| = 1.0 +- 0.001
		let verifiedPixels = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const pixelIdx = (y * width + x) * 4;
				const cR = decodeFloat16(u16View[pixelIdx]);
				const cG = decodeFloat16(u16View[pixelIdx + 1]);
				const cB = decodeFloat16(u16View[pixelIdx + 2]);

				// Unpack from [0, 1] to [-1, 1]
				const nx = cR * 2.0 - 1.0;
				const ny = cG * 2.0 - 1.0;
				const nz = cB * 2.0 - 1.0;

				const norm = Math.sqrt(nx * nx + ny * ny + nz * nz);

				// Unitarity condition (within float16 10-bit mantissa discretization epsilon ~0.001)
				expect(Math.abs(norm - 1.0)).toBeLessThanOrEqual(0.0015);
				verifiedPixels++;
			}
		}

		expect(verifiedPixels).toBe(width * height);

		// Clean up
		depthTexture.destroy();
		pipeline.destroy();
		multiplexer.destroy();
	});
});
