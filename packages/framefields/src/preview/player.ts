/// <reference lib="dom" />
/// <reference types="webgpu" />
/**
 * The browser side of the preview: runs the project's composition code and
 * renders its frames with WebGPU straight onto the page's canvas. Part of the
 * browser engine (bundle.ts); the project's bundle calls `startPlayer`.
 */

import { BUILTIN_NODE_RENDERERS } from "framefields-preview:renderers";
import {
	compositionStateStore,
	drawCompositionTree,
} from "@framefields/compositions";
import { updateClockSignals, type VirtualMediaData } from "@framefields/core";
import {
	audioRegistry,
	type NodeRendererPlugin,
	registerWebGPURenderer,
} from "@framefields/node-sdk";
import { preloadCompositionFonts } from "@framefields/renderers";
import {
	type OrtWebModule,
	setDefaultSessionProvider,
	WebGPUProvider,
} from "@framefields/vision/web";
import {
	acquireDevice,
	BrowserSurfaceProvider,
	getRenderer2D,
	lutStore,
	type RenderContextValue,
	SlugFontCache,
} from "@framefields/webgpu-renderers";
import { Blitter } from "./blit.js";

export interface BuiltinRenderer {
	ops: readonly string[];
	load: () => Promise<{ default?: NodeRendererPlugin }>;
}

export interface PlayerMeta {
	width: number;
	height: number;
	fps: number;
	frameCount: number;
	durationMs: number;
}

export interface PreviewPlayer {
	meta: PlayerMeta;
	canvas: HTMLCanvasElement;
	/**
	 * Draws a frame. Calls made while one is drawing collapse to the latest.
	 * `cache: false` leaves the drawn frame out of the step/scrub cache: for
	 * real-time playback, which draws every frame once and would otherwise pay
	 * a texture and a copy per frame.
	 */
	render(frame: number, options?: { cache?: boolean }): Promise<number>;
	/** Milliseconds the last frame took to draw. */
	lastRenderMs: number;
	/** True when the program runs vision models (worth analysing ahead). */
	hasVision: boolean;
	/**
	 * Draws a frame off-screen so per-frame work (vision analysis) is cached
	 * before it plays. Skipped (resolves false) while a frame is being drawn.
	 */
	warm(frame: number): Promise<boolean>;
	/** A frame at full size as an image, e.g. to attach to a note. */
	snapshot(frame: number): Promise<ImageBitmap>;
}

type Renderable = {
	toVirtualMediaAsync?: () => Promise<VirtualMediaData>;
	toVirtualMedia?: () => VirtualMediaData;
	fps?: number;
};

declare global {
	interface Window {
		framefieldsPlayer?: Promise<PreviewPlayer>;
	}
}

export interface PlayerSettings {
	/** Where cached vision models are (served by the preview server). */
	modelsDir: string;
	/** URL of an onnxruntime-web `dist/` folder, for vision nodes. */
	ortBase: string;
}

export function startPlayer(
	mod: Record<string, unknown>,
	exportName: string,
	settings: PlayerSettings,
): void {
	process.env.FRAMEFIELDS_MODELS_DIR = settings.modelsDir;
	// Vision nodes create their runners themselves; here they run on WebGPU,
	// with onnxruntime-web loaded on first use.
	setDefaultSessionProvider(
		() =>
			new WebGPUProvider({
				loader: async () => {
					const ort = await import(
						/* @vite-ignore */ `${settings.ortBase}ort.webgpu.bundle.min.mjs`
					);
					ort.env.wasm.wasmPaths = settings.ortBase;
					ort.env.logLevel = "error";
					// Threads need the wasm on this origin; a CDN build runs on one.
					if (!settings.ortBase.startsWith("/")) ort.env.wasm.numThreads = 1;
					return ort as OrtWebModule;
				},
			}),
	);
	window.framefieldsPlayer = createPlayer(
		mod,
		exportName,
		BUILTIN_NODE_RENDERERS,
	);
	// The page listens for this; a failure is shown there.
	window.dispatchEvent(new Event("framefields:player"));
}

async function createPlayer(
	mod: Record<string, unknown>,
	exportName: string,
	renderers: readonly BuiltinRenderer[],
): Promise<PreviewPlayer> {
	if (!("gpu" in navigator)) {
		throw new Error(
			"This browser has no WebGPU. Use a current Chrome, Edge or Safari.",
		);
	}
	await registerRenderers(renderers);

	const exported = mod[exportName];
	if (exported === undefined) {
		throw new Error(`The preview entry has no export named "${exportName}".`);
	}
	const target = (
		typeof exported === "function"
			? await (exported as () => unknown)()
			: exported
	) as Renderable;
	const vm = target.toVirtualMediaAsync
		? await target.toVirtualMediaAsync()
		: target.toVirtualMedia?.();
	if (!vm) throw new Error(`"${exportName}" is not a composition.`);

	const width = Math.round(vm.metadata?.width ?? 1920);
	const height = Math.round(vm.metadata?.height ?? 1080);
	const fps = target.fps ?? (vm.operation as { fps?: number })?.fps ?? 30;
	const durationMs = vm.metadata?.durationMs ?? 0;
	const meta: PlayerMeta = {
		width,
		height,
		fps,
		durationMs,
		frameCount: Math.max(1, Math.round((durationMs / 1000) * fps)),
	};
	const hasVision = containsOp(vm as VirtualMediaData, "Vision");
	// As the export decides it, so text entrances play the same.
	const isVideoMode = vm.operation?.dataType === "Video";

	const device = await acquireDevice();
	const canvas =
		(document.getElementById("canvas") as HTMLCanvasElement | null) ??
		document.createElement("canvas");
	canvas.width = width % 2 ? width + 1 : width;
	canvas.height = height % 2 ? height + 1 : height;
	const surface = new BrowserSurfaceProvider(device, canvas);
	await preloadCompositionFonts(vm, device);

	const renderId = `preview-${Math.random().toString(36).slice(2)}`;
	let first = true;
	let drawing: Promise<void> | null = null;
	let wanted: number | null = null;
	let wantedCached = true;
	let waiters: Array<(f: number) => void> = [];

	let offscreen: GPUTexture | undefined;

	// Frames drawn on screen are kept so stepping or scrubbing back to one is a
	// blit, not a re-render. Full resolution, bounded by a byte budget. Vision
	// compositions are excluded: their frames depend on the one before, so a
	// hit would skip that work.
	const renderCache = new Map<number, { tex: GPUTexture; used: number }>();
	const renderCacheMax = Math.max(
		1,
		Math.min(
			240,
			Math.floor(
				(128 * 1024 * 1024) / Math.max(1, canvas.width * canvas.height * 4),
			),
		),
	);
	let renderCacheClock = 0;

	function newRenderCacheTexture(): GPUTexture {
		return device.createTexture({
			size: [canvas.width, canvas.height],
			format: surface.colorFormat,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST,
			label: "preview_frame_cache",
		});
	}

	function takeRenderCache(frame: number): GPUTexture | undefined {
		if (hasVision) return undefined;
		const hit = renderCache.get(frame);
		if (!hit) return undefined;
		hit.used = ++renderCacheClock;
		return hit.tex;
	}

	function storeRenderCache(frame: number, tex: GPUTexture): void {
		if (hasVision) {
			tex.destroy();
			return;
		}
		const existing = renderCache.get(frame);
		if (existing) {
			if (existing.tex !== tex) existing.tex.destroy();
			renderCache.delete(frame);
		}
		renderCache.set(frame, { tex, used: ++renderCacheClock });
		while (renderCache.size > renderCacheMax) {
			let oldestKey: number | undefined;
			let oldestUsed = Number.POSITIVE_INFINITY;
			for (const [key, entry] of renderCache) {
				if (entry.used < oldestUsed) {
					oldestUsed = entry.used;
					oldestKey = key;
				}
			}
			if (oldestKey === undefined) break;
			const evicted = renderCache.get(oldestKey);
			renderCache.delete(oldestKey);
			evicted?.tex.destroy();
		}
	}

	async function draw(
		frame: number,
		toScreen = true,
		cache = toScreen,
	): Promise<void> {
		const renderer = getRenderer2D(device, surface.colorFormat);
		const ctx: RenderContextValue = { device, renderer, surface };
		const w = surface.width;
		const h = surface.height;
		const props = {
			frame,
			compositionFrame: frame,
			fps,
			isHeadless: false,
			renderId,
			virtualMedia: vm as VirtualMediaData,
			containerWidth: w,
			containerHeight: h,
			isVideoMode,
			// A drawn frame can be cached, so it waits for its LUTs
			// and exact video frame as the export does, never a stand-in.
			forceWait: true,
		};
		updateClockSignals(frame, fps, durationMs || undefined);

		// Shader, LUT and glyph uploads finish on a pass whose output is dropped.
		if (first || lutStore.hasPending(device) || SlugFontCache.hasPending()) {
			first = false;
			const pre = device.createCommandEncoder();
			const tex = renderer.getTemporaryTexture(w, h);
			const view = tex.createView();
			renderer
				.beginFrame(pre, view, { r: 0, g: 0, b: 0, a: 0 }, w, h, "clear")
				.end();
			await drawCompositionTree(
				ctx,
				pre,
				view,
				tex,
				w,
				h,
				vm as VirtualMediaData,
				props,
			);
			device.queue.submit([pre.finish()]);
			await lutStore.awaitAllPending(device);
		}

		compositionStateStore.setState(renderId, frame, fps, true);
		const encoder = device.createCommandEncoder();
		if (!toScreen && !offscreen) {
			offscreen = device.createTexture({
				size: [w, h],
				format: surface.colorFormat,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC,
				label: "preview_warm_target",
			});
		}
		const tex =
			toScreen || !offscreen ? surface.getCurrentTexture() : offscreen;
		const view = tex.createView();
		renderer
			.beginFrame(encoder, view, { r: 0, g: 0, b: 0, a: 0 }, w, h, "clear")
			.end();
		await drawCompositionTree(
			ctx,
			encoder,
			view,
			tex,
			w,
			h,
			vm as VirtualMediaData,
			props,
		);
		let cacheTex: GPUTexture | undefined;
		if (cache) {
			cacheTex = newRenderCacheTexture();
			encoder.copyTextureToTexture({ texture: tex }, { texture: cacheTex }, [
				w,
				h,
			]);
		}
		device.queue.submit([encoder.finish()]);
		if (toScreen) surface.present();
		await device.queue.onSubmittedWorkDone();
		if (cacheTex) storeRenderCache(frame, cacheTex);
	}

	// One frame at a time. Requests made while a frame draws collapse to the
	// latest; warm-ups only run when nothing else is drawing.
	function pump(): void {
		if (drawing || wanted === null) return;
		// `drawing` is set before the loop runs: a frame from the cache is drawn
		// without awaiting, so the loop can finish (and clear it) synchronously.
		let finished!: () => void;
		drawing = new Promise<void>((resolve) => {
			finished = resolve;
		});
		void (async () => {
			while (wanted !== null) {
				const f = wanted;
				const cache = wantedCached;
				wanted = null;
				const started = performance.now();
				try {
					const cached = takeRenderCache(f);
					if (cached) {
						blitter.blit(cached, surface.getCurrentTexture());
						surface.present();
					} else {
						await draw(f, true, cache);
					}
				} catch (err) {
					console.error("[framefields] frame", f, err);
				}
				player.lastRenderMs = performance.now() - started;
				if (wanted === null) {
					const ready = waiters;
					waiters = [];
					for (const resolve of ready) resolve(f);
				}
			}
			drawing = null;
			finished();
		})();
	}

	const blitter = new Blitter(device, surface.colorFormat);

	const player: PreviewPlayer = {
		meta,
		canvas,
		lastRenderMs: 0,
		hasVision,
		render(frame, options) {
			wanted = frame;
			wantedCached = options?.cache ?? true;
			const done = new Promise<number>((resolve) => waiters.push(resolve));
			pump();
			return done;
		},
		async warm(frame) {
			if (drawing || wanted !== null) return false;
			drawing = draw(frame, false).catch((err: unknown) =>
				console.warn("[framefields] warm-up of frame", frame, err),
			);
			await drawing;
			drawing = null;
			pump();
			return true;
		},
		async snapshot(frame) {
			while (drawing) await drawing;
			const done = (async () => {
				await draw(frame, false);
				if (!offscreen) throw new Error("no frame to capture");
				return readTexture(device, offscreen);
			})();
			drawing = done.then(
				() => {},
				() => {},
			);
			try {
				return await done;
			} finally {
				drawing = null;
				pump();
			}
		},
	};
	return player;
}

/** Reads a texture back as an image (RGBA or BGRA, as the canvas format is). */
async function readTexture(
	device: GPUDevice,
	texture: GPUTexture,
): Promise<ImageBitmap> {
	const { width, height } = texture;
	const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
	const buffer = device.createBuffer({
		size: bytesPerRow * height,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	const encoder = device.createCommandEncoder();
	encoder.copyTextureToBuffer(
		{ texture },
		{ buffer, bytesPerRow },
		{ width, height },
	);
	device.queue.submit([encoder.finish()]);
	await buffer.mapAsync(GPUMapMode.READ);
	const src = new Uint8Array(buffer.getMappedRange());
	const pixels = new Uint8ClampedArray(width * height * 4);
	const bgra = texture.format.startsWith("bgra");
	for (let y = 0; y < height; y++) {
		const row = src.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
		pixels.set(row, y * width * 4);
	}
	buffer.unmap();
	buffer.destroy();
	for (let i = 0; i < pixels.length; i += 4) {
		if (bgra) {
			const b = pixels[i];
			pixels[i] = pixels[i + 2];
			pixels[i + 2] = b;
		}
		pixels[i + 3] = 255;
	}
	return createImageBitmap(new ImageData(pixels, width, height));
}

function containsOp(node: VirtualMediaData, op: string): boolean {
	if ((node.operation as { op?: string } | undefined)?.op === op) return true;
	return (node.children ?? []).some((child) => containsOp(child, op));
}

async function registerRenderers(renderers: readonly BuiltinRenderer[]) {
	await Promise.all(
		renderers.map(async ({ ops, load }) => {
			try {
				const plugin = (await load()).default;
				for (const op of ops) {
					if (plugin?.WebGPURenderer)
						registerWebGPURenderer(op, plugin.WebGPURenderer);
					if (plugin?.audioProcessor)
						audioRegistry.register(op, plugin.audioProcessor);
				}
			} catch (err) {
				console.warn(
					"[framefields] renderer for",
					ops[0],
					"failed to load",
					err,
				);
			}
		}),
	);
}
