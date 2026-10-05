import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { SegmentationComputePipeline } from "../pipelines/segmentation-pipeline.js";
import { TensorPipeline } from "../pipeline/tensor-pipeline.js";

describe("Native WebGPU Segmentation Compute Pipeline", () => {
	it("executes segmentation mask thresholding and feathering directly in VRAM", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable in test environment, skipping:", e);
			return;
		}

		const width = 128;
		const height = 128;

		const mockInputTexture = device.createTexture({
			label: "mock_segmentation_input",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		const pipeline = new SegmentationComputePipeline(device);
		const output = pipeline.execute(mockInputTexture, { threshold: 0.5, feather: 0.1 });

		expect(output).toBeDefined();
		expect(output.width).toBe(width);
		expect(output.height).toBe(height);
		expect(output.format).toBe("rgba8unorm");

		pipeline.destroy();
		mockInputTexture.destroy();
	});

	it("integrates into TensorPipeline.segmentation() with multiplexer registration", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable in test environment, skipping:", e);
			return;
		}

		const width = 64;
		const height = 64;

		const mockInputTexture = device.createTexture({
			label: "mock_input_texture",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		const pipeline = TensorPipeline.from(mockInputTexture)
			.segmentation({ threshold: 0.6, feather: 0.08 });

		const outputs = await pipeline.execute(device);
		expect(outputs.segmentationMask).toBeDefined();
		expect(outputs.segmentationMask?.width).toBe(width);

		const mux = pipeline.getMultiplexer();
		expect(mux.has("segmentationMask")).toBe(true);

		pipeline.destroy();
		mockInputTexture.destroy();
	});
});
