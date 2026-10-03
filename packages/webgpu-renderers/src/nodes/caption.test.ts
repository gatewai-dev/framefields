import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { SlugFontCache } from "../slug/slug-font-cache.js";
import { drawCaptionNode, parseSrt, srtLoader } from "./caption.js";
import { drawParagraphNode } from "./paragraph.js";

// Mock paragraph
vi.mock("./paragraph.js", () => {
	return {
		drawParagraphNode: vi.fn(),
	};
});

// Mock SlugGeometry
vi.mock("../slug/slug-geometry.js", () => {
	return {
		SlugGeometry: {
			measure: vi.fn().mockReturnValue({ width: 100, height: 50 }),
		},
	};
});

// Mock client-utils
vi.mock("@gitframes/client-utils", () => {
	return {
		GetFontAssetUrl: vi.fn().mockReturnValue("http://test.com/font.slug"),
	};
});

const mockSrtContent = `1
00:00:01,000 --> 00:00:03,000
Hello World

2
00:00:04,500 --> 00:00:06,000
Second subtitle line.
`;

describe("Caption Node", () => {
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
	let mockFont: any;

	beforeEach(() => {
		vi.clearAllMocks();
		SlugFontCache.destroy();
		(srtLoader as any).cache.clear();

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
				drawRRect: vi.fn(),
			},
		};

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue(mockSrtContent),
			}),
		);
	});

	describe("parseSrt", () => {
		it("should parse standard SRT formatted string successfully", () => {
			const { captions } = parseSrt(mockSrtContent);
			expect(captions).toHaveLength(2);
			expect(captions[0].text).toBe("Hello World");
			expect(captions[0].startMs).toBe(1000);
			expect(captions[0].endMs).toBe(3000);
			expect(captions[1].text).toBe("Second subtitle line.");
			expect(captions[1].startMs).toBe(4500);
			expect(captions[1].endMs).toBe(6000);
		});
	});

	describe("srtLoader", () => {
		it("should fetch, parse and cache srt", async () => {
			const captions = await srtLoader.load("test.srt");
			expect(globalThis.fetch).toHaveBeenCalledWith("test.srt");
			expect(captions).toHaveLength(2);

			await srtLoader.load("test.srt");
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("drawCaptionNode", () => {
		it("should determine target caption by timeline and call drawParagraphNode", async () => {
			const props = {
				text: "",
				src: "test.srt",
				frame: 60, // 60 frames at 30 fps = 2.0 sec -> inside Hello World
				fps: 30,
				dstRect: { x: 0, y: 0, width: 800, height: 600 },
				fontFamily: "Inter",
			};

			await drawCaptionNode(mockCtx, mockPass, props);

			expect(drawParagraphNode).toHaveBeenCalledWith(
				mockCtx,
				mockPass,
				expect.objectContaining({
					text: "Hello World",
					isCaption: true,
				}),
			);
		});

		it("should render full caption text without animation", async () => {
			const props = {
				text: "",
				src: "test.srt",
				frame: 60, // 2000ms elapsed. Hello World starts at 1000ms, ends at 3000ms.
				fps: 30,
				dstRect: { x: 0, y: 0, width: 800, height: 600 },
				fontFamily: "Inter",
				isVideoMode: true,
			};

			await drawCaptionNode(mockCtx, mockPass, props);

			expect(drawParagraphNode).toHaveBeenCalledWith(
				mockCtx,
				mockPass,
				expect.objectContaining({
					text: "Hello World",
					isCaption: true,
					animation: undefined,
				}),
			);
		});
	});
});
