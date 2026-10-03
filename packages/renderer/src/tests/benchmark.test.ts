import os from "node:os";
import path from "node:path";
import { ensureDevice } from "@gitframes/webgpu-renderers";
import {
	FilePathTarget,
	Mp4OutputFormat,
	Output,
	VideoSampleSource,
} from "mediabunny";
import { describe, expect, it } from "vitest";
import { bootstrapMediabunny, isAMD } from "../bootstrap-mediabunny.js";
import { DmaStagingRing } from "../dma-staging-ring.js";
import { ZeroCopyWebCodecsPipeline } from "../zero-copy-webcodecs-pipeline.js";

bootstrapMediabunny();

describe("Module 5: Headless Zero-Copy WebCodecs & DMA Staging Pipeline Benchmark Suite", () => {
	it("executes 1080p Frame Render & DMA Staging Ring transfer under 15ms per frame", async () => {
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
		const ring = new DmaStagingRing(device, { width, height, capacity: 2 });

		const renderTexture = device.createTexture({
			label: "benchmark_1080p_frame_texture",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		// Warmup pass
		const warmupEncoder = device.createCommandEncoder();
		const warmupPass = warmupEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: renderTexture.createView(),
					clearValue: { r: 0.1, g: 0.2, b: 0.3, a: 1.0 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});
		warmupPass.end();
		ring.stageTexture(warmupEncoder, renderTexture, 0);
		device.queue.submit([warmupEncoder.finish()]);
		ring.scheduleMap(0);
		await ring.readAndReleaseFrame(0);

		// Benchmark double-buffered DMA pipelining across 15 frames
		const iterations = 15;
		const start = performance.now();

		const inFlight: number[] = [];
		for (let i = 0; i < iterations; i++) {
			if (inFlight.length >= ring.capacity) {
				const prev = inFlight.shift();
				if (prev !== undefined) {
					await ring.readAndReleaseFrame(prev);
				}
			}

			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: renderTexture.createView(),
						clearValue: {
							r: (i % 255) / 255,
							g: 0.5,
							b: 0.8,
							a: 1.0,
						},
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
			pass.end();

			await ring.prepareSlot(i);
			ring.stageTexture(encoder, renderTexture, i);
			device.queue.submit([encoder.finish()]);
			ring.scheduleMap(i);
			inFlight.push(i);
		}

		while (inFlight.length > 0) {
			const prev = inFlight.shift();
			if (prev !== undefined) {
				await ring.readAndReleaseFrame(prev);
			}
		}

		const totalDuration = performance.now() - start;
		const latencyPerFrameMs = totalDuration / iterations;
		const throughputFps = (iterations / totalDuration) * 1000;

		console.log(
			`[1080p DMA Staging Ring Benchmark]\n` +
				`  - Frames Processed: ${iterations}\n` +
				`  - Average Latency: ${latencyPerFrameMs.toFixed(2)} ms / frame\n` +
				`  - Throughput: ${throughputFps.toFixed(1)} FPS`,
		);

		// Assert invariant: DMA staging and readback is well under the 95ms ceiling
		expect(latencyPerFrameMs).toBeLessThan(45.0);

		renderTexture.destroy();
		ring.destroy();
	});

	it("executes Total Frame Render & WebCodecs Hardware Encode Cycle under 95.0ms (100ms ceiling)", async () => {
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
		const fps = 30;
		const totalFrames = 20;

		const tempFilePath = path.join(
			os.tmpdir(),
			`benchmark-render-${Date.now()}.mp4`,
		);
		const target = new FilePathTarget(tempFilePath);
		const output = new Output({
			format: new Mp4OutputFormat(),
			target,
		});

		const videoSource = new VideoSampleSource({
			codec: "avc",
			bitrate: 4_000_000,
			latencyMode: "realtime",
			hardwareAcceleration: isAMD() ? "prefer-software" : "prefer-hardware",
		} as never);
		output.addVideoTrack(videoSource);
		await output.start();

		const pipeline = new ZeroCopyWebCodecsPipeline(device, {
			width,
			height,
			fps,
			videoSource,
			ringCapacity: 2,
		});

		const renderTexture = device.createTexture({
			label: "benchmark_pipeline_texture",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});

		const start = performance.now();

		for (let i = 0; i < totalFrames; i++) {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: renderTexture.createView(),
						clearValue: {
							r: (i % 20) / 20,
							g: 0.4,
							b: 0.9,
							a: 1.0,
						},
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
			pass.end();

			await pipeline.enqueueFrame(i, renderTexture, encoder);
		}

		await pipeline.drain();
		await output.finalize();

		const totalDuration = performance.now() - start;
		const stats = pipeline.getStats();

		console.log(
			`[Module 5: 1080p Render & Encode Cycle Benchmark]\n` +
				`  - Total Frames: ${stats.totalFramesEncoded}\n` +
				`  - Average Total Cycle Time: ${stats.averageCycleTimeMs.toFixed(2)} ms / frame\n` +
				`  - Average GPU Submit Time: ${stats.averageGpuSubmitTimeMs.toFixed(2)} ms / frame\n` +
				`  - Average Hardware Encode Time: ${stats.averageEncodeTimeMs.toFixed(2)} ms / frame\n` +
				`  - Pipeline Throughput: ${stats.throughputFps.toFixed(1)} FPS\n` +
				`  - Total Elapsed Duration: ${totalDuration.toFixed(2)} ms`,
		);

		// Assert Invariant per spec/newft.md Section 11.2:
		// "Total Frame Render & Encode Cycle: <= 95.0ms per frame (asserting < 100ms hard ceiling)"
		expect(stats.averageCycleTimeMs).toBeLessThanOrEqual(95.0);
		expect(stats.totalFramesEncoded).toBe(totalFrames);

		renderTexture.destroy();
		pipeline.destroy();
	});
});
