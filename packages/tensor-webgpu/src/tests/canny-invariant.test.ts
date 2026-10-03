import { ensureDevice } from "@gitframes/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { ControlNetMultiplexer } from "../multiplexer/controlnet-multiplexer.js";
import { CannyComputePipeline } from "../pipelines/canny-pipeline.js";

describe("Canny Edge Detector Mathematical Invariants", () => {
	it("1. Canny Gradient Invariant: step edge produces exact single-pixel width response (W_edge = 1px) with zero smear", async () => {
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

		// 1. Create synthetic step edge: left half black (0), right half white (255)
		const stepEdgeData = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;
				const val = x >= 32 ? 255 : 0;
				stepEdgeData[idx] = val; // R
				stepEdgeData[idx + 1] = val; // G
				stepEdgeData[idx + 2] = val; // B
				stepEdgeData[idx + 3] = 255; // A
			}
		}

		const inputTexture = device.createTexture({
			label: "step_edge_test_texture",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		device.queue.writeTexture(
			{ texture: inputTexture },
			stepEdgeData,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);

		// 2. Dispatch 2-Pass Canny compute pipeline
		const cannyPipeline = new CannyComputePipeline(device);
		const edgeTexture = cannyPipeline.execute(inputTexture, {
			low: 0.1,
			high: 0.3,
			outputFormat: "rgba8unorm",
		});

		expect(edgeTexture).toBeDefined();
		expect(edgeTexture.width).toBe(width);
		expect(edgeTexture.height).toBe(height);

		// 3. Register with multiplexer and read back pixels asynchronously
		const multiplexer = new ControlNetMultiplexer();
		multiplexer.set("canny", edgeTexture);

		const readback = await multiplexer.readPixelsAsync(device, "canny");
		expect(readback.width).toBe(width);
		expect(readback.height).toBe(height);
		expect(readback.data.length).toBe(width * height * 4);

		// 4. Mathematical Invariant Verification:
		// Across interior rows (away from top/bottom boundary padding),
		// the edge response must be EXACTLY 1 pixel wide at the step transition.
		let evaluatedRows = 0;
		for (let y = 10; y < height - 10; y++) {
			let edgeCountInRow = 0;
			let edgeX = -1;

			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;
				const intensity = readback.data[idx]; // R channel
				if (intensity > 128) {
					edgeCountInRow++;
					edgeX = x;
				}
			}

			// Must find exactly 1 detected edge pixel per row at the step boundary (x = 31 or 32)
			expect(edgeCountInRow).toBe(1);
			expect(Math.abs(edgeX - 31.5)).toBeLessThanOrEqual(1.0);

			// Assert zero smear on neighboring pixels (distance > 1 must be 0)
			for (let x = 0; x < width; x++) {
				if (Math.abs(x - edgeX) > 1) {
					const idx = (y * width + x) * 4;
					expect(readback.data[idx]).toBe(0);
				}
			}
			evaluatedRows++;
		}

		expect(evaluatedRows).toBe(height - 20);

		// Clean up
		inputTexture.destroy();
		cannyPipeline.destroy();
		multiplexer.destroy();
	});
});
