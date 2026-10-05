import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { SlugFontCache } from "../slug/slug-font-cache.js";
import { SlugGeometry } from "../slug/slug-geometry.js";
import {
	computeAnimatorProgress,
	drawParagraphNode,
	evaluateEasing,
} from "./paragraph.js";

// Mock SlugGeometry
vi.mock("../slug/slug-geometry.js", () => {
	return {
		SlugGeometry: {
			measure: vi.fn().mockReturnValue({ width: 100, height: 50 }),
			layout: vi.fn().mockReturnValue({
				glyphs: [
					{
						isSpace: false,
						unitIndex: 0,
						lineIndex: 0,
						wordIndex: 0,
						x: 0,
						y: 10,
						cp: {
							width: 10,
							height: 10,
							advanceWidth: 10,
							bearingX: 0,
							bearingY: 10,
							bandCount: 1,
							bandDimX: 1,
							bandDimY: 1,
							bandsTexCoordX: 0,
							bandsTexCoordY: 0,
						},
					},
				],
				emojis: [
					{
						lineIndex: 0,
						x: 50,
						y: 10,
						char: "😀",
						size: 20,
					},
				],
				linesCount: 1,
			}),
		},
	};
});

// Mock client-utils
vi.mock("@framefields/client-utils", () => {
	return {
		GetFontAssetUrl: vi.fn().mockReturnValue("http://test.com/font.slug"),
	};
});

describe("Paragraph Node", () => {
	beforeAll(() => {
		ensureDOMGlobals();
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
		} as any;

		// Mock isNode headless flags
		(globalThis as any).__IS_HEADLESS_RENDERER__ = true;
	});

	let mockDevice: any;
	let mockPass: any;
	let mockCtx: any;
	let mockFont: any;

	beforeEach(() => {
		vi.clearAllMocks();
		SlugFontCache.destroy();
		mockDevice = createMockDevice();
		mockPass = createMockRenderPassEncoder();

		mockFont = {
			curvesTex: { destroy: vi.fn() } as any,
			bandsTex: { destroy: vi.fn() } as any,
			ascender: 800,
			descender: -200,
			lineGap: 100,
			unitsPerEm: 1000,
			codePoints: new Map(),
		};

		SlugFontCache.registerFont("Inter", mockFont);

		mockCtx = {
			device: mockDevice,
			renderer: {
				getTransformStack: vi.fn().mockReturnValue({
					getCurrent: vi.fn().mockReturnValue(new DOMMatrix()),
				}),
				getSurfaceWidth: vi.fn().mockReturnValue(800),
				getSurfaceHeight: vi.fn().mockReturnValue(600),
				drawRRect: vi.fn(),
				drawTextureRegion: vi.fn(),
				slugPipeline: {
					draw: vi.fn(),
				},
			},
		};
	});

	it("should draw paragraph layout without backgrounds", () => {
		const props = {
			text: "Hello 😀",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
		};

		drawParagraphNode(mockCtx, mockPass, props);

		expect(SlugGeometry.layout).toHaveBeenCalled();
		expect(mockCtx.renderer.slugPipeline.draw).toHaveBeenCalled();
		expect(mockCtx.renderer.drawTextureRegion).toHaveBeenCalled();
	});

	it("should preload font if not cached", () => {
		const props = {
			text: "Preload",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Roboto", // not registered
			fontSize: 32,
		};

		const spy = vi
			.spyOn(SlugFontCache, "preloadSlugFont")
			.mockResolvedValue({} as any);

		drawParagraphNode(mockCtx, mockPass, props);

		expect(spy).toHaveBeenCalled();
	});

	it("should render background rectangle if textBackgroundColor is provided", () => {
		const props = {
			text: "Background",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
			textBackgroundColor: "#ff0000",
		};

		drawParagraphNode(mockCtx, mockPass, props);

		expect(mockCtx.renderer.drawRRect).toHaveBeenCalled();
	});

	it("should apply animations in video mode", () => {
		const props = {
			text: "Animated",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
			isVideoMode: true,
			frame: 5,
			fps: 30,
			durationMs: 1000,
			animation: {
				in: "fade",
				kinetic: "wiggle" as const,
			},
		};

		drawParagraphNode(mockCtx, mockPass, props);

		expect(mockCtx.renderer.slugPipeline.draw).toHaveBeenCalled();
	});

	it("should render shadows if configured", () => {
		const props = {
			text: "Shadowed",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
			shadows: [
				{
					color: "rgba(0,0,0,0.5)",
					blurRadius: 4,
					offset: { x: 2, y: 2 },
				},
			],
		};

		drawParagraphNode(mockCtx, mockPass, props);

		// main text + shadow = 2 draws
		expect(mockCtx.renderer.slugPipeline.draw).toHaveBeenCalledTimes(2);
	});

	it("should render stroke if configured", () => {
		const props = {
			text: "Stroked",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
			stroke: "rgba(255,0,0,1)",
			strokeWidth: 2,
		};

		drawParagraphNode(mockCtx, mockPass, props);

		// main text + stroke = 2 draws
		expect(mockCtx.renderer.slugPipeline.draw).toHaveBeenCalledTimes(2);
	});

	it("evaluates easing curves correctly", () => {
		expect(evaluateEasing("linear", 0.5)).toBeCloseTo(0.5);
		expect(evaluateEasing("power2.out", 0)).toBe(0);
		expect(evaluateEasing("power2.out", 1)).toBe(1);
		expect(evaluateEasing("power2.out", 0.5)).toBeCloseTo(0.875);
		expect(evaluateEasing("sine.inOut", 0.5)).toBeCloseTo(0.5);
		expect(evaluateEasing(undefined, 0.42)).toBe(0.42);
	});

	it("computes animator progress with normalized range selectors and offsets", () => {
		const animator = {
			id: "a1",
			unit: "character" as const,
			rangeStart: 0.2,
			rangeEnd: 0.8,
			offset: 0,
			easing: "linear",
		};

		// Before rangeStart
		expect(computeAnimatorProgress(animator, 0, 10)).toBe(0);
		// After rangeEnd
		expect(computeAnimatorProgress(animator, 9, 10)).toBe(1);

		// With offset
		const offsetAnimator = { ...animator, offset: 0.2 };
		// rangeStart becomes 0.4, rangeEnd becomes 1.0
		expect(computeAnimatorProgress(offsetAnimator, 0, 10)).toBe(0);
	});

	it("renders kinetic typography animators with per-glyph transforms", () => {
		const props = {
			text: "Kinetic",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
			animators: [
				{
					id: "lift-rotate",
					unit: "character" as const,
					rangeStart: 0,
					rangeEnd: 1,
					offset: 0,
					easing: "linear",
					transform: {
						x: 10,
						y: -25,
						rotation: 45,
						scale: 1.5,
						scaleX: 1.2,
						scaleY: 0.8,
						rotationX: 60,
						opacity: 0.5,
						blur: 8,
					},
				},
			],
		};

		drawParagraphNode(mockCtx, mockPass, props);

		expect(mockCtx.renderer.slugPipeline.draw).toHaveBeenCalled();
		const callArgs = mockCtx.renderer.slugPipeline.draw.mock.calls[0];
		const instanceData = callArgs[3] as Float32Array;
		const visibleCount = callArgs[4] as number;
		expect(visibleCount).toBeGreaterThan(0);

		// Verify that instance data includes the kinetic overrides:
		// offset + 12 = rot, + 13 = scale, + 14 = transX, + 15 = transY, + 20 = blurAmount
		const rot = instanceData[12];
		const scale = instanceData[13];
		const transX = instanceData[14];
		const transY = instanceData[15];
		const blur = instanceData[20];

		expect(transX).toBeGreaterThan(0);
		expect(transY).toBeLessThan(0);
		expect(rot).toBeGreaterThan(0);
		expect(scale).toBeGreaterThan(1.0);
		expect(blur).toBeGreaterThan(0);
	});

	it("renders kinetic typography animators with per-glyph color blending", () => {
		const props = {
			text: "Colored",
			dstRect: { x: 0, y: 0, width: 200, height: 100 },
			fontFamily: "Inter",
			fontSize: 32,
			color: "#000000",
			animators: [
				{
					id: "tint-red",
					unit: "character" as const,
					rangeStart: 0,
					rangeEnd: 1,
					offset: 0,
					easing: "linear",
					transform: {
						color: "#ff0000",
					},
				},
			],
		};

		drawParagraphNode(mockCtx, mockPass, props);

		expect(mockCtx.renderer.slugPipeline.draw).toHaveBeenCalled();
		const callArgs = mockCtx.renderer.slugPipeline.draw.mock.calls[0];
		const instanceData = callArgs[3] as Float32Array;

		// offset + 16 = col.r, 17 = col.g, 18 = col.b, 19 = col.a
		const r = instanceData[16];
		const g = instanceData[17];
		const b = instanceData[18];

		// Base was black (#000000), target was red (#ff0000), with p=0.5 -> r=0.5, g=0, b=0
		expect(r).toBeGreaterThan(0);
		expect(g).toBe(0);
		expect(b).toBe(0);
	});
});
