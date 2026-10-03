import { createRequire } from "node:module";
import {
	ChartGPU,
	type ChartGPUInstance,
	type ChartGPUOptions,
} from "chartgpu";
import type { RenderContextValue } from "../render-context.js";
import type { ChartNodeProps } from "./types.js";

const nodeRequire =
	typeof import.meta?.url === "string" ? createRequire(import.meta.url) : null;

// ==============================================================================================
// 1. HEADLESS CANVAS & WEBGPU CONTEXT ADAPTER
// ==============================================================================================

export interface HeadlessChartTarget {
	readonly device: GPUDevice;
	readonly format: GPUTextureFormat;
	width: number;
	height: number;
	currentTexture: GPUTexture;
}

export class HeadlessGPUCanvasContextMock {
	private target: HeadlessChartTarget;
	configuredFormat: GPUTextureFormat | null = null;

	constructor(target: HeadlessChartTarget) {
		this.target = target;
	}

	configure(config: GPUCanvasConfiguration): void {
		this.configuredFormat = config.format;
	}

	unconfigure(): void {
		this.configuredFormat = null;
	}

	getCurrentTexture(): GPUTexture {
		return this.target.currentTexture;
	}
}

export interface Headless2DContextFallback {
	save(): void;
	restore(): void;
	setTransform(
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	): void;
	clearRect(x: number, y: number, w: number, h: number): void;
	fillText(text: string, x: number, y: number): void;
	measureText(text: string): { width: number };
}

export class HeadlessChartCanvasElementMock {
	width: number;
	height: number;
	clientWidth: number;
	clientHeight: number;
	readonly style: Record<string, string> = {
		display: "block",
		width: "100%",
		height: "100%",
		position: "absolute",
		inset: "0",
	};

	private gpuContext: HeadlessGPUCanvasContextMock;
	private ctx2d: Headless2DContextFallback | null = null;

	constructor(target: HeadlessChartTarget) {
		this.width = target.width;
		this.height = target.height;
		this.clientWidth = target.width;
		this.clientHeight = target.height;
		this.gpuContext = new HeadlessGPUCanvasContextMock(target);
	}

	getContext(type: string): unknown {
		if (type === "webgpu") {
			return this.gpuContext;
		}
		if (type === "2d") {
			if (!this.ctx2d) {
				try {
					if (nodeRequire) {
						const { Canvas } = nodeRequire("skia-canvas");
						const skiaCanvas = new Canvas(this.width, this.height);
						this.ctx2d = skiaCanvas.getContext(
							"2d",
						) as unknown as Headless2DContextFallback;
					}
				} catch {
					// Fall back to lightweight stub
				}
				if (!this.ctx2d) {
					this.ctx2d = {
						save: () => {},
						restore: () => {},
						setTransform: () => {},
						clearRect: () => {},
						fillText: () => {},
						measureText: (text: string) => ({ width: text.length * 7 }),
					};
				}
			}
			return this.ctx2d;
		}
		return null;
	}

	getBoundingClientRect(): {
		x: number;
		y: number;
		width: number;
		height: number;
		top: number;
		left: number;
		right: number;
		bottom: number;
	} {
		return {
			x: 0,
			y: 0,
			width: this.clientWidth,
			height: this.clientHeight,
			top: 0,
			left: 0,
			right: this.clientWidth,
			bottom: this.clientHeight,
		};
	}

	addEventListener(
		_type: string,
		_listener: unknown,
		_options?: unknown,
	): void {}

	removeEventListener(
		_type: string,
		_listener: unknown,
		_options?: unknown,
	): void {}

	setPointerCapture(_pointerId: number): void {}

	releasePointerCapture(_pointerId: number): void {}

	hasPointerCapture(_pointerId: number): boolean {
		return false;
	}

	remove(): void {}
}

export class HeadlessChartContainerMock {
	readonly style: Record<string, string> = {
		position: "relative",
		overflow: "hidden",
	};
	children: unknown[] = [];

	clientWidth: number;
	clientHeight: number;

	constructor(width: number, height: number) {
		this.clientWidth = width;
		this.clientHeight = height;
	}

	appendChild(child: unknown): unknown {
		this.children.push(child);
		return child;
	}

	removeChild(child: unknown): unknown {
		this.children = this.children.filter((c) => c !== child);
		return child;
	}

	getBoundingClientRect(): {
		x: number;
		y: number;
		width: number;
		height: number;
		top: number;
		left: number;
		right: number;
		bottom: number;
	} {
		return {
			x: 0,
			y: 0,
			width: this.clientWidth,
			height: this.clientHeight,
			top: 0,
			left: 0,
			right: this.clientWidth,
			bottom: this.clientHeight,
		};
	}
}

// ==============================================================================================
// 2. CHARTGPU ENGINE BRIDGE & TIMELINE CONTROLLER
// ==============================================================================================

export interface ChartGPUAdapterInitOptions {
	device: GPUDevice;
	adapter?: GPUAdapter;
	width: number;
	height: number;
	dpr?: number;
	colorFormat?: GPUTextureFormat;
}

let activeCanvasMockForNextCreation: HeadlessChartCanvasElementMock | null =
	null;

export class ChartGPUEngineBridge {
	private chartInstance: ChartGPUInstance | null = null;
	private target: HeadlessChartTarget;
	private containerMock: HeadlessChartContainerMock;
	private canvasMock: HeadlessChartCanvasElementMock;
	private dpr: number;
	private initialOptions: ChartGPUOptions | null = null;
	private ownsTexture: boolean;
	private lastRenderedProgress: number | null = null;

	constructor(options: ChartGPUAdapterInitOptions) {
		this.dpr = options.dpr ?? 1.0;
		const texW = Math.max(1, Math.round(options.width * this.dpr));
		const texH = Math.max(1, Math.round(options.height * this.dpr));

		const renderAttachment =
			typeof GPUTextureUsage !== "undefined"
				? GPUTextureUsage.RENDER_ATTACHMENT
				: 0x10;
		const textureBinding =
			typeof GPUTextureUsage !== "undefined"
				? GPUTextureUsage.TEXTURE_BINDING
				: 0x04;
		const copySrc =
			typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.COPY_SRC : 0x01;
		const copyDst =
			typeof GPUTextureUsage !== "undefined" ? GPUTextureUsage.COPY_DST : 0x02;

		const texture = options.device.createTexture({
			size: [texW, texH],
			format: options.colorFormat ?? "rgba8unorm",
			usage: renderAttachment | textureBinding | copySrc | copyDst,
		});

		this.ownsTexture = true;
		this.target = {
			device: options.device,
			format: options.colorFormat ?? "rgba8unorm",
			width: texW,
			height: texH,
			currentTexture: texture,
		};

		this.containerMock = new HeadlessChartContainerMock(
			options.width,
			options.height,
		);
		this.canvasMock = new HeadlessChartCanvasElementMock(this.target);
	}

	get width(): number {
		return this.target.width;
	}

	get height(): number {
		return this.target.height;
	}

	get currentTexture(): GPUTexture {
		return this.target.currentTexture;
	}

	private setupHeadlessDOM(): void {
		const gEnv = globalThis as unknown as Record<string, unknown>;

		if (typeof gEnv.document === "undefined") {
			gEnv.document = {};
		}
		const doc = gEnv.document as Record<string, unknown>;

		const originalCreateElement =
			typeof doc.createElement === "function"
				? (
						doc.createElement as (tag: string, ...args: unknown[]) => unknown
					).bind(doc)
				: null;

		doc.createElement = (tag: string, ...args: unknown[]) => {
			if (tag === "canvas") {
				if (activeCanvasMockForNextCreation) {
					const mock = activeCanvasMockForNextCreation;
					activeCanvasMockForNextCreation = null;
					return mock;
				}
				if (originalCreateElement) {
					try {
						const el = originalCreateElement(tag, ...args);
						if (el) {
							const elObj = el as Record<string, unknown>;
							if (typeof elObj.remove !== "function") elObj.remove = () => {};
							if (typeof elObj.addEventListener !== "function")
								elObj.addEventListener = () => {};
							if (typeof elObj.removeEventListener !== "function")
								elObj.removeEventListener = () => {};
							if (!elObj.style) elObj.style = {};
							return el;
						}
					} catch (_) {}
				}
				return new HeadlessChartCanvasElementMock(this.target);
			}

			if (originalCreateElement) {
				try {
					const el = originalCreateElement(tag, ...args);
					if (el) {
						const elObj = el as Record<string, unknown>;
						if (typeof elObj.remove !== "function") elObj.remove = () => {};
						if (typeof elObj.addEventListener !== "function")
							elObj.addEventListener = () => {};
						if (typeof elObj.removeEventListener !== "function")
							elObj.removeEventListener = () => {};
						if (!elObj.style) elObj.style = {};
						return el;
					}
				} catch (_) {}
			}

			return {
				style: {},
				appendChild: () => {},
				removeChild: () => {},
				remove: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
			};
		};

		if (typeof doc.createElementNS === "undefined") {
			doc.createElementNS = (_ns: string, _tag: string) => ({
				style: {},
				setAttribute: () => {},
				getAttribute: () => null,
				appendChild: () => {},
				removeChild: () => {},
				remove: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
			});
		}

		if (typeof doc.getElementsByTagName === "undefined") {
			doc.getElementsByTagName = () => [];
		}

		if (typeof gEnv.window === "undefined") {
			gEnv.window = globalThis;
		}
		const win = gEnv.window as Record<string, unknown>;
		if (typeof win.devicePixelRatio === "undefined") {
			win.devicePixelRatio = this.dpr;
		}
		if (typeof win.getComputedStyle === "undefined") {
			win.getComputedStyle = () => ({
				position: "relative",
				overflow: "hidden",
				fontFamily: "Inter, sans-serif",
			});
		}

		if (typeof globalThis.requestAnimationFrame === "undefined") {
			globalThis.requestAnimationFrame = (
				callback: (time: number) => void,
			): number => {
				return setTimeout(
					() => callback(performance.now()),
					16,
				) as unknown as number;
			};
		}
		if (typeof globalThis.cancelAnimationFrame === "undefined") {
			globalThis.cancelAnimationFrame = (id: number): void => {
				clearTimeout(id as unknown as NodeJS.Timeout);
			};
		}

		const g = globalThis as unknown as {
			GPUShaderStage?: unknown;
			GPUBufferUsage?: unknown;
			GPUTextureUsage?: unknown;
		};
		if (typeof g.GPUShaderStage === "undefined") {
			g.GPUShaderStage = {
				VERTEX: 0x1,
				FRAGMENT: 0x2,
				COMPUTE: 0x4,
			};
		}
		if (typeof g.GPUBufferUsage === "undefined") {
			g.GPUBufferUsage = {
				MAP_READ: 0x0001,
				MAP_WRITE: 0x0002,
				COPY_SRC: 0x0004,
				COPY_DST: 0x0008,
				INDEX: 0x0010,
				VERTEX: 0x0020,
				UNIFORM: 0x0040,
				STORAGE: 0x0080,
				INDIRECT: 0x0100,
				QUERY_RESOLVE: 0x0200,
			};
		}
		if (typeof g.GPUTextureUsage === "undefined") {
			g.GPUTextureUsage = {
				COPY_SRC: 0x01,
				COPY_DST: 0x02,
				TEXTURE_BINDING: 0x04,
				STORAGE_BINDING: 0x08,
				RENDER_ATTACHMENT: 0x10,
			};
		}

		const preferredFormat = this.target.format ?? "rgba8unorm";
		const navEnv = globalThis as unknown as {
			navigator?: {
				gpu?: {
					requestAdapter?: () => Promise<{
						requestDevice: () => Promise<GPUDevice>;
					}>;
					getPreferredCanvasFormat?: () => GPUTextureFormat;
				};
			};
		};
		if (typeof navEnv.navigator === "undefined") {
			navEnv.navigator = {
				gpu: {
					requestAdapter: async () => ({
						requestDevice: async () => this.target.device,
					}),
					getPreferredCanvasFormat: () => preferredFormat,
				},
			};
		} else if (!navEnv.navigator.gpu) {
			Object.defineProperty(navEnv.navigator, "gpu", {
				value: {
					requestAdapter: async () => ({
						requestDevice: async () => this.target.device,
					}),
					getPreferredCanvasFormat: () => preferredFormat,
				},
				configurable: true,
				writable: true,
			});
		} else {
			Object.defineProperty(navEnv.navigator.gpu, "getPreferredCanvasFormat", {
				value: () => preferredFormat,
				configurable: true,
				writable: true,
			});
		}
	}

	async initialize(chartOptions: ChartGPUOptions): Promise<void> {
		const safeOptions: ChartGPUOptions = {
			...structuredClone(chartOptions),
			animation: false,
		};
		this.initialOptions = safeOptions;
		this.lastRenderedProgress = null;
		this.setupHeadlessDOM();

		activeCanvasMockForNextCreation = this.canvasMock;

		const createContext = {
			device: this.target.device,
			adapter:
				(this.target.device as unknown as { adapter?: GPUAdapter }).adapter ??
				({} as GPUAdapter),
		};

		try {
			this.chartInstance = await ChartGPU.create(
				this.containerMock as unknown as HTMLElement,
				safeOptions,
				createContext,
			);
		} finally {
			activeCanvasMockForNextCreation = null;
		}

		this.chartInstance.setRenderMode("external");
	}

	async renderFrame(
		progress = 1.0,
		destinationTexture?: GPUTexture,
	): Promise<GPUTexture> {
		if (!this.chartInstance) {
			throw new Error(
				"ChartGPUEngineBridge not initialized. Call initialize() first.",
			);
		}

		if (destinationTexture) {
			if (
				this.ownsTexture &&
				this.target.currentTexture !== destinationTexture
			) {
				try {
					this.target.currentTexture.destroy();
				} catch (_) {}
				this.ownsTexture = false;
			}
			this.target.currentTexture = destinationTexture;
		}

		// Update series data / clipping according to timeline reveal progress
		if (this.lastRenderedProgress !== progress) {
			this.lastRenderedProgress = progress;
			if (progress < 1 && this.initialOptions?.series) {
				const updatedSeries = this.initialOptions.series.map(
					(s: NonNullable<ChartGPUOptions["series"]>[number]) => {
						if (!Array.isArray(s.data)) return s;
						const visibleCount = Math.max(
							2,
							Math.round(s.data.length * progress),
						);
						return {
							...s,
							data: s.data.slice(0, visibleCount),
						};
					},
				);
				this.chartInstance.setOption({
					...this.initialOptions,
					animation: false,
					series: updatedSeries,
				});
			} else if (this.initialOptions) {
				this.chartInstance.setOption({
					...this.initialOptions,
					animation: false,
				});
			}
		}

		// Render the frame synchronously; ChartGPU submits to device queue
		this.chartInstance.renderFrame();

		// Microtask yield ensures deferred GPU queue encode submission is finalized
		await Promise.resolve();

		return this.target.currentTexture;
	}

	destroy(): void {
		if (this.chartInstance) {
			this.chartInstance.dispose();
			this.chartInstance = null;
		}
		if (this.ownsTexture && this.target.currentTexture) {
			try {
				this.target.currentTexture.destroy();
			} catch (_) {}
		}
	}
}

// ==============================================================================================
// 3. BRIDGE CACHING & DRAW NODE IMPLEMENTATION
// ==============================================================================================

export const chartBridgeCache = new Map<string, ChartGPUEngineBridge>();

export async function drawChartNode(
	ctx: RenderContextValue,
	pass: GPURenderPassEncoder,
	props: ChartNodeProps,
): Promise<void> {
	const key = props.nodeId ?? "default_chart";
	const rectW = Math.max(1, Math.round(props.dstRect.width));
	const rectH = Math.max(1, Math.round(props.dstRect.height));

	let bridge = chartBridgeCache.get(key);
	if (bridge && (bridge.width !== rectW || bridge.height !== rectH)) {
		bridge.destroy();
		chartBridgeCache.delete(key);
		bridge = undefined;
	}

	if (!bridge) {
		bridge = new ChartGPUEngineBridge({
			device: ctx.device,
			width: rectW,
			height: rectH,
		});
		await bridge.initialize(props.chartOptions);
		chartBridgeCache.set(key, bridge);
	}

	const progress = props.progress ?? props.drawProgress ?? 1.0;
	const chartTexture = await bridge.renderFrame(progress);

	ctx.renderer.drawTexture(pass, chartTexture, props.dstRect, {
		opacity: props.opacity ?? 1,
		transform: props.matrix,
	});
}
