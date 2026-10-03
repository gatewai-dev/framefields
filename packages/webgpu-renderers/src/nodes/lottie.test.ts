import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { textureCache } from "../texture-cache.js";
import { drawLottieNode, lottieLoader } from "./lottie.js";

const mockDotLottieInstance = vi.hoisted(() => ({
	totalFrames: 100,
	duration: 3.333,
	isLoaded: true,
	width: 512,
	height: 512,
	speed: 0,
	addEventListener: vi.fn(),
	setFrame: vi.fn(),
	render: vi.fn(),
	resize: vi.fn(),
	destroy: vi.fn(),
	setLayout: vi.fn(),
	setViewport: vi.fn(),
}));

type MockDotLottieCtorArgs = { isLoaded?: boolean; triggerError?: string };
let nextCtorArgs: MockDotLottieCtorArgs = {};

vi.mock("@lottiefiles/dotlottie-web", () => {
	const MockDotLottie = vi.fn(function MockDotLottie() {
		const args = nextCtorArgs;
		nextCtorArgs = {};
		if (args.triggerError) {
			const inst = {
				...mockDotLottieInstance,
				isLoaded: false,
				addEventListener: vi.fn((event: string, cb: any) => {
					if (event === "loadError") {
						cb(new Error(args.triggerError));
					}
				}),
			};
			return inst;
		}
		return mockDotLottieInstance;
	}) as unknown as typeof import("@lottiefiles/dotlottie-web").DotLottie;

	(MockDotLottie as unknown as Record<string, unknown>).setWasmUrl = vi.fn();
	(MockDotLottie as unknown as Record<string, unknown>).registerFont = vi
		.fn()
		.mockResolvedValue(true);

	return {
		DotLottie: MockDotLottie,
	};
});

describe("Lottie Node", () => {
	beforeAll(() => {
		ensureDOMGlobals();
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
		} as any;
	});

	let mockDevice: any;
	let mockPass: any;
	let mockCtx: any;

	beforeEach(() => {
		vi.clearAllMocks();
		textureCache.destroy();
		(lottieLoader as any).cache.clear();
		mockDevice = createMockDevice();
		mockPass = createMockRenderPassEncoder();

		mockCtx = {
			device: mockDevice,
			renderer: {
				drawTexture: vi.fn(),
			},
		};

		mockDotLottieInstance.isLoaded = true;
		mockDotLottieInstance.addEventListener = vi.fn();

		vi.stubGlobal(
			"OffscreenCanvas",
			class {
				width: number;
				height: number;
				constructor(w: number, h: number) {
					this.width = w;
					this.height = h;
				}
				getContext() {
					return {
						fillRect: vi.fn(),
						getImageData: vi.fn().mockReturnValue({
							data: new Uint8ClampedArray(512 * 512 * 4),
						}),
					};
				}
			},
		);

		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({
				width: 512,
				height: 512,
				close: vi.fn(),
			}),
		);
	});

	describe("LottieLoader", () => {
		it("should load an animation", async () => {
			const instance = await lottieLoader.load("test.json", 512, 512);
			expect(instance.width).toBe(512);
			expect(instance.height).toBe(512);
			expect(instance.totalFrames).toBe(100);
			expect(instance.fps).toBe(30);

			const cached = await lottieLoader.load("test.json", 512, 512);
			expect(cached).toBe(instance);
		});

		it("should cache separately by dimensions", async () => {
			const small = await lottieLoader.load("test.json", 256, 256);
			const large = await lottieLoader.load("test.json", 512, 512);
			expect(small).not.toBe(large);
		});

		it("should handle loading error", async () => {
			mockDotLottieInstance.isLoaded = false;
			mockDotLottieInstance.addEventListener = vi.fn(
				(event: string, _cb: any) => {
					if (event === "loadError") {
						_cb(new Error("Network error"));
					}
				},
			);
			(lottieLoader as any).cache.clear();

			await expect(lottieLoader.load("bad.json", 512, 512)).rejects.toThrow(
				"Network error",
			);
		});
	});

	describe("drawLottieNode", () => {
		it("should render and draw Lottie frame in texture", async () => {
			const props = {
				src: "test.json",
				frame: 10,
				fps: 30,
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
			};

			await drawLottieNode(mockCtx, mockPass, props);

			expect(mockDevice.createTexture).toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
			expect(mockDotLottieInstance.setFrame).toHaveBeenCalledWith(10);
			expect(mockDotLottieInstance.setLayout).toHaveBeenCalledWith({
				align: [0.5, 0.5],
				fit: "contain",
			});
			expect(mockDotLottieInstance.resize).toHaveBeenCalled();
		});

		it("should handle fit props", async () => {
			const props = {
				src: "test.json",
				frame: 5,
				fps: 30,
				dstRect: { x: 10, y: 20, width: 200, height: 150 },
				fit: "cover" as const,
				opacity: 0.8,
			};

			await drawLottieNode(mockCtx, mockPass, props);

			expect(mockDotLottieInstance.setLayout).toHaveBeenCalledWith({
				align: [0.5, 0.5],
				fit: "cover",
			});

			expect(mockCtx.renderer.drawTexture).toHaveBeenCalledWith(
				mockPass,
				expect.any(Object),
				props.dstRect,
				expect.objectContaining({
					opacity: 0.8,
				}),
			);
		});
	});
});
