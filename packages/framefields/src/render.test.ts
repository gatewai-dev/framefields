import fs from "node:fs/promises";
import type { VirtualMediaData } from "@framefields/core";
import { describe, expect, it } from "vitest";
import { mixAudioTracks } from "./audio/index.js";
import { Composition, Layer, Media } from "./index.js";
import { HeadlessMediaRenderer } from "./renderer/index.js";
import { buildWGSLSignalFn, SignalRegistry } from "./signals/index.js";

// Helper to verify PNG header and IHDR dimensions
function assertValidPng(
	buffer: Buffer,
	expectedWidth?: number,
	expectedHeight?: number,
) {
	expect(Buffer.isBuffer(buffer)).toBe(true);
	expect(buffer.length).toBeGreaterThan(100);

	// PNG Signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
	expect(buffer[0]).toBe(0x89);
	expect(buffer[1]).toBe(0x50);
	expect(buffer[2]).toBe(0x4e);
	expect(buffer[3]).toBe(0x47);
	expect(buffer[4]).toBe(0x0d);
	expect(buffer[5]).toBe(0x0a);
	expect(buffer[6]).toBe(0x1a);
	expect(buffer[7]).toBe(0x0a);

	// IHDR chunk: width at byte 16, height at byte 20
	if (expectedWidth !== undefined) {
		const width = buffer.readUInt32BE(16);
		expect(width).toBe(expectedWidth);
	}
	if (expectedHeight !== undefined) {
		const height = buffer.readUInt32BE(20);
		expect(height).toBe(expectedHeight);
	}
}

describe("Framefields Rendering Engine", () => {
	const renderer = new HeadlessMediaRenderer();

	describe("1. Composition Rendering", () => {
		it("should render a multi-layer composition with background, shapes, and text to PNG", async () => {
			const comp = new Composition({
				width: 640,
				height: 360,
				fps: 30,
				durationMs: 2000,
				backgroundColor: "#0d1117",
			});

			comp.add(
				Layer.shape("rect", {
					fillColor: "#238636",
					width: 300,
					height: 180,
					x: 40,
					y: 40,
					borderRadius: 12,
				}),
			);

			comp.add(
				Layer.shape("circle", {
					fillColor: "#1f6feb",
					width: 100,
					height: 100,
					x: 450,
					y: 150,
				}),
			);

			comp.add(
				Layer.text("Framefields WebGPU Engine", {
					fontSize: 28,
					fill: "#ffffff",
					x: 60,
					y: 280,
				}),
			);

			const vm = comp.toVirtualMedia();
			expect(vm.operation.op).toBe("Compositor");
			expect(vm.metadata.width).toBe(640);
			expect(vm.metadata.height).toBe(360);

			const pngBuffer = await renderer.renderImage(vm, 0, 30);
			assertValidPng(pngBuffer, 640, 360);
		});

		it("should render nested flex and box layouts deterministically", async () => {
			const comp = new Composition({
				width: 800,
				height: 450,
				fps: 30,
				durationMs: 1000,
				backgroundColor: "#161b22",
			});

			comp.add(
				Layer.flex({
					dir: "row",
					gap: 20,
					children: [
						Layer.box({
							width: 200,
							height: 150,
							background: "#8957e5",
							children: [
								Layer.text("Box A", { fontSize: 20, fill: "#ffffff" }),
							],
						}),
						Layer.box({
							width: 200,
							height: 150,
							background: "#da3633",
							children: [
								Layer.text("Box B", { fontSize: 20, fill: "#ffffff" }),
							],
						}),
					],
				}),
			);

			const vm = comp.toVirtualMedia();
			const pngBuffer = await renderer.renderImage(vm, 0, 30);
			assertValidPng(pngBuffer, 800, 450);
		});
	});

	describe("2. Chained 2D VFX Shader Pipeline", () => {
		it("should apply Blur, Vignette, Levels, and Flip shader nodes in sequence", async () => {
			const baseVM: VirtualMediaData = {
				metadata: { width: 480, height: 270, fps: 30, durationMs: 1000 },
				operation: {
					op: "Paint",
					dataType: "Video",
					backgroundColor: "#1f6feb",
					timeline: { startFrame: 0, segments: [{ startSec: 0, endSec: 1 }] },
				},
				children: [],
			};

			const media = new Media(baseVM)
				.apply("Blur", { strength: 10 })
				.apply("Vignette", { strength: 70, radius: 0.5 })
				.apply("Levels", {})
				.apply("Flip", { horizontal: true, vertical: false })
				.apply("FilmGrain", { strength: 25 });

			const pipelineVM = media.toVirtualMedia();
			expect(pipelineVM.operation.op).toBe("FilmGrain");

			const pngBuffer = await renderer.renderImage(pipelineVM, 0, 30);
			assertValidPng(pngBuffer, 480, 270);
		});

		it("should render color grading with ColorBalance and HalftoneScreen", async () => {
			const baseVM: VirtualMediaData = {
				metadata: { width: 320, height: 240, fps: 24, durationMs: 1000 },
				operation: {
					op: "Paint",
					dataType: "Video",
					backgroundColor: "#f0883e",
					timeline: { startFrame: 0, segments: [{ startSec: 0, endSec: 1 }] },
				},
				children: [],
			};

			const media = new Media(baseVM)
				.apply("ColorBalance", {
					shadows: { cyanRed: 10, magentaGreen: 0, yellowBlue: -10 },
					midtones: { cyanRed: 0, magentaGreen: 5, yellowBlue: 0 },
				})
				.apply("HalftoneScreen", { frequency: 30 });

			const pipelineVM = media.toVirtualMedia();
			const pngBuffer = await renderer.renderImage(pipelineVM, 0, 24);
			assertValidPng(pngBuffer, 320, 240);
		});
	});

	describe("3. Video Export Rendering", () => {
		it("should render and multiplex an animated video composition to MP4", async () => {
			const comp = new Composition({
				width: 320,
				height: 240,
				fps: 24,
				durationMs: 1000,
				backgroundColor: "#0366d6",
			});

			comp.add(
				Layer.shape("rect", {
					fillColor: "#ffffff",
					width: 100,
					height: 100,
					x: 50,
					y: 50,
				}),
			);

			const vm = comp.toVirtualMedia();

			const { filePath, cleanup } = await renderer.renderVideo(vm, {
				codec: "h264",
				quality: "low",
				concurrency: 2,
			});

			try {
				const stat = await fs.stat(filePath);
				expect(stat.size).toBeGreaterThan(500);

				const videoHeader = Buffer.alloc(16);
				const fh = await fs.open(filePath, "r");
				await fh.read(videoHeader, 0, 16, 0);
				await fh.close();

				const ftyp = videoHeader.toString("ascii", 4, 8);
				expect(ftyp).toBe("ftyp");
			} finally {
				await cleanup();
			}

			await expect(fs.stat(filePath)).rejects.toThrow();
		});
	});

	describe("4. Audio DSP & Mixing Pipeline", () => {
		it("should extract and mix multi-channel audio tracks from composition", async () => {
			const comp = new Composition({
				width: 640,
				height: 360,
				fps: 30,
				durationMs: 1000,
			});
			comp.addAudio(
				Layer.audio("https://example.com/soundtrack.mp3", { volume: 0.8 }),
			);

			const vm = comp.toVirtualMedia();
			const result = await mixAudioTracks(vm, 30, 48000);

			expect(result).toBeDefined();
			expect(result.sampleRate).toBe(48000);
			expect(Array.isArray(result.channels)).toBe(true);
			expect(result.channels.length).toBeGreaterThanOrEqual(1);

			// Verify samples are allocated and valid floats
			const channel0 = result.channels[0];
			expect(channel0.length).toBe(48000);
			expect(channel0 instanceof Float32Array).toBe(true);
			for (let i = 0; i < Math.min(channel0.length, 1000); i++) {
				expect(Number.isNaN(channel0[i])).toBe(false);
			}
		});
	});

	describe("5. Reactive Signals Pipeline", () => {
		it("should manage signal statistics and generate deterministic WGSL code", () => {
			const registry = new SignalRegistry();
			registry.setStats("audio_bass", { min: 0.1, max: 0.95 });

			const stats = registry.getStats("audio_bass");
			expect(stats).toBeDefined();
			expect(stats?.min).toBe(0.1);
			expect(stats?.max).toBe(0.95);

			const fnResult = buildWGSLSignalFn({ baseType: "sine" }, "sample_bass");
			expect(fnResult).toBeDefined();
			expect(fnResult.name).toBe("signal_sample_bass");
			expect(typeof fnResult.wgsl).toBe("string");
			expect(fnResult.wgsl.length).toBeGreaterThan(0);
			expect(fnResult.wgsl).toContain("fn signal_sample_bass");
		});
	});
});
