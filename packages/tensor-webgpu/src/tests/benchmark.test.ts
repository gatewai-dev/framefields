import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { CannyComputePipeline } from "../pipelines/canny-pipeline.js";
import { DepthNormalsComputePipeline } from "../pipelines/depth-normals-pipeline.js";

describe("WebGPU Neural Tensor Benchmark Suite (1080p Real-Time Invariant)", () => {
	it("executes 1080p Canny Edge and Depth-to-Normal compute passes under 5ms in VRAM", async () => {
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

		const width = 1920;
		const height = 1080;

		const inputTexture = device.createTexture({
			label: "benchmark_1080p_video_frame",
			size: [width, height],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.STORAGE_BINDING |
				GPUTextureUsage.COPY_DST,
		});

		const cannyPipeline = new CannyComputePipeline(device);
		const normalsPipeline = new DepthNormalsComputePipeline(device);

		// Warmup pass
		cannyPipeline.execute(inputTexture, { low: 0.1, high: 0.3 });
		normalsPipeline.execute(inputTexture, { depthScale: 1.0 });
		await device.queue.onSubmittedWorkDone();

		// Benchmark Canny Edge compute on 1080p
		const iterations = 10;
		const cannyStart = performance.now();
		for (let i = 0; i < iterations; i++) {
			cannyPipeline.execute(inputTexture, { low: 0.1, high: 0.3 });
		}
		await device.queue.onSubmittedWorkDone();
		const cannyDurationPerFrame = (performance.now() - cannyStart) / iterations;

		// Benchmark Depth-to-Normal compute on 1080p
		const normalsStart = performance.now();
		for (let i = 0; i < iterations; i++) {
			normalsPipeline.execute(inputTexture, { depthScale: 1.0 });
		}
		await device.queue.onSubmittedWorkDone();
		const normalsDurationPerFrame =
			(performance.now() - normalsStart) / iterations;

		console.log(
			`[1080p WebGPU Tensor Benchmarks]\n` +
				`  - Canny Edge (1080p): ${cannyDurationPerFrame.toFixed(2)} ms / frame\n` +
				`  - Normal Reconstruction (1080p): ${normalsDurationPerFrame.toFixed(2)} ms / frame\n` +
				`  - Combined Conditioning Suite: ${(cannyDurationPerFrame + normalsDurationPerFrame).toFixed(2)} ms / frame`,
		);

		// Assert invariant: combined conditioning generation must be under 5ms,
		// well within the 100ms real-time ceiling
		expect(cannyDurationPerFrame).toBeLessThan(5.0);
		expect(normalsDurationPerFrame).toBeLessThan(5.0);
		expect(cannyDurationPerFrame + normalsDurationPerFrame).toBeLessThan(10.0);

		inputTexture.destroy();
		cannyPipeline.destroy();
		normalsPipeline.destroy();
	});
});
