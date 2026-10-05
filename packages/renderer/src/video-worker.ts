import { parentPort } from "node:worker_threads";
import {
	compositionStateStore,
	drawCompositionTree,
} from "@framefields/compositions";
import type { VirtualMediaData } from "@framefields/core";
import { rendererLogger } from "@framefields/server-utils";
import {
	clearAllVideoCache,
	ensureDevice,
	initHeadlessWebGPU,
	lutStore,
	mediaDecoderCache,
	NodeSurfaceProvider,
	type RenderContextValue,
	Renderer2D,
	resetDeviceInstance,
	shaderStore,
	textureCache,
} from "@framefields/webgpu-renderers";
import sharp from "sharp";
import { Canvas as SkiaCanvas, Image as SkiaImage } from "skia-canvas";
import { preloadFonts } from "./asset-preloader.js";
import { DmaStagingRing } from "./dma-staging-ring.js";
import { discoverAndRegisterNodeRenderers } from "./dynamic-node-discovery.js";

const globalObj = globalThis as unknown as Record<string, unknown>;

if (typeof globalThis !== "undefined") {
	globalObj.__IS_HEADLESS_RENDERER__ = true;
	globalObj.__GATEWAI_DELAYS__ ??= new Set<number>();
}

import { bootstrapMediabunny } from "./bootstrap-mediabunny.js";

bootstrapMediabunny();

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
	globalObj.OffscreenCanvas = SkiaCanvas;
}

if (typeof globalThis.HTMLCanvasElement === "undefined") {
	globalObj.HTMLCanvasElement = SkiaCanvas;
}

if (typeof globalThis.Image === "undefined") {
	globalObj.Image = SkiaImage;
}

if (typeof globalThis.window === "undefined") {
	globalObj.window = globalThis;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
	globalObj.IntersectionObserver = class IntersectionObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

if (typeof globalThis.document === "undefined") {
	globalObj.document = {
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

let isInitialized = false;
let initPromise: Promise<void> | null = null;

function initializeWorker(): Promise<void> {
	if (isInitialized) return Promise.resolve();
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			rendererLogger.debug(
				"[video-worker] Initializing headless WebGPU in worker thread…",
			);
			await initHeadlessWebGPU();
			await ensureDevice();
			rendererLogger.debug(
				"[video-worker] Scanning node renderers in worker thread…",
			);
			await discoverAndRegisterNodeRenderers();
			isInitialized = true;
			initPromise = null;
			rendererLogger.debug(
				"[video-worker] Worker thread initialization complete.",
			);
		} catch (error) {
			initPromise = null;
			throw error;
		}
	})();

	return initPromise;
}

if (parentPort) {
	if (process.env.GATEWAI_UNIT_TEST === "true") {
		globalThis.fetch = async () => {
			throw new Error("Network requests are disabled in unit tests");
		};
	}

	parentPort.on("message", (task: any) => {
		if (!task || task.type !== "start") return;

		void (async () => {
			try {
				const {
					virtualMedia,
					width,
					height,
					fps,
					startFrame,
					endFrame,
					renderId,
					outputFormat,
					workerIndex,
				} = task.input;

				rendererLogger.debug(
					{ renderId, workerIndex },
					`[video-worker] Worker ${workerIndex} initializing renderer`,
				);
				await initializeWorker();
				const device = await ensureDevice();
				await preloadFonts(virtualMedia, device);
				const surface = new NodeSurfaceProvider(device, width, height);
				const stagingRing = new DmaStagingRing(device, {
					width,
					height,
					capacity: 2,
				});
				const renderer = new Renderer2D(device, surface.colorFormat);
				const ctx: RenderContextValue = { device, renderer, surface };
				rendererLogger.debug(
					{ renderId, workerIndex },
					`[video-worker] Worker ${workerIndex} setup complete, starting render loop`,
				);

				let lutSub: (() => void) | undefined;
				let onTaskMessage: ((msg: any) => void) | undefined;
				const ackPromises = new Map<number, () => void>();
				let lastAckedFrame = startFrame - 1;

				try {
					onTaskMessage = (msg: any) => {
						if (msg && msg.type === "ack") {
							const acked = msg.frameIndex as number;
							if (acked > lastAckedFrame) {
								lastAckedFrame = acked;
							}
							const resolve = ackPromises.get(acked);
							if (resolve) {
								resolve();
								ackPromises.delete(acked);
							}
						}
					};
					parentPort!.on("message", onTaskMessage);

					lutSub = lutStore.onChange((key) => {
						const raw = lutStore.getRawData(key);
						if (raw) {
							parentPort!.postMessage({
								type: "lut",
								renderId,
								raw,
							} satisfies WorkerMessage);
						}
					});

					// Pre-pass: run drawCompositionTree once on the startFrame to trigger and await all LUT extractions/loads
					{
						rendererLogger.debug(
							{ renderId, workerIndex },
							`[video-worker] Pre-pass rendering startFrame ${startFrame} to trigger/await all LUTs`,
						);
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
								frame: startFrame,
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

					// Compute backpressure limit based on frame size to prevent
					// native heap corruption from excessive pending pixel buffers.
					// Target: ~120 MB max pending per worker.
					const frameSizeBytes = width * height * 4;
					const maxPendingBytes = 120 * 1024 * 1024;
					const maxUnacked = Math.max(
						2,
						Math.min(5, Math.floor(maxPendingBytes / frameSizeBytes)),
					);

					const inFlightWorkerFrames: number[] = [];
					const consumeWorkerFrame = async (frameIdx: number) => {
						const pixelsArr = await stagingRing.readAndReleaseFrame(frameIdx);
						if (outputFormat === "png") {
							const pngBuffer = await sharp(Buffer.from(pixelsArr), {
								raw: { width, height, channels: 4 },
							})
								.png()
								.toBuffer();
							parentPort!.postMessage({
								type: "png",
								renderId,
								data: new Uint8Array(pngBuffer),
							} satisfies WorkerMessage);
						} else {
							parentPort!.postMessage(
								{
									type: "frame",
									renderId,
									frameIndex: frameIdx,
									pixels: pixelsArr,
								} satisfies WorkerMessage,
								[pixelsArr.buffer as ArrayBuffer],
							);
						}
					};

					for (let i = startFrame; i <= endFrame; i++) {
						// Implement backpressure: do not render too far ahead of encoding
						while (i - lastAckedFrame > maxUnacked) {
							await new Promise<void>((resolve) => {
								ackPromises.set(i - maxUnacked, resolve);
							});
						}

						if (inFlightWorkerFrames.length >= stagingRing.capacity) {
							const prevFrame = inFlightWorkerFrames.shift();
							if (prevFrame !== undefined) {
								await consumeWorkerFrame(prevFrame);
							}
						}

						if (i % 10 === 0) {
							rendererLogger.info(
								{ renderId, workerIndex, frame: i },
								`[video-worker] Rendering frame ${i} (Worker ${workerIndex})`,
							);
						}
						compositionStateStore.setState(renderId, i, fps, true);

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

						await stagingRing.prepareSlot(i);
						stagingRing.stageTexture(encoder, targetTexture, i);
						device.queue.submit([encoder.finish()]);
						stagingRing.scheduleMap(i);
						inFlightWorkerFrames.push(i);
					}

					while (inFlightWorkerFrames.length > 0) {
						const remainingFrame = inFlightWorkerFrames.shift();
						if (remainingFrame !== undefined) {
							await consumeWorkerFrame(remainingFrame);
						}
					}

					if (outputFormat !== "png") {
						parentPort!.postMessage({
							type: "done",
							renderId,
						} satisfies WorkerMessage);
					}
				} finally {
					if (onTaskMessage) {
						try {
							parentPort!.off("message", onTaskMessage);
						} catch {}
					}
					if (lutSub) {
						try {
							lutSub();
						} catch {}
					}
					try {
						mediaDecoderCache.destroy();
						clearAllVideoCache();
					} catch {}
					try {
						shaderStore.clear(renderId);
					} catch {}
					try {
						device.destroy();
					} catch (e) {}
					try {
						resetDeviceInstance();
					} catch (e) {}
					try {
						renderer.destroy();
					} catch (e) {}
					try {
						surface.destroy();
					} catch (e) {}
					try {
						stagingRing.destroy();
					} catch (e) {}
					try {
						textureCache.destroy();
					} catch (e) {}
				}
			} catch (error) {
				parentPort!.postMessage({
					type: "error",
					renderId: task?.input?.renderId,
					error:
						error instanceof Error
							? (error.stack ?? error.message)
							: String(error),
				} satisfies WorkerMessage);
			}
		})();
	});
}
