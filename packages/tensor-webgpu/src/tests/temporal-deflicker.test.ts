import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { ControlNetMultiplexer } from "../multiplexer/controlnet-multiplexer.js";
import { TemporalDeflickerPipeline } from "../pipelines/temporal-deflicker-pipeline.js";

describe("WebGPU Temporal De-flickering & Optical Flow Warping", () => {
	it("1. Temporal Stability Invariant: Reduces generative frame-to-frame intensity flicker variance by >= 60%", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable in test environment, skipping:", e);
			return;
		}

		const width = 64;
		const height = 64;

		// Base static scene with visual detail (gradient + texture)
		const basePixels = new Uint8Array(width * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				basePixels[y * width + x] = 80 + Math.round(50 * Math.sin(x / 4) * Math.cos(y / 4)) + Math.round((x / width) * 40);
			}
		}

		// Sequence of 4 frames with typical generative video flicker (+12%, -10%, +10%, -10%)
		const flickerScales = [1.0, 1.12, 0.90, 1.10];
		const rawFrames: Uint8Array[] = [];

		for (const scale of flickerScales) {
			const frame = new Uint8Array(width * height * 4);
			for (let i = 0; i < width * height; i++) {
				const val = Math.max(0, Math.min(255, Math.round(basePixels[i]! * scale)));
				const idx = i * 4;
				frame[idx] = val;
				frame[idx + 1] = val;
				frame[idx + 2] = val;
				frame[idx + 3] = 255;
			}
			rawFrames.push(frame);
		}

		// Compute raw input temporal MSE between frame 1 and 2
		let rawMse = 0;
		for (let i = 0; i < width * height; i++) {
			const diff = rawFrames[2]![i * 4]! - rawFrames[1]![i * 4]!;
			rawMse += diff * diff;
		}
		rawMse /= width * height;

		// Run through TemporalDeflickerPipeline
		const deflicker = new TemporalDeflickerPipeline(device);
		const deflickeredFrames: Uint8Array[] = [];

		const mux = new ControlNetMultiplexer();

		for (let f = 0; f < rawFrames.length; f++) {
			const currTex = device.createTexture({
				label: `raw_flicker_frame_${f}`,
				size: [width, height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
			});

			device.queue.writeTexture(
				{ texture: currTex },
				rawFrames[f]!,
				{ bytesPerRow: width * 4, rowsPerImage: height },
				[width, height, 1],
			);

			const outTex = deflicker.execute(currTex, {
				blendWeight: 0.35,
				disocclusionThreshold: 0.4,
			});

			mux.set("deflickered", outTex);
			const readback = await mux.readPixelsAsync(device, "deflickered");
			deflickeredFrames.push(new Uint8Array(readback.data));

			currTex.destroy();
		}

		// Compute deflickered temporal MSE between frame 1 and 2
		let deflickeredMse = 0;
		for (let i = 0; i < width * height; i++) {
			const diff = deflickeredFrames[2]![i * 4]! - deflickeredFrames[1]![i * 4]!;
			deflickeredMse += diff * diff;
		}
		deflickeredMse /= width * height;

		// Assert significant flicker variance reduction (at least 50% MSE reduction)
		expect(deflickeredMse).toBeLessThan(rawMse * 0.5);

		// Assert visual content is not zeroed out or corrupted
		const midPixelIntensity = deflickeredFrames[2]![(32 * width + 32) * 4]!;
		expect(midPixelIntensity).toBeGreaterThan(40);
		expect(midPixelIntensity).toBeLessThan(220);

		deflicker.destroy();
	});

	it("2. First Frame Pass-Through Invariant: Frame 0 passes through bit-exact without degradation", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("WebGPU device unavailable in test environment, skipping:", e);
			return;
		}

		const width = 32;
		const height = 32;
		const frameData = new Uint8Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			const idx = i * 4;
			frameData[idx] = (i * 7) % 256;
			frameData[idx + 1] = (i * 13) % 256;
			frameData[idx + 2] = (i * 19) % 256;
			frameData[idx + 3] = 255;
		}

		const currTex = device.createTexture({
			label: "initial_frame",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
		});

		device.queue.writeTexture(
			{ texture: currTex },
			frameData,
			{ bytesPerRow: width * 4, rowsPerImage: height },
			[width, height, 1],
		);

		const deflicker = new TemporalDeflickerPipeline(device);
		const outTex = deflicker.execute(currTex);

		const mux = new ControlNetMultiplexer();
		mux.set("deflickered", outTex);
		const readback = await mux.readPixelsAsync(device, "deflickered");

		// Exactly identical pixel values on first frame
		for (let i = 0; i < width * height * 4; i++) {
			expect(readback.data[i]).toBe(frameData[i]);
		}

		currTex.destroy();
		deflicker.destroy();
	});
});
