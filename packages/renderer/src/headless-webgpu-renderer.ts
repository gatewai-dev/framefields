import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function convertMp4ToGif(
	inputMp4Path: string,
	outputGifPath: string,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const ffmpeg = spawn("ffmpeg", [
			"-i",
			inputMp4Path,
			"-vf",
			"split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
			"-y",
			outputGifPath,
		]);

		let errorOutput = "";
		ffmpeg.stderr.on("data", (data) => {
			errorOutput += data.toString();
		});

		ffmpeg.on("close", async (code) => {
			if (code === 0) {
				resolve();
			} else {
				rendererLogger.error(
					{ code, err: errorOutput },
					"[convertMp4ToGif] ffmpeg conversion failed",
				);
				reject(new Error(`ffmpeg exited with code ${code}: ${errorOutput}`));
			}
		});

		ffmpeg.on("error", (err) => {
			rendererLogger.error({ err }, "[convertMp4ToGif] ffmpeg spawn error");
			reject(err);
		});
	});
}

import {
	compositionStateStore,
	drawCompositionTree,
	mixAudioTracks,
} from "@framefields/compositions";
import {
	getMediaType,
	takeRenderDiagnostics,
	updateClockSignals,
	type VirtualMediaData,
} from "@framefields/core";
import { rendererLogger } from "@framefields/server-utils";
import {
	clearAllVideoCache,
	ensureDevice,
	getRenderer2D,
	initHeadlessWebGPU,
	inputStore,
	lutStore,
	mediaDecoderCache,
	NodeSurfaceProvider,
	type RenderContextValue,
	Renderer2D,
	shaderStore,
	SlugFontCache,
	textureCache,
	WebGPUAudioProcessor,
} from "@framefields/webgpu-renderers";
import {
	AudioSample,
	AudioSampleSource,
	FilePathTarget,
	Mp3OutputFormat,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	QUALITY_LOW,
	QUALITY_VERY_HIGH,
	QUALITY_VERY_LOW,
	VideoSampleSource,
	WebMOutputFormat,
} from "mediabunny";
import sharp from "sharp";
import { Canvas as SkiaCanvas, Image as SkiaImage } from "skia-canvas";
import { preloadFonts } from "./asset-preloader.js";
import { discoverAndRegisterNodeRenderers } from "./dynamic-node-discovery.js";
import {
	type AudioQaStats,
	analyzeAudio,
	buildQaReport,
	FrameInspector,
	type VideoQaOptions,
	type VideoQaReport,
	type VideoQaStats,
} from "./video-qa.js";
import { ZeroCopyWebCodecsPipeline } from "./zero-copy-webcodecs-pipeline.js";

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

import { bootstrapMediabunny, isAMD } from "./bootstrap-mediabunny.js";

bootstrapMediabunny();

const globalObj = globalThis as unknown as Record<string, unknown>;

if (typeof globalThis !== "undefined") {
	globalObj.__IS_HEADLESS_RENDERER__ = true;
	globalObj.__GATEWAI_DELAYS__ ??= new Set<number>();
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
	globalObj.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
	globalObj.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

const dummyDomElement = {
	clientWidth: 1920,
	clientHeight: 1080,
	getBoundingClientRect: () => ({
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		right: 1920,
		bottom: 1080,
		width: 1920,
		height: 1080,
	}),
	style: {},
	appendChild: () => {},
	removeChild: () => {},
	addEventListener: () => {},
	removeEventListener: () => {},
	getAttribute: () => null,
};

if (typeof globalThis.OffscreenCanvas === "undefined") {
	(globalObj.OffscreenCanvas as unknown) = SkiaCanvas;
}

if (typeof globalThis.HTMLCanvasElement === "undefined") {
	(globalObj.HTMLCanvasElement as unknown) = SkiaCanvas;
}

if (typeof globalThis.Image === "undefined") {
	(globalObj.Image as unknown) = SkiaImage;
}

if (typeof globalThis.window === "undefined") {
	(globalObj.window as unknown) = globalThis;
}
if (!globalThis.location) {
	(globalObj.location as unknown) = new URL("http://localhost");
}

if (typeof globalThis.IntersectionObserver === "undefined") {
	(globalObj.IntersectionObserver as unknown) = class IntersectionObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

if (typeof globalThis.document === "undefined") {
	(globalObj.document as unknown) = {
		createElement: (tag: string) => {
			if (tag === "canvas") return new SkiaCanvas(1, 1);
			return { ...dummyDomElement };
		},
		getElementsByTagName: () => [],
		documentElement: dummyDomElement,
		body: dummyDomElement,
	};
} else {
	const docObj = globalThis.document as unknown as Record<string, unknown>;
	if (typeof docObj.getElementsByTagName === "undefined") {
		docObj.getElementsByTagName = () => [];
	}
	docObj.documentElement ??= dummyDomElement;
	docObj.body ??= dummyDomElement;
}

const skiaProto = SkiaCanvas.prototype as unknown as Record<string, unknown>;
if (typeof skiaProto.getBoundingClientRect === "undefined") {
	skiaProto.getBoundingClientRect = function (this: {
		width?: number;
		height?: number;
	}) {
		const width = this.width || 512;
		const height = this.height || 512;
		return {
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: width,
			bottom: height,
			width,
			height,
		};
	};
}

if (!("style" in skiaProto)) {
	Object.defineProperty(skiaProto, "style", {
		get(this: { _style?: Record<string, unknown> }) {
			this._style ??= {};
			return this._style;
		},
		configurable: true,
	});
}

if (!("clientWidth" in skiaProto)) {
	Object.defineProperty(skiaProto, "clientWidth", {
		get(this: { width?: number }) {
			return this.width || 512;
		},
		configurable: true,
	});
}

if (!("clientHeight" in skiaProto)) {
	Object.defineProperty(skiaProto, "clientHeight", {
		get(this: { height?: number }) {
			return this.height || 512;
		},
		configurable: true,
	});
}

if (!("parentElement" in skiaProto)) {
	Object.defineProperty(skiaProto, "parentElement", {
		get() {
			return dummyDomElement;
		},
		configurable: true,
	});
}

if (typeof skiaProto.addEventListener === "undefined") {
	skiaProto.addEventListener = () => {};
}
if (typeof skiaProto.removeEventListener === "undefined") {
	skiaProto.removeEventListener = () => {};
}
if (typeof skiaProto.getAttribute === "undefined") {
	skiaProto.getAttribute = () => null;
}

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WorkerInput {
	virtualMedia: VirtualMediaData;
	width: number;
	height: number;
	fps: number;
	startFrame: number;
	endFrame: number;
	renderId: string;
	outputFormat: "png" | "pixels";
	workerIndex: number;
}

export type WorkerMessage =
	| { type: "frame"; renderId: string; frameIndex: number; pixels: Uint8Array }
	| { type: "png"; renderId: string; data: Uint8Array }
	| { type: "done"; renderId: string }
	| {
			type: "lut";
			renderId: string;
			raw: {
				points: Array<[number, number, number]>;
				size: number;
				type: "1D" | "3D";
			};
	  }
	| { type: "error"; renderId?: string; error: string };

// ─── Concurrency Limiter ───────────────────────────────────────────────────────

const CPU_COUNT = os.cpus().length;
const TOTAL_WORKER_BUDGET = Math.max(1, CPU_COUNT - 3);

// Balance concurrency (renders processed in parallel) and internal parallelism (workers per render).
// For rendering stability on headless instances, we limit MAX_CONCURRENT_RENDERS to 1-3.
const MAX_CONCURRENT_RENDERS = Math.max(
	1,
	Math.min(3, Math.floor(TOTAL_WORKER_BUDGET / 3)),
);

const QUEUE_TIMEOUT_MS = 2 * 60 * 60_000; // 2 hours

class RenderSemaphore {
	private _running = 0;
	private readonly _max: number;
	private readonly _queue: Array<{
		resolve: () => void;
		reject: (err: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];

	constructor(max: number) {
		this._max = max;
	}

	acquire(timeoutMs = QUEUE_TIMEOUT_MS): Promise<void> {
		if (this._running < this._max) {
			this._running++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this._queue.findIndex((e) => e.resolve === resolve);
				if (idx !== -1) this._queue.splice(idx, 1);
				reject(
					new Error(
						`Render queue timeout after ${timeoutMs}ms ` +
							`(${this._queue.length} queued, ${this._running}/${this._max} active)`,
					),
				);
			}, timeoutMs);
			this._queue.push({ resolve, reject, timer });
		});
	}

	release(): void {
		if (this._queue.length > 0) {
			const next = this._queue.shift()!;
			clearTimeout(next.timer);
			next.resolve();
		} else {
			this._running--;
		}
	}

	get stats() {
		return {
			active: this._running,
			queued: this._queue.length,
			max: this._max,
		};
	}
}

export const renderSemaphore = new RenderSemaphore(MAX_CONCURRENT_RENDERS);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toEvenDimension(n: number): number {
	const v = Math.round(n);
	return v % 2 === 0 ? v : v + 1;
}

function resolveQuality(quality?: string) {
	switch (quality) {
		case "very_low":
			return QUALITY_VERY_LOW;
		case "low":
			return QUALITY_LOW;
		case "high":
			return QUALITY_HIGH;
		case "very_high":
			return QUALITY_VERY_HIGH;
		default:
			return QUALITY_VERY_HIGH;
	}
}

function formatLutAsCube(lut: {
	points: Array<[number, number, number]>;
	size: number;
	type: "1D" | "3D";
}): string {
	const lines = [
		"# Created by Gatewai",
		lut.type === "3D" ? `LUT_3D_SIZE ${lut.size}` : `LUT_1D_SIZE ${lut.size}`,
		"",
	];
	for (const p of lut.points) {
		lines.push(`${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);
	}
	return lines.join("\n");
}

// ─── HeadlessWebGPURenderer ───────────────────────────────────────────────────

export class HeadlessWebGPURenderer {
	private static isInitialized = false;
	private static initPromise: Promise<void> | null = null;
	private static initFailureCount = 0;
	private static readonly MAX_INIT_FAILURES = 3;
	private static nextRetryAt = 0;

	public static initialize(): Promise<void> {
		if (HeadlessWebGPURenderer.isInitialized) return Promise.resolve();

		if (
			HeadlessWebGPURenderer.initFailureCount >=
			HeadlessWebGPURenderer.MAX_INIT_FAILURES
		) {
			return Promise.reject(
				new Error(
					"GPU initialization permanently failed — circuit breaker open",
				),
			);
		}

		if (Date.now() < HeadlessWebGPURenderer.nextRetryAt) {
			return Promise.reject(new Error("GPU initialization in backoff period"));
		}

		if (HeadlessWebGPURenderer.initPromise) {
			return HeadlessWebGPURenderer.initPromise;
		}

		HeadlessWebGPURenderer.initPromise = (async () => {
			try {
				rendererLogger.debug(
					"[HeadlessWebGPURenderer] Initializing headless WebGPU…",
				);
				await initHeadlessWebGPU();
				rendererLogger.debug(
					"[HeadlessWebGPURenderer] Scanning node renderers…",
				);
				await discoverAndRegisterNodeRenderers();
				HeadlessWebGPURenderer.isInitialized = true;
				HeadlessWebGPURenderer.initPromise = null;
				HeadlessWebGPURenderer.initFailureCount = 0;
				HeadlessWebGPURenderer.nextRetryAt = 0;
				rendererLogger.debug(
					"[HeadlessWebGPURenderer] Initialization complete.",
				);
			} catch (error) {
				HeadlessWebGPURenderer.initFailureCount++;
				HeadlessWebGPURenderer.nextRetryAt =
					Date.now() + 5000 * 2 ** HeadlessWebGPURenderer.initFailureCount;
				HeadlessWebGPURenderer.initPromise = null; // allow retry
				rendererLogger.error(
					{
						err: error instanceof Error ? error.message : String(error),
						failureCount: HeadlessWebGPURenderer.initFailureCount,
						nextRetryAt: new Date(
							HeadlessWebGPURenderer.nextRetryAt,
						).toISOString(),
					},
					"[HeadlessWebGPURenderer] Initialization failed",
				);
				throw error;
			}
		})();

		return HeadlessWebGPURenderer.initPromise;
	}

	public async renderImage(
		virtualMedia: VirtualMediaData,
		frame = 0,
		fps = 24,
		options: {
			renderId?: string;
			/** "rgba" skips PNG encoding and returns width*height*4 raw pixels. */
			format?: "png" | "rgba";
		} = {},
	): Promise<Buffer> {
		await HeadlessWebGPURenderer.initialize();

		const width = toEvenDimension(virtualMedia.metadata.width ?? 0);
		const height = toEvenDimension(virtualMedia.metadata.height ?? 0);
		if (!width || !height)
			throw new Error(`Invalid dimensions: ${width}x${height}`);

		// A caller rendering consecutive frames (e.g. a scrubbing preview) passes a
		// stable id so compiled timelines are reused across frames, as renderVideo
		// does. Never render two frames with the same id concurrently.
		const renderId = options.renderId ?? `img-${randomUUID()}`;

		rendererLogger.debug(
			{ renderId, frame, ...renderSemaphore.stats },
			"[HeadlessWebGPURenderer] Acquiring slot for image render",
		);

		await renderSemaphore.acquire();
		let surface: NodeSurfaceProvider | undefined;
		let renderer: Renderer2D | undefined;
		const device = await ensureDevice();

		try {
			await preloadFonts(virtualMedia, device);
			surface = new NodeSurfaceProvider(device, width, height);
			renderer = getRenderer2D(device, surface.colorFormat);
			const ctx: RenderContextValue = { device, renderer, surface };
			updateClockSignals(
				frame,
				fps,
				virtualMedia.metadata.durationMs ?? undefined,
			);

			const needsPrePass =
				frame === 0 ||
				lutStore.hasPending(device) ||
				SlugFontCache.hasPending();

			if (needsPrePass) {
				const preEncoder = device.createCommandEncoder();
				const dummyTex = renderer.getTemporaryTexture(width, height);
				const dummyView = dummyTex.createView();
				const preClear = renderer.beginFrame(
					preEncoder,
					dummyView,
					{ r: 0, g: 0, b: 0, a: 0 },
					width,
					height,
					"clear",
				);
				preClear.end();

				await drawCompositionTree(
					ctx,
					preEncoder,
					dummyView,
					dummyTex,
					width,
					height,
					virtualMedia,
					{
						frame,
						fps,
						isHeadless: true,
						renderId,
						virtualMedia,
						containerWidth: width,
						containerHeight: height,
						isVideoMode: virtualMedia.operation?.dataType === "Video",
					},
				);

				device.queue.submit([preEncoder.finish()]);
				await lutStore.awaitAllPending(device);
			}

			compositionStateStore.setState(renderId, frame, fps, true);

			const encoder = device.createCommandEncoder();
			const targetView = surface.getCurrentTextureView();
			const targetTexture = surface.getCurrentTexture();

			const clearPass = renderer.beginFrame(
				encoder,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				width,
				height,
				"clear",
			);
			clearPass.end();

			await drawCompositionTree(
				ctx,
				encoder,
				targetView,
				targetTexture,
				width,
				height,
				virtualMedia,
				{
					frame,
					fps,
					isHeadless: true,
					renderId,
					virtualMedia,
					containerWidth: width,
					containerHeight: height,
					isVideoMode: virtualMedia.operation?.dataType === "Video",
				},
			);

			device.queue.submit([encoder.finish()]);

			const pixels = await surface.readPixels();
			const pixelsArr = new Uint8Array(
				pixels.buffer,
				pixels.byteOffset,
				pixels.byteLength,
			);

			if (options.format === "rgba") return Buffer.from(pixelsArr);

			const pngBuffer = await sharp(Buffer.from(pixelsArr), {
				raw: { width, height, channels: 4 },
			})
				.png()
				.toBuffer();

			return pngBuffer;
		} finally {
			try {
				clearAllVideoCache();
			} catch {}
			try {
				shaderStore.clear(renderId);
			} catch {}
			// NOTE: do NOT mediaDecoderCache.destroy() or device.destroy()/reset here.
			// The mediabunny Input (native demuxer over file://) can only be created
			// ONCE per URL in a process — a 2nd Input fails format detection with
			// "UnsupportedInputFormatError". renderImage is called repeatedly for
			// multi-frame exports, so keep the decoder (and the singleton WebGPU
			// device) alive to reuse + seek across frames — mirroring renderVideo.
			// Per-frame textures / surfaces are still released to bound VRAM.
			try {
				surface?.destroy();
			} catch {}
			try {
				textureCache.destroy();
			} catch {}
			renderSemaphore.release();
			rendererLogger.debug(
				{ renderId, ...renderSemaphore.stats },
				"[HeadlessWebGPURenderer] Image render slot released",
			);
		}
	}

	/**
	 * Renders a single frame to a PNG buffer at a specified timestamp in milliseconds or frame index.
	 */
	public async renderFrame(
		source: VirtualMediaData | { toVirtualMedia(): VirtualMediaData },
		options: {
			atMs?: number;
			frame?: number;
			fps?: number;
			/** Reuse compiled state across calls; see `renderImage`. */
			renderId?: string;
			/** "rgba" returns raw width*height*4 pixels instead of a PNG. */
			format?: "png" | "rgba";
		} = {},
	): Promise<Buffer> {
		const vm =
			typeof source === "object" &&
			source !== null &&
			"toVirtualMedia" in source
				? (source as { toVirtualMedia(): VirtualMediaData }).toVirtualMedia()
				: (source as VirtualMediaData);
		const fps = options.fps ?? (vm.metadata?.fps || 30);
		const frame =
			options.atMs !== undefined
				? Math.round((options.atMs / 1000) * fps)
				: (options.frame ?? 0);
		return this.renderImage(vm, frame, fps, {
			renderId: options.renderId,
			format: options.format,
		});
	}

	/**
	 * Mixes the composition's full audio timeline (clips, effects, synthesized
	 * tracks) to stereo PCM, exactly as `renderVideo` muxes it.
	 */
	public async renderAudio(
		virtualMedia: VirtualMediaData,
		options: { fps?: number; sampleRate?: number } = {},
	): Promise<{ channels: Float32Array[]; sampleRate: number }> {
		await HeadlessWebGPURenderer.initialize();
		const fps = options.fps ?? (virtualMedia.metadata?.fps || 30);
		await renderSemaphore.acquire();
		try {
			const device = await ensureDevice();
			return await mixAudioTracks(
				virtualMedia,
				fps,
				options.sampleRate ?? 48_000,
				device,
				`aud-${randomUUID()}`,
			);
		} finally {
			renderSemaphore.release();
		}
	}

	public async renderLut(
		virtualMedia: VirtualMediaData,
		frame = 0,
		fps = 24,
	): Promise<Buffer> {
		await HeadlessWebGPURenderer.initialize();

		const width = 32;
		const height = 32;
		const renderId = `lut-${randomUUID()}`;

		rendererLogger.debug(
			{ renderId, frame, ...renderSemaphore.stats },
			"[HeadlessWebGPURenderer] Acquiring slot for LUT render",
		);

		await renderSemaphore.acquire();
		let surface: NodeSurfaceProvider | undefined;
		let renderer: Renderer2D | undefined;
		const device = await ensureDevice();
		let lutData: any = null;

		const lutSub = lutStore.onChange((key) => {
			const raw = lutStore.getRawData(key);
			if (raw) {
				lutData = raw;
			}
		});

		try {
			await preloadFonts(virtualMedia, device);
			surface = new NodeSurfaceProvider(device, width, height);
			renderer = getRenderer2D(device, surface.colorFormat);
			const ctx: RenderContextValue = { device, renderer, surface };

			const needsPrePass =
				frame === 0 ||
				lutStore.hasPending(device) ||
				SlugFontCache.hasPending();

			if (needsPrePass) {
				const preEncoder = device.createCommandEncoder();
				const dummyTex = renderer.getTemporaryTexture(width, height);
				const dummyView = dummyTex.createView();

				const preClear = renderer.beginFrame(
					preEncoder,
					dummyView,
					{ r: 0, g: 0, b: 0, a: 0 },
					width,
					height,
					"clear",
				);
				preClear.end();

				await drawCompositionTree(
					ctx,
					preEncoder,
					dummyView,
					dummyTex,
					width,
					height,
					virtualMedia,
					{
						frame,
						fps,
						isHeadless: true,
						renderId,
						virtualMedia,
						containerWidth: width,
						containerHeight: height,
						isVideoMode: virtualMedia.operation?.dataType === "Video",
					},
				);

				device.queue.submit([preEncoder.finish()]);
				await lutStore.awaitAllPending(device);
			}

			compositionStateStore.setState(renderId, frame, fps, true);

			const encoder = device.createCommandEncoder();
			const targetView = surface.getCurrentTextureView();
			const targetTexture = surface.getCurrentTexture();

			const clearPass = renderer.beginFrame(
				encoder,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				width,
				height,
				"clear",
			);
			clearPass.end();

			await drawCompositionTree(
				ctx,
				encoder,
				targetView,
				targetTexture,
				width,
				height,
				virtualMedia,
				{
					frame,
					fps,
					isHeadless: true,
					renderId,
					virtualMedia,
					containerWidth: width,
					containerHeight: height,
					isVideoMode: virtualMedia.operation?.dataType === "Video",
				},
			);

			device.queue.submit([encoder.finish()]);
			await lutStore.awaitAllPending(device);

			if (!lutData) {
				lutData = lutStore.getAnyRawData();
			}
			if (!lutData) {
				throw new Error("No LUT data generated during rendering");
			}

			const cubeContent = formatLutAsCube(lutData);
			return Buffer.from(cubeContent, "utf-8");
		} finally {
			try {
				lutSub();
			} catch {}
			try {
				mediaDecoderCache.destroy();
				clearAllVideoCache();
			} catch {}
			try {
				shaderStore.clear(renderId);
			} catch {}

			try {
				surface?.destroy();
			} catch {}
			try {
				textureCache.destroy();
			} catch {}
			renderSemaphore.release();
			rendererLogger.debug(
				{ renderId, ...renderSemaphore.stats },
				"[HeadlessWebGPURenderer] LUT render slot released",
			);
		}
	}

	private async resolveMediaDuration(
		virtualMedia: VirtualMediaData,
		fps: number,
	): Promise<number> {
		let maxDurationMs = 0;
		const queue: VirtualMediaData[] = [virtualMedia];
		const sources = new Set<string>();

		while (queue.length > 0) {
			const current = queue.shift()!;
			if (
				current.metadata?.durationMs &&
				current.metadata.durationMs > maxDurationMs
			) {
				maxDurationMs = current.metadata.durationMs;
			}
			const op = current.operation as any;
			if (op) {
				if (typeof op.source === "string") sources.add(op.source);
				if (typeof op.url === "string") sources.add(op.url);
				if (typeof op.inputHandleId === "string") sources.add(op.inputHandleId);
				if (Array.isArray(op.layout)) {
					for (const node of op.layout) {
						if (node.inputHandleId) sources.add(node.inputHandleId);
						if (node.src) sources.add(node.src);
						if (typeof node.durationFrames === "number") {
							const start =
								typeof node.startFrame === "number" ? node.startFrame : 0;
							const durMs = ((start + node.durationFrames) / fps) * 1000;
							if (durMs > maxDurationMs) maxDurationMs = durMs;
						}
					}
				}
			}
			if (current.children) {
				queue.push(...current.children);
			}
		}

		for (const src of sources) {
			try {
				const input = await inputStore.acquire(src);
				const sec = await input.computeDuration();
				if (Number.isFinite(sec) && sec > 0) {
					const ms = Math.round(sec * 1000);
					if (ms > maxDurationMs) maxDurationMs = ms;
				}
			} catch (_) {}
		}

		return maxDurationMs > 0 ? maxDurationMs : 1000;
	}

	public async renderVideo(
		virtualMedia: VirtualMediaData,
		options?: {
			codec?: string;
			audioCodec?: string;
			quality?: string;
			concurrency?: number;
			/**
			 * Measure the output while it renders (black and frozen frames,
			 * dropped frames, loudness, clipping, silence, document warnings)
			 * and return the findings as `qa`. `true` uses default thresholds.
			 */
			qa?: boolean | VideoQaOptions;
		},
	): Promise<{
		filePath: string;
		cleanup: () => Promise<void>;
		qa?: VideoQaReport;
	}> {
		await HeadlessWebGPURenderer.initialize();

		const codecOption = options?.codec ?? "h264";
		const isMp3 = codecOption === "mp3";
		const isWebM =
			codecOption === "vp8" || codecOption === "vp9" || codecOption === "opus";
		const mediaType = getMediaType(virtualMedia);
		const isLut =
			mediaType === "LUT" ||
			(virtualMedia as any).operation?.dataType === "LUT";
		const isAudioOnly =
			isMp3 ||
			codecOption === "aac" ||
			codecOption === "opus" ||
			mediaType === "Audio";

		const fps =
			virtualMedia.metadata.fps ?? (isAudioOnly || isLut ? 24 : undefined);
		if (!fps) {
			const dataType = mediaType ?? (virtualMedia as any).dataType ?? "Unknown";
			const op =
				(virtualMedia as any).operation?.op ??
				(virtualMedia as any).op ??
				"Unknown";
			throw new Error(
				`FPS is missing from virtualMedia metadata (dataType: "${dataType}", operation: "${op}")`,
			);
		}

		const width = toEvenDimension(
			virtualMedia.metadata.width ?? (isAudioOnly ? 1280 : 0),
		);
		const height = toEvenDimension(
			virtualMedia.metadata.height ?? (isAudioOnly ? 720 : 0),
		);
		if (!width || !height)
			throw new Error(`Invalid dimensions: ${width}x${height}`);

		let durationMs = virtualMedia.metadata.durationMs;
		if (!durationMs || durationMs <= 0) {
			durationMs = await this.resolveMediaDuration(virtualMedia, fps);
			virtualMedia.metadata.durationMs = durationMs;
		}
		const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps));

		const renderId = `vid-${randomUUID()}`;
		const qaOptions: VideoQaOptions | undefined =
			options?.qa === true ? {} : options?.qa ? options.qa : undefined;
		const inspector = qaOptions ? new FrameInspector(qaOptions) : undefined;
		let videoQa: VideoQaStats | undefined;
		let audioQa: AudioQaStats | undefined;
		const videoCodec: "avc" | "vp9" | "vp8" =
			codecOption === "vp9" ? "vp9" : codecOption === "vp8" ? "vp8" : "avc";
		const audioCodec: "aac" | "opus" | "mp3" =
			(options?.audioCodec as any) ?? (isMp3 ? "mp3" : isWebM ? "opus" : "aac");
		const quality = resolveQuality(options?.quality);

		rendererLogger.debug(
			{
				renderId,
				totalFrames,
				fps,
				width,
				height,
				codec: codecOption,
				...renderSemaphore.stats,
			},
			"[HeadlessWebGPURenderer] Acquiring slot for video render (inline)",
		);

		await renderSemaphore.acquire();

		let lastCpuUsage = process.cpuUsage();
		let lastCpuTime = process.hrtime.bigint();
		const getCpuUsage = () => {
			const curCpuUsage = process.cpuUsage();
			const curCpuTime = process.hrtime.bigint();
			const userDiff = curCpuUsage.user - lastCpuUsage.user;
			const sysDiff = curCpuUsage.system - lastCpuUsage.system;
			const timeDiff = Number(curCpuTime - lastCpuTime) / 1000;
			lastCpuUsage = curCpuUsage;
			lastCpuTime = curCpuTime;
			if (timeDiff === 0) return "0.0%";
			const cpus = os.cpus().length || 1;
			const percent = (((userDiff + sysDiff) / timeDiff) * 100) / cpus;
			return `${percent.toFixed(1)}%`;
		};

		const getRamUsage = () => {
			const mem = process.memoryUsage();
			const freeMem = os.freemem();
			const totalMem = os.totalmem();
			const usedMem = totalMem - freeMem;
			const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
			const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
			const rssMb = Math.round(mem.rss / 1024 / 1024);
			const sysUsedMb = Math.round(usedMem / 1024 / 1024);
			const sysTotalMb = Math.round(totalMem / 1024 / 1024);
			return `Process: ${rssMb}MB RSS (${heapUsedMb}MB/${heapTotalMb}MB Heap), System: ${sysUsedMb}MB/${sysTotalMb}MB`;
		};

		const getVramUsage = () => {
			try {
				const out = execSync(
					"nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits",
					{
						encoding: "utf-8",
						stdio: ["ignore", "pipe", "ignore"],
					},
				);
				const [used, total] = out
					.trim()
					.split(",")
					.map((s) => s.trim());
				if (used && total) {
					return `${used}MB / ${total}MB`;
				}
			} catch {}
			return "N/A";
		};

		let statsInterval: NodeJS.Timeout | undefined;
		if (process.env.NODE_ENV === "production") {
			statsInterval = setInterval(() => {
				rendererLogger.info(
					{
						renderId,
						cpu: getCpuUsage(),
						ram: getRamUsage(),
						vram: getVramUsage(),
						renderQueue: renderSemaphore.stats,
					},
					"[HeadlessWebGPURenderer] Performance Stats",
				);
			}, 5000);
		}

		const tempDir = os.tmpdir();
		const extension = isMp3 ? "mp3" : isWebM ? "webm" : "mp4";
		const tempFilePath = path.join(tempDir, `render-${renderId}.${extension}`);
		const tempGifPath = path.join(tempDir, `render-${renderId}.gif`);

		const target = new FilePathTarget(tempFilePath);
		const output = new Output({
			format: isMp3
				? new Mp3OutputFormat()
				: isWebM
					? new WebMOutputFormat()
					: new Mp4OutputFormat(),
			target,
		});
		let videoSource: VideoSampleSource | undefined;
		if (!isAudioOnly) {
			videoSource = new VideoSampleSource({
				codec: videoCodec,
				bitrate: quality,
				latencyMode: "realtime",
				hardwareAcceleration: isAMD() ? "prefer-software" : "prefer-hardware",
			} as any);
			output.addVideoTrack(videoSource);
		}
		const audioSource = new AudioSampleSource({
			codec: audioCodec,
			bitrate: quality,
		});
		output.addAudioTrack(audioSource);

		let outputStarted = false;
		let outputFinalized = false;
		const device = await ensureDevice();

		// Resources for inline rendering (cleaned up in finally block)
		let surface: NodeSurfaceProvider | undefined;
		let renderer: Renderer2D | undefined;
		let pipeline: ZeroCopyWebCodecsPipeline | undefined;

		try {
			await output.start();
			outputStarted = true;
			await preloadFonts(virtualMedia, device);
			if (!isAudioOnly && videoSource) {
				surface = new NodeSurfaceProvider(device, width, height);
				renderer = getRenderer2D(device, surface.colorFormat);
				pipeline = new ZeroCopyWebCodecsPipeline(device, {
					width,
					height,
					fps,
					videoSource,
					ringCapacity: 2,
					onFrame: inspector
						? (rgba) => inspector.inspect(rgba, width, height)
						: undefined,
				});

				const ctx: RenderContextValue | null =
					surface && renderer ? { device, renderer, surface } : null;

				if (ctx && renderer) {
					// Pre-pass: trigger and await all LUT extractions
					{
						const preEncoder = device.createCommandEncoder();
						const dummyTex = renderer.getTemporaryTexture(width, height);
						const dummyView = dummyTex.createView();
						const preClear = renderer.beginFrame(
							preEncoder,
							dummyView,
							{ r: 0, g: 0, b: 0, a: 0 },
							width,
							height,
							"clear",
						);
						preClear.end();
						await drawCompositionTree(
							ctx,
							preEncoder,
							dummyView,
							dummyTex,
							width,
							height,
							virtualMedia,
							{
								frame: 0,
								fps,
								isHeadless: true,
								renderId,
								virtualMedia,
								containerWidth: width,
								containerHeight: height,
								isVideoMode: virtualMedia.operation?.dataType === "Video",
							},
						);
						device.queue.submit([preEncoder.finish()]);
						await lutStore.awaitAllPending(device);
					}
				}

				// Render and encode frames using pipelined double-buffered DMA staging ring
				for (let i = 0; i < totalFrames; i++) {
					if (i % 10 === 0) {
						rendererLogger.info(
							{ renderId, frame: i, totalFrames },
							`[HeadlessWebGPURenderer] Rendering frame ${i}/${totalFrames}`,
						);
					}

					if (ctx && surface && renderer && pipeline) {
						compositionStateStore.setState(renderId, i, fps, true);
						updateClockSignals(i, fps, durationMs);

						const encoder = device.createCommandEncoder();
						const targetView = surface.getCurrentTextureView();
						const targetTexture = surface.getCurrentTexture();

						const clearPass = renderer.beginFrame(
							encoder,
							targetView,
							{ r: 0, g: 0, b: 0, a: 0 },
							width,
							height,
							"clear",
						);
						clearPass.end();

						await drawCompositionTree(
							ctx,
							encoder,
							targetView,
							targetTexture,
							width,
							height,
							virtualMedia,
							{
								frame: i,
								fps,
								isHeadless: true,
								renderId,
								virtualMedia,
								containerWidth: width,
								containerHeight: height,
								isVideoMode: virtualMedia.operation?.dataType === "Video",
							},
						);

						await pipeline.enqueueFrame(i, targetTexture, encoder);
					} else {
						throw new Error("Invalid render context state");
					}
				}

				if (pipeline) {
					await pipeline.drain();
					const pipelineStats = pipeline.getStats();
					if (inspector && qaOptions) {
						videoQa = inspector.stats(
							totalFrames,
							pipelineStats.totalFramesEncoded,
							fps,
							width,
							height,
							qaOptions,
						);
					}
					rendererLogger.debug(
						{ renderId, totalFrames, ...pipelineStats },
						`[HeadlessWebGPURenderer] All frames rendered and encoded (avg cycle: ${pipelineStats.averageCycleTimeMs.toFixed(2)}ms, throughput: ${pipelineStats.throughputFps.toFixed(1)} fps)`,
					);
				}
			}

			// ── Audio ──────────────────────────────────────────────────────────────
			const { channels, sampleRate } = await mixAudioTracks(
				virtualMedia,
				fps,
				48_000,
				device,
				renderId,
			);

			const numChannels = channels.length;
			if (numChannels === 0)
				throw new Error("mixAudioTracks returned no channels");

			if (qaOptions) audioQa = analyzeAudio(channels, sampleRate, qaOptions);

			const totalSamples = channels[0].length;
			const chunkSize = Math.round(0.1 * sampleRate);

			for (let offset = 0; offset < totalSamples; offset += chunkSize) {
				const currentChunk = Math.min(chunkSize, totalSamples - offset);
				// A fresh buffer per chunk: the encoder may read a sample's data after
				// add() resolves, so a buffer reused across chunks gets overwritten by
				// the next chunk before it is encoded (audible as 100 ms garbling).
				const interleaved = new Float32Array(currentChunk * numChannels);

				for (let i = 0; i < currentChunk; i++) {
					for (let ch = 0; ch < numChannels; ch++) {
						interleaved[i * numChannels + ch] = channels[ch]?.[offset + i] ?? 0;
					}
				}

				const sample = new AudioSample({
					data: interleaved,
					format: "f32",
					numberOfChannels: numChannels,
					sampleRate,
					timestamp: offset / sampleRate,
				});
				try {
					await audioSource.add(sample);
				} finally {
					sample.close();
				}
			}

			await output.finalize();
			outputFinalized = true;

			const qa = qaOptions
				? buildQaReport({
						video: videoQa,
						audio: audioQa,
						diagnostics: takeRenderDiagnostics(renderId),
						options: qaOptions,
					})
				: undefined;

			const cleanup = async () => {
				try {
					await fs.unlink(tempFilePath).catch(() => {});
					if (codecOption === "gif") {
						await fs.unlink(tempGifPath).catch(() => {});
					}
				} catch {}
			};

			if (codecOption === "gif") {
				rendererLogger.debug(
					"[HeadlessWebGPURenderer] Converting rendered MP4 to high-quality GIF...",
				);
				await convertMp4ToGif(tempFilePath, tempGifPath);
				return { filePath: tempGifPath, cleanup, ...(qa && { qa }) };
			}

			return { filePath: tempFilePath, cleanup, ...(qa && { qa }) };
		} catch (error) {
			if (outputStarted && !outputFinalized) {
				try {
					await output.finalize();
				} catch {}
			}
			try {
				await fs.unlink(tempFilePath).catch(() => {});
				if (codecOption === "gif") {
					await fs.unlink(tempGifPath).catch(() => {});
				}
			} catch {}
			throw error;
		} finally {
			if (statsInterval) {
				clearInterval(statsInterval);
			}
			try {
				renderer?.destroy();
			} catch {}
			try {
				pipeline?.destroy();
			} catch {}
			try {
				surface?.destroy();
			} catch {}
			try {
				mediaDecoderCache.destroy();
			} catch {}
			try {
				clearAllVideoCache();
			} catch {}
			try {
				textureCache.destroy();
			} catch {}

			try {
				WebGPUAudioProcessor.clearCache(renderId);
			} catch {}
			try {
				shaderStore.clear(renderId);
			} catch {}
			// Drop anything reported for this render that QA did not collect.
			takeRenderDiagnostics(renderId);
			renderSemaphore.release();
			rendererLogger.debug(
				{ renderId, ...renderSemaphore.stats },
				"[HeadlessWebGPURenderer] Video render slot released",
			);
		}
	}
}

export const HeadlessMediaRenderer = HeadlessWebGPURenderer;
export type HeadlessMediaRenderer = HeadlessWebGPURenderer;
