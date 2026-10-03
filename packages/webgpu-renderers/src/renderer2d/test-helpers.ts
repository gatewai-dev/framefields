import { vi } from "vitest";

export interface MockTexture {
	width: number;
	height: number;
	format: string;
	usage: number;
	destroy: any;
	createView: any;
}

export interface MockBuffer {
	size: number;
	usage: number;
	destroy: any;
	getMappedRange: any;
	unmap: any;
}

export function createMockTexture(
	width = 1024,
	height = 1024,
	format = "rgba8unorm",
	usage = 0,
): MockTexture {
	return {
		width,
		height,
		format,
		usage,
		destroy: vi.fn(),
		createView: vi.fn().mockImplementation(() => ({})),
	};
}

export function createMockBuffer(size: number, usage: number): MockBuffer {
	let mappedBuffer: ArrayBuffer | null = null;
	return {
		size,
		usage,
		destroy: vi.fn(),
		getMappedRange: vi.fn().mockImplementation(() => {
			if (!mappedBuffer) mappedBuffer = new ArrayBuffer(size);
			return mappedBuffer;
		}),
		unmap: vi.fn(),
	};
}


export function createMockDevice(): GPUDevice {
	const onSubmittedWorkDonePromise = Promise.resolve();
	const queue = {
		writeBuffer: vi.fn(),
		writeTexture: vi.fn(),
		copyExternalImageToTexture: vi.fn(),
		onSubmittedWorkDone: vi.fn().mockReturnValue(onSubmittedWorkDonePromise),
	};

	const device = {
		queue,
		limits: {
			maxTextureDimension2D: 8192,
		},
		features: {
			has: vi.fn().mockReturnValue(true),
		},
		createBuffer: vi
			.fn()
			.mockImplementation((desc) => createMockBuffer(desc.size, desc.usage)),
		createTexture: vi
			.fn()
			.mockImplementation((desc) => {
				const w = Array.isArray(desc.size)
					? desc.size[0]
					: (desc.size?.width ?? 1024);
				const h = Array.isArray(desc.size)
					? desc.size[1]
					: (desc.size?.height ?? 1024);
				return createMockTexture(w, h, desc.format, desc.usage);
			}),
		createSampler: vi.fn().mockImplementation(() => ({})),
		createShaderModule: vi.fn().mockImplementation(() => ({})),
		createBindGroupLayout: vi.fn().mockImplementation(() => ({})),
		createPipelineLayout: vi.fn().mockImplementation(() => ({})),
		createRenderPipeline: vi.fn().mockImplementation(() => ({})),
		createComputePipeline: vi.fn().mockImplementation(() => ({})),
		createBindGroup: vi.fn().mockImplementation(() => ({})),
	};

	return device as unknown as GPUDevice;
}

export function createMockComputePassEncoder(): GPUComputePassEncoder {
	return {
		setPipeline: vi.fn(),
		setBindGroup: vi.fn(),
		dispatchWorkgroups: vi.fn(),
		end: vi.fn(),
	} as unknown as GPUComputePassEncoder;
}

export function createMockRenderPassEncoder(): GPURenderPassEncoder {
	return {
		setScissorRect: vi.fn(),
		setPipeline: vi.fn(),
		setBindGroup: vi.fn(),
		setVertexBuffer: vi.fn(),
		setIndexBuffer: vi.fn(),
		draw: vi.fn(),
		drawIndexed: vi.fn(),
		end: vi.fn(),
	} as unknown as GPURenderPassEncoder;
}

export function createMockCommandEncoder(): GPUCommandEncoder {
	return {
		beginRenderPass: vi
			.fn()
			.mockImplementation(() => createMockRenderPassEncoder()),
		beginComputePass: vi
			.fn()
			.mockImplementation(() => createMockComputePassEncoder()),
		finish: vi.fn().mockImplementation(() => ({})),
	} as unknown as GPUCommandEncoder;
}

export function ensureDOMGlobals() {
	const domObj = globalThis as unknown as { DOMMatrix?: any; DOMPoint?: any };
	if (typeof domObj.DOMMatrix === "undefined") {
		domObj.DOMMatrix = class DOMMatrix {
			a = 1;
			b = 0;
			c = 0;
			d = 1;
			e = 0;
			f = 0;

			constructor(init?: any) {
				this.a = 1;
				this.b = 0;
				this.c = 0;
				this.d = 1;
				this.e = 0;
				this.f = 0;
				if (init instanceof DOMMatrix) {
					this.a = init.a;
					this.b = init.b;
					this.c = init.c;
					this.d = init.d;
					this.e = init.e;
					this.f = init.f;
				}
			}

			multiply(other: DOMMatrix): DOMMatrix {
				const m = new DOMMatrix();
				m.a = this.a * other.a + this.c * other.b;
				m.b = this.b * other.a + this.d * other.b;
				m.c = this.a * other.c + this.c * other.d;
				m.d = this.b * other.c + this.d * other.d;
				m.e = this.a * other.e + this.c * other.f + this.e;
				m.f = this.b * other.e + this.d * other.f + this.f;
				return m;
			}

			inverse(): DOMMatrix {
				const det = this.a * this.d - this.b * this.c;
				if (det === 0) throw new Error("Matrix is not invertible");
				const m = new DOMMatrix();
				m.a = this.d / det;
				m.b = -this.b / det;
				m.c = -this.c / det;
				m.d = this.a / det;
				m.e = (this.c * this.f - this.d * this.e) / det;
				m.f = (this.b * this.e - this.a * this.f) / det;
				return m;
			}

			transformPoint(point: { x: number; y: number }): {
				x: number;
				y: number;
			} {
				return {
					x: point.x * this.a + point.y * this.c + this.e,
					y: point.x * this.b + point.y * this.d + this.f,
				};
			}

			translate(x: number, y: number): DOMMatrix {
				const m = new DOMMatrix();
				m.e = x;
				m.f = y;
				return this.multiply(m);
			}

			scale(sx: number, sy?: number): DOMMatrix {
				const m = new DOMMatrix();
				m.a = sx;
				m.d = sy ?? sx;
				return this.multiply(m);
			}

			rotate(angle: number): DOMMatrix {
				const rad = (angle * Math.PI) / 180;
				const cos = Math.cos(rad);
				const sin = Math.sin(rad);
				const m = new DOMMatrix();
				m.a = cos;
				m.b = sin;
				m.c = -sin;
				m.d = cos;
				return this.multiply(m);
			}
		};
	}

	if (typeof domObj.DOMPoint === "undefined") {
		domObj.DOMPoint = class DOMPoint {
			constructor(
				public x = 0,
				public y = 0,
				public z = 0,
				public w = 1,
			) {}
			static fromPoint(other: {
				x?: number;
				y?: number;
				z?: number;
				w?: number;
			}) {
				return new DOMPoint(
					other.x ?? 0,
					other.y ?? 0,
					other.z ?? 0,
					other.w ?? 1,
				);
			}
		};
	}
}
