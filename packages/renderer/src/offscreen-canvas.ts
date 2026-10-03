import { Canvas as SkiaCanvas } from "skia-canvas";

let GL: any = null;
function getGL() { return null; }

// Only polyfill WebGLRenderingContext if not provided by the runtime (e.g. standard Node without Electron)
if (typeof globalThis.WebGLRenderingContext === "undefined") {
	const glMod = getGL();
	if (glMod?.WebGLRenderingContext) {
		global.WebGLRenderingContext = glMod.WebGLRenderingContext;
	}
}

// Only polyfill OffscreenCanvas if not provided natively by runtime
if (typeof globalThis.OffscreenCanvas === "undefined") {
	global.OffscreenCanvas = class OffscreenCanvasPolyfill
		implements OffscreenCanvas
	{
		private gl: WebGLRenderingContext | null = null;
		private skiaCanvas: SkiaCanvas | null = null;

		constructor(
			public readonly width: number,
			public readonly height: number,
		) {}

		oncontextlost: ((this: OffscreenCanvas, ev: Event) => unknown) | null =
			null;
		oncontextrestored: ((this: OffscreenCanvas, ev: Event) => unknown) | null =
			null;

		transferToImageBitmap(): ImageBitmap {
			throw new Error("Method not implemented.");
		}

		addEventListener(
			_type: string,
			_listener: EventListenerOrEventListenerObject | null,
			_options?: boolean | AddEventListenerOptions,
		): void {
			throw new Error("Method not implemented.");
		}

		convertToBlob(_options?: ImageEncodeOptions): Promise<Blob> {
			throw new Error("Method not implemented.");
		}

		removeEventListener(
			_type: string,
			_listener: EventListenerOrEventListenerObject | null,
			_options?: boolean | EventListenerOptions,
		): void {
			throw new Error("Method not implemented.");
		}

		dispatchEvent(_event: Event): boolean {
			throw new Error("Method not implemented.");
		}

		getContext(contextId: string, _options?: any): any {
			if (contextId === "webgl" || contextId === "experimental-webgl") {
				if (this.skiaCanvas) {
					return null;
				}
				if (!this.gl) {
					const glFactory = getGL();
					if (!glFactory) return null;
					const glCtx = glFactory(this.width, this.height, {
						preserveDrawingBuffer: true,
					});
					if (!glCtx) {
						return null;
					}
					this.gl = glCtx;
					const _getUniformLocation = glCtx.getUniformLocation;
					// Temporary fix for https://github.com/stackgl/headless-gl/issues/170
					glCtx.getUniformLocation = function (program: any, name: any) {
						if (program._uniforms && !/\[\d+\]$/.test(name)) {
							const reg = new RegExp(`${name}\\[\\d+\\]$`);
							for (let i = 0; i < program._uniforms.length; i++) {
								const _name = program._uniforms[i].name;
								if (reg.test(_name)) {
									name = _name;
								}
							}
						}
						return _getUniformLocation.call(this, program, name);
					};
				}
				return this.gl;
			}
			if (contextId === "2d") {
				if (this.gl) {
					return null;
				}
				if (!this.skiaCanvas) {
					this.skiaCanvas = new SkiaCanvas(this.width, this.height);
				}
				return this.skiaCanvas.getContext("2d");
			}
			return null;
		}
	};
}
