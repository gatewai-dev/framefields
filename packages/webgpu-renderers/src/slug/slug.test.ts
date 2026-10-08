import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { TransformStack } from "../renderer2d/transform-stack.js";
import { SlugFontCache } from "./slug-font-cache.js";
import { SlugGenerator } from "./slug-generator.js";
import { SlugGeometry } from "./slug-geometry.js";
import { SlugLoader } from "./slug-loader.js";
import { SlugPipeline } from "./slug-pipeline.js";

beforeAll(() => {
	ensureDOMGlobals();
	if (typeof globalThis.GPUBufferUsage === "undefined") {
		globalThis.GPUBufferUsage = {
			UNIFORM: 1,
			VERTEX: 2,
			COPY_DST: 4,
		} as any;
	}
	if (typeof globalThis.GPUShaderStage === "undefined") {
		globalThis.GPUShaderStage = {
			VERTEX: 1,
			FRAGMENT: 2,
		} as any;
	}
	if (typeof globalThis.GPUTextureUsage === "undefined") {
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
			COPY_SRC: 8,
		} as any;
	}
});

const mockFont: any = {
	unitsPerEm: 1000,
	ascender: 800,
	descender: -200,
	codePoints: new Map([
		[
			65,
			{
				advanceWidth: 600,
				width: 500,
				height: 700,
				bearingX: 50,
				bearingY: 700,
				bandDimX: 8,
				bandDimY: 8,
				bandCount: 16,
				bandsTexCoordX: 0,
				bandsTexCoordY: 0,
			},
		], // 'A'
		[
			-1,
			{
				advanceWidth: 500,
				width: 400,
				height: 600,
				bearingX: 50,
				bearingY: 600,
				bandDimX: 8,
				bandDimY: 8,
				bandCount: 16,
				bandsTexCoordX: 0,
				bandsTexCoordY: 0,
			},
		], // Fallback
	]),
};

describe("SlugGeometry Layout", () => {
	it("should calculate standard layout coordinates and total bounds", () => {
		const result = SlugGeometry.layout(
			"AAA",
			mockFont,
			10, // fontSize
			0, // letterSpacing
			12, // lineHeight
			100, // maxWidth
			"left",
			"word",
		);

		expect(result.glyphs.length).toBe(3);
		expect(result.emojis.length).toBe(0);
		expect(result.linesCount).toBe(1);
		expect(result.totalHeight).toBe(10); // ascender - descender = 1000 units * fontScale = 10px

		// Char 'A' is 600 units wide = 6px. Three 'A's = 18px.
		expect(result.glyphs[0].x).toBe(0);
		expect(result.glyphs[1].x).toBe(6);
		expect(result.glyphs[2].x).toBe(12);
	});

	it("should wrap text correctly when exceeding maxWidth", () => {
		const result = SlugGeometry.layout(
			"A A A",
			mockFont,
			10, // fontSize
			0, // letterSpacing
			12, // lineHeight
			10, // maxWidth: only holds one A plus space (6px + 5px = 11px, wait, 10px max width so wraps)
			"left",
			"word",
		);

		// A wraps to next lines
		expect(result.linesCount).toBeGreaterThan(1);
	});

	it("should separate emojis from normal glyph outlines", () => {
		const result = SlugGeometry.layout(
			"A😊A",
			mockFont,
			10,
			0,
			12,
			100,
			"left",
			"word",
		);

		// Glyphs: A, A
		expect(result.glyphs.length).toBe(2);
		expect(result.glyphs[0].char).toBe("A");
		expect(result.glyphs[1].char).toBe("A");

		// Emojis: 😊
		expect(result.emojis.length).toBe(1);
		expect(result.emojis[0].char).toBe("😊");
		expect(result.emojis[0].size).toBe(10);
	});

	it("should measure text size correctly including emojis", () => {
		const result = SlugGeometry.measure(
			"A😊A",
			mockFont,
			10, // fontSize
			0, // letterSpacing
			12, // lineHeight
			100, // maxWidth
		);

		// 'A' = 6px. Emoji = 10px. 'A' = 6px. Total = 22px.
		expect(result.width).toBe(22);
	});

	it("should map animation units based on applyBy settings", () => {
		const text = "A A A";
		// applyBy = char
		const charResult = SlugGeometry.layout(
			text,
			mockFont,
			10,
			0,
			12,
			100,
			"left",
			"char",
		);
		expect(charResult.glyphs[0].unitIndex).toBe(0);
		expect(charResult.glyphs[1].unitIndex).toBe(1); // Space
		expect(charResult.glyphs[2].unitIndex).toBe(2);

		// applyBy = word
		const wordResult = SlugGeometry.layout(
			text,
			mockFont,
			10,
			0,
			12,
			100,
			"left",
			"word",
		);
		expect(wordResult.glyphs[0].unitIndex).toBe(0); // Word 0 ("A")
		expect(wordResult.glyphs[1].unitIndex).toBe(1); // Space (" ")
		expect(wordResult.glyphs[2].unitIndex).toBe(1); // Word 1 ("A")

		// applyBy = line
		const lineResult = SlugGeometry.layout(
			"A\nA",
			mockFont,
			10,
			0,
			12,
			100,
			"left",
			"line",
		);
		expect(lineResult.glyphs[0].unitIndex).toBe(0); // Line 0
		expect(lineResult.glyphs[1].unitIndex).toBe(1); // Line 1
	});

	it("should align text to center and right correctly", () => {
		const text = "AAA";
		// center
		const centerResult = SlugGeometry.layout(
			text,
			mockFont,
			10,
			0,
			12,
			100,
			"center",
			"word",
		);
		// Char 'A' is 6px wide. 3 'A's = 18px wide. center offset is (100 - 18) / 2 = 41px.
		expect(centerResult.glyphs[0].x).toBe(41);
		expect(centerResult.glyphs[1].x).toBe(47);
		expect(centerResult.glyphs[2].x).toBe(53);

		// right
		const rightResult = SlugGeometry.layout(
			text,
			mockFont,
			10,
			0,
			12,
			100,
			"right",
			"word",
		);
		// right offset is 100 - 18 = 82px.
		expect(rightResult.glyphs[0].x).toBe(82);
		expect(rightResult.glyphs[1].x).toBe(88);
		expect(rightResult.glyphs[2].x).toBe(94);
	});
});

describe("SlugFontCache", () => {
	it("should register and retrieve slug fonts", () => {
		const dummyFont = { family: "Dummy", unitsPerEm: 1000 } as any;
		SlugFontCache.registerFont("Dummy", dummyFont);
		expect(SlugFontCache.getFont("Dummy")).toBe(dummyFont);
	});

	it("should handle listeners, registerFont, getFont, and destroy correctly", () => {
		const mockCurvesTex = { destroy: vi.fn() } as any;
		const mockBandsTex = { destroy: vi.fn() } as any;
		const mockEmojiTex = { destroy: vi.fn() } as any;

		const mockFont: any = {
			family: "Test",
			curvesTex: mockCurvesTex,
			bandsTex: mockBandsTex,
		};

		// Test listener
		const listener = vi.fn();
		const unsubscribe = SlugFontCache.addListener(listener);

		// We can test that register/cache work
		SlugFontCache.registerFont("TestFont", mockFont);
		expect(SlugFontCache.getFont("TestFont")).toBe(mockFont);

		// Add dummy emoji texture cache entry
		SlugFontCache.emojiTextureCache.set("smiley-12", mockEmojiTex);

		// Call destroy
		SlugFontCache.destroy();

		// Verify textures destroyed
		expect(mockCurvesTex.destroy).toHaveBeenCalledTimes(1);
		expect(mockBandsTex.destroy).toHaveBeenCalledTimes(1);
		expect(mockEmojiTex.destroy).toHaveBeenCalledTimes(1);

		// Caches should be empty
		expect(SlugFontCache.getFont("TestFont")).toBeUndefined();
		expect(SlugFontCache.emojiTextureCache.size).toBe(0);

		// Test listener unsubscribing
		unsubscribe();
	});
});

describe("SlugGenerator sorting", () => {
	it("should correctly generate textures and sort band curves", () => {
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
		} as any;

		const mockGlyph: any = {
			codePoints: [65], // 'A'
			bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
			path: {
				commands: [
					{ type: "moveTo", x: 10, y: 10 },
					{ type: "lineTo", x: 10, y: 50 }, // Line 1: Y max is 50
					{ type: "moveTo", x: 20, y: 20 },
					{ type: "lineTo", x: 20, y: 90 }, // Line 2: Y max is 90
				],
			},
		};
		const font: any = {
			numGlyphs: 1,
			getGlyph: () => mockGlyph,
			glyphForCodePoint: () => mockGlyph,
			characterSet: [65],
			ascent: 100,
			descent: 0,
			lineGap: 0,
			unitsPerEm: 100,
		};

		const mockDevice: any = {
			createTexture: () => ({}),
			queue: {
				writeTexture: () => {},
			},
		};

		const generator = new SlugGenerator({ bandCount: 4, fullRange: true });
		const output = generator.generate(mockDevice, font);
		expect(output).toBeDefined();
		expect(output.ascender).toBe(100);
	});

	it("should handle fonts that only have glyphForCodePoint without getGlyph", () => {
		const mockGlyph: any = {
			codePoints: [65],
			bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
			path: {
				commands: [
					{ type: "moveTo", x: 10, y: 10 },
					{ type: "lineTo", x: 10, y: 50 },
				],
			},
		};
		const fontWithoutGetGlyph: any = {
			numGlyphs: 1,
			glyphForCodePoint: () => mockGlyph,
			characterSet: [65],
			ascent: 100,
			descent: 0,
			lineGap: 0,
			unitsPerEm: 100,
		};

		const mockDevice: any = {
			createTexture: () => ({}),
			queue: {
				writeTexture: () => {},
			},
		};

		const generator = new SlugGenerator({ bandCount: 4, fullRange: true });
		const output = generator.generate(mockDevice, fontWithoutGetGlyph);
		expect(output).toBeDefined();
		expect(output.ascender).toBe(100);
	});
});

describe("SlugLoader", () => {
	it("should parse exported sluggish binary data correctly", () => {
		const mockDevice = createMockDevice();

		const mockGlyph: any = {
			codePoints: [65], // 'A'
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
			path: {
				commands: [
					{ type: "moveTo", x: 0, y: 0 },
					{ type: "lineTo", x: 0, y: 10 },
					{ type: "lineTo", x: 10, y: 10 },
					{ type: "closePath" },
				],
			},
			advanceWidth: 10,
		};

		const font: any = {
			numGlyphs: 1,
			getGlyph: () => mockGlyph,
			glyphForCodePoint: () => mockGlyph,
			characterSet: [65],
			ascent: 10,
			descent: 0,
			lineGap: 0,
			unitsPerEm: 10,
		};

		const generator = new SlugGenerator({ bandCount: 4, fullRange: true });
		const generated = generator.generate(null, font);

		const buffer = generator.exportSluggish(generated);
		expect(buffer).toBeDefined();

		const parsedFont = SlugLoader.parse(mockDevice, buffer);
		expect(parsedFont).toBeDefined();
		expect(parsedFont.ascender).toBe(10);
		expect(parsedFont.descender).toBe(0);
		expect(parsedFont.unitsPerEm).toBe(10);
		expect(parsedFont.codePoints.has(65)).toBe(true);

		const cp = parsedFont.codePoints.get(65)!;
		expect(cp.width).toBe(10);
		expect(cp.height).toBe(10);
		expect(cp.advanceWidth).toBe(10);
	});

	it("should throw on invalid header", () => {
		const mockDevice = createMockDevice();
		const invalidBuffer = new ArrayBuffer(20);
		const view = new DataView(invalidBuffer);
		const badHeader = "NOTSLUGG";
		for (let i = 0; i < 8; i++) {
			view.setUint8(i, badHeader.charCodeAt(i));
		}
		expect(() => SlugLoader.parse(mockDevice, invalidBuffer)).toThrow(
			"Invalid header found",
		);
	});

	it("should throw on invalid curves or bands texture dimensions", () => {
		const mockDevice = createMockDevice();
		const buffer = new ArrayBuffer(100);
		const view = new DataView(buffer);

		const header = "SLUGGISH";
		for (let i = 0; i < 8; i++) {
			view.setUint8(i, header.charCodeAt(i));
		}

		view.setUint16(8, 0, true); // codePointCount = 0
		view.setUint16(10, 0, true); // curvesTexWidth = 0

		expect(() => SlugLoader.parse(mockDevice, buffer)).toThrow(
			"Invalid curves texture dimensions",
		);
	});
});

describe("SlugPipeline", () => {
	it("should initialize pipeline, bind group layouts, and shader module in constructor", () => {
		const mockDevice = createMockDevice();
		const pipeline = new SlugPipeline(mockDevice, "rgba8unorm");

		expect(mockDevice.createShaderModule).toHaveBeenCalledTimes(1);
		expect(mockDevice.createBindGroupLayout).toHaveBeenCalledTimes(2);
		expect(mockDevice.createRenderPipeline).toHaveBeenCalledTimes(1);
		expect(pipeline).toBeDefined();
	});

	it("should draw correctly and pack transform stack info", () => {
		const mockDevice = createMockDevice();
		const pipeline = new SlugPipeline(mockDevice, "rgba8unorm");

		const mockPass = createMockRenderPassEncoder();
		const transformStack = new TransformStack();

		const font: any = {
			curvesTex: { createView: vi.fn(() => ({})) },
			bandsTex: { createView: vi.fn(() => ({})) },
		};

		const instanceData = new Float32Array(96);
		const instanceCount = 1;

		pipeline.draw(
			mockPass,
			transformStack,
			font,
			instanceData,
			instanceCount,
			"red",
			800,
			600,
		);

		expect(mockPass.setPipeline).toHaveBeenCalledTimes(1);
		expect(mockPass.setBindGroup).toHaveBeenCalledTimes(2);
		expect(mockPass.setVertexBuffer).toHaveBeenCalledTimes(1);
		expect(mockPass.draw).toHaveBeenCalledWith(6, 1);
	});

	it("should do nothing in draw when instanceCount is 0", () => {
		const mockDevice = createMockDevice();
		const pipeline = new SlugPipeline(mockDevice, "rgba8unorm");

		const mockPass = createMockRenderPassEncoder();
		const transformStack = new TransformStack();

		const font: any = {
			curvesTex: { createView: vi.fn() },
			bandsTex: { createView: vi.fn() },
		};

		pipeline.draw(
			mockPass,
			transformStack,
			font,
			new Float32Array(0),
			0,
			"red",
			800,
			600,
		);

		expect(mockPass.setPipeline).not.toHaveBeenCalled();
	});

	it("should reset pools and destroy pools", () => {
		const mockDevice = createMockDevice();
		const pipeline = new SlugPipeline(mockDevice, "rgba8unorm");

		// Initialize pools with some buffers
		const font: any = {
			curvesTex: { createView: vi.fn(() => ({})) },
			bandsTex: { createView: vi.fn(() => ({})) },
		};
		const mockPass = createMockRenderPassEncoder();
		const transformStack = new TransformStack();
		pipeline.draw(
			mockPass,
			transformStack,
			font,
			new Float32Array(96),
			1,
			"red",
			800,
			600,
		);

		// resetPools
		expect(() => pipeline.resetPools()).not.toThrow();

		// destroy
		expect(() => pipeline.destroy()).not.toThrow();
	});
});

describe("SlugGenerator Stroke Processing with complex geometries", () => {
	it("should process glyph paths with duplicate, collinear, and sharp 180-degree points without crashing", () => {
		const mockGlyph: any = {
			codePoints: [65],
			bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
			path: {
				commands: [
					// Duplicate points, collinear points, and a sharp 180-degree turn
					{ type: "moveTo", x: 0, y: 0 },
					{ type: "lineTo", x: 0, y: 0 }, // Duplicate
					{ type: "lineTo", x: 5, y: 0 }, // Collinear (0,0 -> 5,0 -> 10,0)
					{ type: "lineTo", x: 10, y: 0 },
					{ type: "lineTo", x: 10, y: 0.0001 }, // Extremely close
					{ type: "lineTo", x: 10, y: 10 },
					{ type: "lineTo", x: 0, y: 10 },
					{ type: "lineTo", x: 0, y: 5 },
					{ type: "lineTo", x: 0, y: 5 }, // Duplicate
					{ type: "lineTo", x: 0, y: 0 }, // 180-degree sharp turn
					{ type: "closePath" },
				],
			},
			advanceWidth: 10,
		};

		const font: any = {
			numGlyphs: 1,
			getGlyph: () => mockGlyph,
			glyphForCodePoint: () => mockGlyph,
			characterSet: [65],
			ascent: 10,
			descent: 0,
			lineGap: 0,
			unitsPerEm: 10,
		};

		const generator = new SlugGenerator({
			bandCount: 4,
			fullRange: true,
			strokeWidth: 2,
		});
		const generated = generator.generate(null, font);
		expect(generated).toBeDefined();
		expect(generated.codePoints.has(65)).toBe(true);
	});
});

describe("SlugGeometry text alignment", () => {
	it("should align text to the right boundary for right and end align", () => {
		const layoutRight = SlugGeometry.layout(
			"A",
			mockFont,
			100, // fontScale = 100 / 1000 = 0.1, advanceWidth = 600 * 0.1 = 60px
			0,
			120,
			500, // maxWidth = 500
			"right" as any,
		);
		// Glyph advance is 60px. For right align with maxWidth 500, glyph should start at 500 - 60 = 440px.
		expect(layoutRight.glyphs[0].x).toBe(440);

		const layoutEnd = SlugGeometry.layout(
			"A",
			mockFont,
			100,
			0,
			120,
			500,
			"end" as any,
		);
		expect(layoutEnd.glyphs[0].x).toBe(440);

		const layoutCenter = SlugGeometry.layout(
			"A",
			mockFont,
			100,
			0,
			120,
			500,
			"center",
		);
		// (500 - 60) / 2 = 220px.
		expect(layoutCenter.glyphs[0].x).toBe(220);
	});
});

describe("SlugGeometry text on a path", () => {
	// A straight 100 px path along y = 0: positions along it are x coordinates.
	const line = { type: "svg" as const, d: "M 0 0 L 100 0" };
	const layoutOn = (text: string, options: Record<string, unknown>) =>
		SlugGeometry.layout(
			text,
			mockFont,
			10,
			0,
			12,
			1000,
			"left",
			"char",
			undefined,
			{
				path: line,
				...options,
			} as never,
		);

	it("insets the last margin from the end of the path", () => {
		// 'A' advances 6 px; force-aligned between 10 and 100 - 20 = 80.
		const result = layoutOn("AAAA", {
			firstMargin: 10,
			lastMargin: 20,
			forceAlignment: true,
		});
		const xs = result.glyphs.map((g) => g.x);
		expect(xs[0]).toBeCloseTo(10);
		// The last glyph's own width (6 px) ends on the end margin.
		expect(xs[3]).toBeCloseTo(80 - 6);
		expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]);
	});

	it("keeps spaces when force-aligning, spreading the extra across every gap", () => {
		// "A A": the fallback glyph (5 px) stands in for the space.
		const result = layoutOn("A A", { forceAlignment: true });
		const xs = result.glyphs.filter((g) => !g.isSpace).map((g) => g.x);
		expect(xs[0]).toBeCloseTo(0);
		expect(xs[1]).toBeCloseTo(100 - 6);
	});

	it("starts at the first margin without force alignment", () => {
		const result = layoutOn("AA", { firstMargin: 30, lastMargin: 10 });
		expect(result.glyphs[0].x).toBeCloseTo(30);
		expect(result.glyphs[1].x).toBeCloseTo(36);
	});
});
