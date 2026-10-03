import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDevice } from "../device.js";
import { signalRegistry } from "../signals/signal-registry.js";
import { drawSignalNode } from "./signal.js";

describe("Signal Node Audio Integration", () => {
	it("extracts features and draws non-zero waveform into WebGPU render pass", async () => {
		const wavPath = path.resolve(
			__dirname,
			"../../../../stracth/heavy-rough-synth-bass_130bpm_G_minor.wav",
		);
		if (!fs.existsSync(wavPath)) {
			console.warn("WAV file not found, skipping");
			return;
		}

		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("No WebGPU device available, skipping:", e);
			return;
		}

		const renderTarget = device.createTexture({
			size: [256, 256, 1],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.COPY_SRC |
				GPUTextureUsage.TEXTURE_BINDING,
		});

		const renderView = renderTarget.createView();
		const encoder = device.createCommandEncoder();

		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: renderView,
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear",
					storeOp: "store",
				},
			],
		});

		const tempBuffers: GPUBuffer[] = [];
		const mockCtx = {
			device,
			renderer: {
				format: "rgba8unorm" as GPUTextureFormat,
				getTemporaryBuffer: (data: ArrayBufferView) => {
					const buf = device.createBuffer({
						size: Math.max(data.byteLength, 16),
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
					});
					device.queue.writeBuffer(buf, 0, data as unknown as ArrayBuffer);
					tempBuffers.push(buf);
					return buf;
				},
				samplerCache: {
					getSampler: (d: GPUDevice, desc?: GPUSamplerDescriptor) => {
						return d.createSampler(desc);
					},
				},
			},
		};

		const props = {
			nodeId: "extractor-node-test",
			sourceUrl: wavPath,
			signalConfig: {
				nodeId: "extractor-node-test",
				sourceUrl: wavPath,
				extractionMode: "rms_envelope" as const,
				sensitivity: 1.0,
			},
			frame: 0,
			fps: 24,
			width: 256,
			height: 256,
		};

		await drawSignalNode(mockCtx as any, encoder, pass, props);
		pass.end();

		// Copy renderTarget to readback buffer
		const bytesPerRow = 256 * 4;
		const readBuffer = device.createBuffer({
			size: bytesPerRow * 256,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		encoder.copyTextureToBuffer(
			{ texture: renderTarget },
			{ buffer: readBuffer, bytesPerRow },
			[256, 256, 1],
		);

		device.queue.submit([encoder.finish()]);

		await readBuffer.mapAsync(GPUMapMode.READ);
		const pixelData = new Uint8Array(readBuffer.getMappedRange().slice(0));
		readBuffer.unmap();

		// Cleanup
		renderTarget.destroy();
		readBuffer.destroy();
		for (const b of tempBuffers) b.destroy();

		// Count non-background pixels (background is ~rgb(18, 18, 20))
		let nonBackgroundPixels = 0;
		let blueCurvePixels = 0;
		for (let i = 0; i < pixelData.length; i += 4) {
			const r = pixelData[i];
			const g = pixelData[i + 1];
			const b = pixelData[i + 2];
			// Check if pixel is part of cyan/blue curve (b > 100, g > 50)
			if (b > 100 && g > 50) {
				blueCurvePixels++;
			}
			if (r > 30 || g > 30 || b > 40) {
				nonBackgroundPixels++;
			}
		}

		console.log(
			`Rendered signal canvas: blueCurvePixels=${blueCurvePixels}, nonBackgroundPixels=${nonBackgroundPixels}`,
		);

		expect(blueCurvePixels).toBeGreaterThan(50);
	});
});
