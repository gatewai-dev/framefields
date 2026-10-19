import { GetFontAssetUrl, localFontManager } from "@framefields/client-utils";
import { DotLottie, type Fit } from "@lottiefiles/dotlottie-web";
import { premultiplyPixels } from "../color.js";
import { debugLog } from "../debug-log.js";
import {
	createHeadlessDOMElement,
	installIntersectionObserverStub,
	patchCanvasPrototypeForDOM,
} from "../headless/dom-shims.js";
import {
	getHeadlessFontData,
	registerHeadlessFont,
} from "../headless-font-loader.js";
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

function extractFontFamiliesFromLottie(
	lottieJson: Record<string, unknown> | null | undefined,
): string[] {
	const fonts = new Set<string>();

	// 1. Extract from fonts.list (both fName and fFamily)
	const fontsList = (
		lottieJson?.fonts as
			| { list?: Array<{ fName?: string; fFamily?: string }> }
			| undefined
	)?.list;
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
		const l = layer as {
			ty?: number;
			t?: { d?: { k?: unknown }; k?: unknown };
		};
		if (l?.ty !== 5) continue; // ty: 5 is Text Layer

		const k = l?.t?.d?.k ?? l?.t?.k;
		if (!k) continue;

		const kArr = Array.isArray(k) ? k : [k];
		for (const kf of kArr) {
			// Handle keyframe wrappers (s, e) AND direct document objects (kf)
			const kfObj = kf as { s?: unknown; e?: unknown } | undefined;
			const possibleDocs = [kfObj?.s, kfObj?.e, kf].filter(Boolean);

			for (const doc of possibleDocs) {
				// Handle both single document objects and arrays of documents
				const docArr = Array.isArray(doc) ? doc : [doc];
				for (const d of docArr) {
					const docItem = d as { f?: string } | undefined;
					if (docItem?.f && typeof docItem.f === "string") {
						fonts.add(docItem.f);
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

	debugLog(
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
		} catch (_err) {
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
			registered = await DotLottie.registerFont(family, fontUrl);
			if (!registered) {
				console.warn(
					`[LottieRenderer] DotLottie.registerFont via URL also failed for "${family}" (${fontUrl})`,
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

class HeadlessLottieCanvas {
	public width: number;
	public height: number;
	public style: Record<string, unknown> = {};

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
	}

	addEventListener(): void {}
	removeEventListener(): void {}
	getContext(contextId: string): unknown {
		if (contextId === "2d") {
			return {
				fillRect(): void {},
				clearRect(): void {},
				putImageData(): void {},
				createImageData(width: number, height: number) {
					return {
						width,
						height,
						data: new Uint8ClampedArray(width * height * 4),
					};
				},
				getImageData(_sx: number, _sy: number, sw: number, sh: number) {
					return {
						width: sw,
						height: sh,
						data: new Uint8ClampedArray(sw * sh * 4),
					};
				},
			};
		}
		return null;
	}
	getBoundingClientRect(): {
		left: number;
		top: number;
		width: number;
		height: number;
	} {
		return { left: 0, top: 0, width: this.width, height: this.height };
	}
}

export class LottieInstance {
	private dotLottie: DotLottie;
	private canvas: OffscreenCanvas;
	private loadPromise: Promise<void>;
	private _width: number;
	private _height: number;
	private uploadBuffer: Uint8Array | null = null;

	constructor(
		src: string,
		width: number,
		height: number,
		data?: string | ArrayBuffer,
	) {
		this._width = width;
		this._height = height;
		const isBrowser =
			typeof window !== "undefined" &&
			typeof document !== "undefined" &&
			typeof document.createElement === "function" &&
			typeof document.getElementById === "function";

		this.canvas = isBrowser
			? new OffscreenCanvas(width, height)
			: (new HeadlessLottieCanvas(width, height) as unknown as OffscreenCanvas);

		this.dotLottie = new DotLottie({
			canvas: this.canvas,
			...(data ? { data } : { src }),
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
						: new Error(`Failed to load DotLottie animation from '${src}'`),
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

	renderPixels(
		frame: number,
		fit?: "contain" | "cover" | "fill",
	): Uint8Array | null {
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

		const core = (
			this.dotLottie as unknown as {
				_dotLottieCore?: { get_pixel_buffer: () => Uint8Array };
			}
		)._dotLottieCore;

		if (core && typeof core.get_pixel_buffer === "function") {
			const buf = core.get_pixel_buffer();
			const expectedLength = this._width * this._height * 4;
			if (buf && buf.byteLength === expectedLength) {
				if (
					!this.uploadBuffer ||
					this.uploadBuffer.byteLength !== expectedLength
				) {
					this.uploadBuffer = new Uint8Array(expectedLength);
				}
				this.uploadBuffer.set(buf);
				return premultiplyPixels(this.uploadBuffer);
			}
		}

		return null;
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
		this.uploadBuffer = null;
	}
}

let wasmConfigured = false;

function polyfillHeadlessDOM(): void {
	const globalObj = globalThis as unknown as Record<string, unknown>;

	const dummyElement = createHeadlessDOMElement();

	installIntersectionObserverStub();

	if (typeof globalThis.HTMLCanvasElement === "undefined") {
		if (typeof globalThis.OffscreenCanvas !== "undefined") {
			globalObj.HTMLCanvasElement = globalThis.OffscreenCanvas;
		}
	}

	if (!globalThis.document) {
		(globalThis as unknown as Record<string, unknown>).document = {
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
		} as unknown as Document;
	}
	const docObj = globalThis.document as unknown as Record<string, unknown>;

	docObj.documentElement ??= dummyElement;
	docObj.body ??= dummyElement;

	const CanvasCtor = globalThis.HTMLCanvasElement || globalThis.OffscreenCanvas;
	if (CanvasCtor && typeof CanvasCtor === "function") {
		const proto = (
			CanvasCtor as unknown as { prototype: Record<string, unknown> }
		).prototype;
		if (proto) patchCanvasPrototypeForDOM(proto, dummyElement);
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
		if (typeof globalThis.OffscreenCanvas === "undefined") {
			(globalThis as unknown as Record<string, unknown>).OffscreenCanvas =
				HeadlessLottieCanvas;
		}
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
				const resolvedSrc = src;
				let lottieData: string | ArrayBuffer | undefined;
				try {
					let lottieJson: Record<string, unknown> | null = null;
					const isNode =
						typeof process !== "undefined" && Boolean(process.versions?.node);
					const isRemote =
						resolvedSrc.startsWith("http://") ||
						resolvedSrc.startsWith("https://") ||
						resolvedSrc.startsWith("data:");

					if (resolvedSrc.startsWith("data:application/json;base64,")) {
						const base64Data = resolvedSrc.split(",")[1];
						const jsonStr = decodeBase64(base64Data);
						lottieJson = JSON.parse(jsonStr);
						lottieData = jsonStr;
					} else if (resolvedSrc.startsWith("data:application/json,")) {
						const decodeData = decodeURIComponent(resolvedSrc.split(",")[1]);
						lottieJson = JSON.parse(decodeData);
						lottieData = decodeData;
					} else if (isNode && !isRemote) {
						let filePath = resolvedSrc;
						if (filePath.startsWith("file://")) {
							try {
								filePath = new URL(filePath).pathname;
							} catch {
								filePath = filePath.replace(/^file:\/\//, "");
							}
						}
						const pathModule = await import(
							/* webpackIgnore: true */ "node:path"
						);
						if (!pathModule.isAbsolute(filePath)) {
							filePath = pathModule.resolve(process.cwd(), filePath);
						}
						try {
							const fs = await import(
								/* webpackIgnore: true */ "node:fs/promises"
							);
							if (filePath.endsWith(".json")) {
								const jsonContent = await fs.readFile(filePath, "utf-8");
								lottieJson = JSON.parse(jsonContent);
								lottieData = jsonContent;
							} else {
								const fileBuf = await fs.readFile(filePath);
								lottieData = fileBuf.buffer.slice(
									fileBuf.byteOffset,
									fileBuf.byteOffset + fileBuf.byteLength,
								);
							}
						} catch {
							// If file read fails (e.g. mocked path in tests), fall back to resolvedSrc
						}
					} else if (
						isRemote &&
						(resolvedSrc.endsWith(".json") || resolvedSrc.includes("/assets/"))
					) {
						const response = await fetch(resolvedSrc);
						if (response.ok) {
							lottieJson = await response.json();
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
				const instance = new LottieInstance(
					resolvedSrc,
					resolvedWidth,
					resolvedHeight,
					lottieData,
				);
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
	const baseWidth = Math.max(1, Math.ceil(props.dstRect.width));
	const baseHeight = Math.max(1, Math.ceil(props.dstRect.height));
	const requestedDpr =
		typeof props.dpr === "number" && props.dpr > 0 ? props.dpr : 2;
	const maxDim = Math.max(baseWidth, baseHeight);
	const maxAllowedDpr = Math.max(1, Math.floor(4096 / Math.max(1, maxDim)));
	const effectiveDpr = Math.min(requestedDpr, maxAllowedDpr);

	const resolvedWidth = Math.max(1, Math.round(baseWidth * effectiveDpr));
	const resolvedHeight = Math.max(1, Math.round(baseHeight * effectiveDpr));

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
		tex = ctx.device.createTexture({
			size: [instance.width, instance.height],
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.RENDER_ATTACHMENT,
		});

		const pixelBuffer = instance.renderPixels(loopedFrame, fitMode);
		if (pixelBuffer) {
			ctx.device.queue.writeTexture(
				{ texture: tex },
				pixelBuffer,
				{ bytesPerRow: instance.width * 4 },
				[instance.width, instance.height],
			);
		} else {
			const canvas = instance.renderFrame(loopedFrame, fitMode);
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
					// getImageData returns straight alpha.
					const fallbackBuffer = premultiplyPixels(
						new Uint8Array(
							imgData.data.buffer,
							imgData.data.byteOffset,
							imgData.data.byteLength,
						),
					);
					ctx.device.queue.writeTexture(
						{ texture: tex },
						fallbackBuffer,
						{ bytesPerRow: instance.width * 4 },
						[instance.width, instance.height],
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
