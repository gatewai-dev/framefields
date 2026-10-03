import {
	BASE_URL,
	GetFontAssetUrl,
	localFontManager,
} from "@gitframes/client-utils";
import { DotLottie, type Fit } from "@lottiefiles/dotlottie-web";
import {
	getHeadlessFontData,
	registerHeadlessFont,
} from "../headless-font-loader.js";

function resolveUrl(url: string): string {
	if (!url) return url;
	if (url.startsWith("/")) {
		const base = BASE_URL || "http://localhost:8081";
		return `${base}${url}`;
	}
	return url;
}

import type { RenderContextValue } from "../render-context.js";
import { textureCache } from "../texture-cache.js";
import type { LottieNodeProps } from "./types.js";

const registeredLottieFonts = new Set<string>();

function decodeBase64(base64: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(base64, "base64").toString("utf-8");
	}
	return atob(base64);
}

function extractFontFamiliesFromLottie(lottieJson: any): string[] {
	const fonts = new Set<string>();

	// 1. Extract from fonts.list (both fName and fFamily)
	const fontsList = lottieJson?.fonts?.list;
	if (Array.isArray(fontsList)) {
		for (const entry of fontsList) {
			if (entry?.fName && typeof entry.fName === "string") {
				fonts.add(entry.fName);
			}
			if (entry?.fFamily && typeof entry.fFamily === "string") {
				fonts.add(entry.fFamily);
			}
		}
	}

	// 2. Extract from layers
	const layers = lottieJson?.layers;
	if (!Array.isArray(layers)) return [...fonts];

	for (const layer of layers) {
		if (layer?.ty !== 5) continue; // ty: 5 is Text Layer

		const k = layer?.t?.d?.k ?? layer?.t?.k;
		if (!k) continue;

		const kArr = Array.isArray(k) ? k : [k];
		for (const kf of kArr) {
			// Handle keyframe wrappers (s, e) AND direct document objects (kf)
			const possibleDocs = [kf?.s, kf?.e, kf].filter(Boolean);

			for (const doc of possibleDocs) {
				// Handle both single document objects and arrays of documents
				const docArr = Array.isArray(doc) ? doc : [doc];
				for (const d of docArr) {
					if (d?.f && typeof d.f === "string") {
						fonts.add(d.f);
					}
				}
			}
		}
	}

	return [...fonts];
}

function getBaseFontFamily(name: string): string {
	// Remove common styles/weights suffixes from font names (e.g., "Oi-Regular" -> "Oi")
	return name
		.replace(
			/[- ](Regular|Bold|Italic|Medium|Light|SemiBold|Semi-Bold|ExtraBold|Extra-Bold|Thin|Black|Book|Heavy|Alt|Alternate|RegularItalic|BoldItalic)$/i,
			"",
		)
		.trim();
}

/**
 * Make a font usable for DotLottie text layers.
 *
 * 1. Registers the font with the DOM via the shared font manager
 *    (@font-face + document.fonts) — keeps canvas-2D fallbacks and
 *    measurement working in the browser.
 * 2. Registers the font with the dotlottie WASM (thorvg) engine via
 *    `DotLottie.registerFont` — this is what actually renders the text
 *    inside the animation. It awaits WASM initialisation internally and
 *    accepts a URL, an ArrayBuffer, or a Uint8Array.
 */
async function registerLottieFont(family: string): Promise<void> {
	if (registeredLottieFonts.has(family)) return;

	const baseFamily = getBaseFontFamily(family);
	let fontUrl = GetFontAssetUrl(baseFamily);

	console.log(
		`[LottieRenderer] Registering font: "${family}" (base: "${baseFamily}") from URL: ${fontUrl}`,
	);

	const isBrowser =
		typeof window !== "undefined" &&
		typeof document !== "undefined" &&
		typeof document.createElement === "function" &&
		typeof document.getElementById === "function";

	if (isBrowser) {
		try {
			await localFontManager.loadFont(family, fontUrl);
		} catch (err) {
			// Fallback to original family name
			fontUrl = GetFontAssetUrl(family);
			try {
				await localFontManager.loadFont(family, fontUrl);
			} catch (_) {}
		}

		try {
			const ok = await DotLottie.registerFont(family, fontUrl);
			if (!ok) {
				console.warn(
					`[LottieRenderer] DotLottie.registerFont returned false for "${family}" (${fontUrl})`,
				);
				return;
			}
		} catch (err) {
			console.warn(
				`[LottieRenderer] DotLottie.registerFont failed for "${family}" (${fontUrl}):`,
				err,
			);
			return;
		}
		registeredLottieFonts.add(family);
		return;
	}

	// ── Headless / Node.js path ──────────────────────────────────────────
	// Step 1: Download font to local disk (try base family name, then original)
	let fontPath = await registerHeadlessFont(family, fontUrl);
	if (!fontPath) {
		fontUrl = GetFontAssetUrl(family);
		fontPath = await registerHeadlessFont(family, fontUrl);
	}

	// Step 2: Register font binary with the DotLottie WASM engine (thorvg)
	let registered = false;

	if (fontPath) {
		const fontData = await getHeadlessFontData(family);
		if (fontData) {
			try {
				registered = await DotLottie.registerFont(family, fontData);
				if (!registered) {
					console.warn(
						`[LottieRenderer] DotLottie.registerFont returned false for "${family}" (${fontData.length} bytes)`,
					);
				}
			} catch (err) {
				console.warn(
					`[LottieRenderer] DotLottie.registerFont failed for "${family}" with binary data:`,
					err,
				);
			}
		}
	}

	// Step 3: Fallback — let DotLottie fetch the font via URL
	if (!registered) {
		try {
			const resolvedFontUrl = resolveUrl(fontUrl);
			registered = await DotLottie.registerFont(family, resolvedFontUrl);
			if (!registered) {
				console.warn(
					`[LottieRenderer] DotLottie.registerFont via URL also failed for "${family}" (${resolvedFontUrl})`,
				);
			}
		} catch (err) {
			console.warn(
				`[LottieRenderer] DotLottie.registerFont via URL threw for "${family}":`,
				err,
			);
		}
	}

	if (registered) {
		registeredLottieFonts.add(family);
	} else {
		console.warn(
			`[LottieRenderer] All font registration attempts failed for "${family}". Text using this font will not render.`,
		);
	}
}

class LottieInstance {
	private dotLottie: DotLottie;
	private canvas: OffscreenCanvas;
	private loadPromise: Promise<void>;
	private _width: number;
	private _height: number;

	constructor(src: string, width: number, height: number) {
		this._width = width;
		this._height = height;
		this.canvas = new OffscreenCanvas(width, height);
		this.dotLottie = new DotLottie({
			canvas: this.canvas,
			src: resolveUrl(src),
			autoplay: false,
			loop: false,
			speed: 0,
			layout: {
				align: [0.5, 0.5],
				fit: "contain",
			},
		});

		this.loadPromise = new Promise<void>((resolve, reject) => {
			if (this.dotLottie.isLoaded) {
				resolve();
				return;
			}
			this.dotLottie.addEventListener("load", () => {
				resolve();
			});
			this.dotLottie.addEventListener("loadError", (e) => {
				reject(
					e instanceof Error
						? e
						: new Error("Failed to load DotLottie animation"),
				);
			});
		});
	}

	get width(): number {
		return this._width;
	}

	get height(): number {
		return this._height;
	}

	get totalFrames(): number {
		return this.dotLottie.totalFrames ?? 1;
	}

	get fps(): number {
		const totalFrames = this.totalFrames;
		const duration = this.dotLottie.duration;
		if (duration > 0 && totalFrames > 0) {
			return Math.round(totalFrames / duration);
		}
		return 24;
	}

	async ready(): Promise<void> {
		await this.loadPromise;
	}

	renderFrame(
		frame: number,
		fit?: "contain" | "cover" | "fill",
	): OffscreenCanvas {
		const loopedFrame = Math.floor(frame) % Math.max(1, this.totalFrames);
		this.dotLottie.setLayout({
			align: [0.5, 0.5],
			fit: (fit || "contain") as Fit,
		});
		this.dotLottie.resize();
		this.dotLottie.setFrame(loopedFrame);
		try {
			(this.dotLottie as { render?: () => void }).render?.();
		} catch (_) {}
		return this.canvas;
	}

	destroy(): void {
		try {
			this.dotLottie.destroy();
		} catch (_) {}
	}
}

let wasmConfigured = false;

function polyfillHeadlessDOM(): void {
	const globalObj = globalThis as unknown as Record<string, unknown>;

	const dummyElement = {
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

	if (typeof globalThis.IntersectionObserver === "undefined") {
		globalObj.IntersectionObserver = class IntersectionObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}

	if (typeof globalThis.HTMLCanvasElement === "undefined") {
		if (typeof globalThis.OffscreenCanvas !== "undefined") {
			globalObj.HTMLCanvasElement = globalThis.OffscreenCanvas;
		}
	}

	const docObj = (globalThis.document ??= {
		createElement: (tag: string) => {
			if (
				tag === "canvas" &&
				typeof globalThis.OffscreenCanvas === "function"
			) {
				return new globalThis.OffscreenCanvas(1, 1);
			}
			return { ...dummyElement };
		},
		getElementsByTagName: () => [],
		documentElement: dummyElement,
		body: dummyElement,
	} as unknown as Document) as unknown as Record<string, unknown>;

	docObj.documentElement ??= dummyElement;
	docObj.body ??= dummyElement;

	const CanvasCtor = globalThis.HTMLCanvasElement || globalThis.OffscreenCanvas;
	if (CanvasCtor && typeof CanvasCtor === "function") {
		const proto = (
			CanvasCtor as unknown as { prototype: Record<string, unknown> }
		).prototype;
		if (proto) {
			if (typeof proto.getBoundingClientRect === "undefined") {
				proto.getBoundingClientRect = function (this: {
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

			if (!("style" in proto)) {
				Object.defineProperty(proto, "style", {
					get(this: { _style?: Record<string, unknown> }) {
						this._style ??= {};
						return this._style;
					},
					configurable: true,
				});
			}

			if (!("clientWidth" in proto)) {
				Object.defineProperty(proto, "clientWidth", {
					get(this: { width?: number }) {
						return this.width || 512;
					},
					configurable: true,
				});
			}

			if (!("clientHeight" in proto)) {
				Object.defineProperty(proto, "clientHeight", {
					get(this: { height?: number }) {
						return this.height || 512;
					},
					configurable: true,
				});
			}

			if (!("parentElement" in proto)) {
				Object.defineProperty(proto, "parentElement", {
					get() {
						return dummyElement;
					},
					configurable: true,
				});
			}

			if (typeof proto.addEventListener === "undefined") {
				proto.addEventListener = () => {};
			}
			if (typeof proto.removeEventListener === "undefined") {
				proto.removeEventListener = () => {};
			}
			if (typeof proto.getAttribute === "undefined") {
				proto.getAttribute = () => null;
			}
		}
	}
}

async function ensureWasmConfigured(): Promise<void> {
	if (wasmConfigured) return;
	const isBrowser =
		typeof window !== "undefined" &&
		typeof document !== "undefined" &&
		typeof document.createElement === "function" &&
		typeof document.getElementById === "function";

	if (!isBrowser) {
		polyfillHeadlessDOM();
		// Add Response instanceof patch to handle cross-realm ESM loader issues in worker threads
		if (typeof globalThis.Response === "function") {
			try {
				Object.defineProperty(globalThis.Response, Symbol.hasInstance, {
					value(instance: unknown) {
						return (
							instance &&
							typeof instance === "object" &&
							((instance as { constructor?: { name?: string } }).constructor
								?.name === "Response" ||
								typeof (instance as { arrayBuffer?: unknown }).arrayBuffer ===
									"function")
						);
					},
					configurable: true,
				});
			} catch {}
		}

		try {
			// Resolve Node.js imports and paths once upfront (captured in closure)
			const { createRequire } = await import(
				/* webpackIgnore: true */ /* @vite-ignore */ "node:module"
			);
			const fs = await import(
				/* webpackIgnore: true */ /* @vite-ignore */ "node:fs/promises"
			);
			const nodePath = await import(
				/* webpackIgnore: true */ /* @vite-ignore */ "node:path"
			);
			const require = createRequire(import.meta.url);

			let localWasmPath: string | null = null;
			try {
				const mainPath = require.resolve("@lottiefiles/dotlottie-web");
				const distIndex = mainPath.lastIndexOf("/dist/");
				if (distIndex !== -1) {
					localWasmPath = nodePath.join(
						mainPath.substring(0, distIndex),
						"dist/dotlottie-player.wasm",
					);
				}
			} catch {}

			if (localWasmPath) {
				const buffer = await fs.readFile(localWasmPath);
				const wasmBase64 = buffer.toString("base64");
				DotLottie.setWasmUrl(`data:application/wasm;base64,${wasmBase64}`);
			}
		} catch (err) {
			console.warn(
				"[LottieRenderer] Failed to configure headless WASM path:",
				err,
			);
		}
	}
	wasmConfigured = true;
}

class LottieLoader {
	private cache = new Map<string, Promise<LottieInstance>>();

	async load(
		src: string,
		width: number,
		height: number,
	): Promise<LottieInstance> {
		await ensureWasmConfigured();
		const resolvedWidth = Math.max(1, Math.ceil(width));
		const resolvedHeight = Math.max(1, Math.ceil(height));
		const key = `${src}@@${resolvedWidth}x${resolvedHeight}`;
		let promise = this.cache.get(key);
		if (!promise) {
			promise = (async () => {
				// 1. Parse the Lottie JSON if applicable, extract its fonts and register them.
				// This runs before the LottieInstance is created, so the text layers are shaped
				// with the registered fonts from the start.
				let resolvedSrc = src;
				try {
					let lottieJson: any = null;
					const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);

					if (resolvedSrc.startsWith("data:application/json;base64,")) {
						const base64Data = resolvedSrc.split(",")[1];
						const jsonStr = decodeBase64(base64Data);
						lottieJson = JSON.parse(jsonStr);
					} else if (resolvedSrc.startsWith("data:application/json,")) {
						const decodeData = decodeURIComponent(resolvedSrc.split(",")[1]);
						lottieJson = JSON.parse(decodeData);
					} else if (isNode && (resolvedSrc.startsWith("/") || resolvedSrc.startsWith("file://")) && resolvedSrc.endsWith(".json")) {
						let filePath = resolvedSrc;
						if (filePath.startsWith("file://")) {
							try {
								filePath = new URL(filePath).pathname;
							} catch {
								filePath = filePath.replace(/^file:\/\//, "");
							}
						}
						const fs = await import(/* webpackIgnore: true */ "fs/promises");
						const jsonContent = await fs.readFile(filePath, "utf-8");
						lottieJson = JSON.parse(jsonContent);
						const base64Data = Buffer.from(jsonContent).toString("base64");
						resolvedSrc = `data:application/json;base64,${base64Data}`;
					} else if (
						resolvedSrc.startsWith("http://") ||
						resolvedSrc.startsWith("https://") ||
						resolvedSrc.startsWith("/")
					) {
						// Only pre-fetch JSON animations. Binary .lottie zip files pack their own fonts.
						if (resolvedSrc.endsWith(".json") || resolvedSrc.includes("/assets/")) {
							const response = await fetch(resolveUrl(resolvedSrc));
							if (response.ok) {
								lottieJson = await response.json();
							}
						}
					}

					if (lottieJson) {
						const fonts = extractFontFamiliesFromLottie(lottieJson);
						if (fonts.length > 0) {
							await Promise.all(
								fonts.map((family) => registerLottieFont(family)),
							);
						}
					}
				} catch (err) {
					console.warn(
						`[LottieRenderer] Failed to load/register fonts for Lottie:`,
						err,
					);
				}

				// 2. Create the instance and wait for it to be ready.
				const instance = new LottieInstance(resolvedSrc, resolvedWidth, resolvedHeight);
				await instance.ready();

				return instance;
			})();
			this.cache.set(key, promise);
			promise.catch(() => this.cache.delete(key));
		}
		return promise;
	}
}

export const lottieLoader = new LottieLoader();

export async function drawLottieNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: LottieNodeProps,
): Promise<void> {
	const resolvedWidth = Math.max(1, Math.ceil(props.dstRect.width));
	const resolvedHeight = Math.max(1, Math.ceil(props.dstRect.height));
	const instance = await lottieLoader.load(
		props.src,
		resolvedWidth,
		resolvedHeight,
	);

	const lottieFps = instance.fps;
	const mappedFrame = Math.floor((props.frame * lottieFps) / props.fps);
	const loopedFrame = mappedFrame % Math.max(1, instance.totalFrames);

	const fitMode = props.fit || "contain";
	const cacheKey = `${props.src}@@${loopedFrame}@@${resolvedWidth}x${resolvedHeight}@@${fitMode}`;
	let tex = textureCache.acquire(cacheKey);

	if (!tex) {
		const canvas = instance.renderFrame(loopedFrame, fitMode);

		tex = ctx.device.createTexture({
			size: [instance.width, instance.height],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});

		try {
			ctx.device.queue.copyExternalImageToTexture(
				{ source: canvas as unknown as GPUImageCopyExternalImageSource },
				{ texture: tex, premultipliedAlpha: true },
				[instance.width, instance.height],
			);
		} catch {
			const c2d = canvas.getContext("2d");
			if (c2d) {
				const imgData = (
					c2d as unknown as OffscreenCanvasRenderingContext2D
				).getImageData(0, 0, instance.width, instance.height);
				const pixelBuffer = new Uint8Array(
					imgData.data.buffer,
					imgData.data.byteOffset,
					imgData.data.byteLength,
				);
				ctx.device.queue.writeTexture(
					{ texture: tex },
					pixelBuffer,
					{ bytesPerRow: instance.width * 4 },
					[instance.width, instance.height],
				);
			} else {
				const gl =
					canvas.getContext("webgl") ||
					canvas.getContext(
						"experimental-webgl" as unknown as OffscreenRenderingContextId,
					);
				if (gl) {
					const pixels = new Uint8Array(instance.width * instance.height * 4);
					(gl as any).readPixels(
						0,
						0,
						instance.width,
						instance.height,
						(gl as any).RGBA,
						(gl as any).UNSIGNED_BYTE,
						pixels,
					);

					// WebGL pixels are flipped vertically, so flip them back for WebGPU/2D compatibility
					const flipped = new Uint8Array(pixels.length);
					const bytesPerRow = instance.width * 4;
					for (let y = 0; y < instance.height; y++) {
						const srcOffset = y * bytesPerRow;
						const dstOffset = (instance.height - 1 - y) * bytesPerRow;
						flipped.set(
							pixels.subarray(srcOffset, srcOffset + bytesPerRow),
							dstOffset,
						);
					}

					ctx.device.queue.writeTexture(
						{ texture: tex },
						flipped,
						{ bytesPerRow: bytesPerRow },
						[instance.width, instance.height],
					);
				} else {
					console.error(
						"[LottieRenderer] Could not acquire 2D or WebGL context to read pixels.",
					);
				}
			}
		}

		textureCache.set(cacheKey, tex, ctx.device);
	}

	ctx.renderer.drawTexture(pass, tex, props.dstRect, {
		opacity: props.opacity ?? 1,
		transform: props.matrix,
	});

	textureCache.release(cacheKey);
}
