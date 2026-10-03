import { beforeEach, describe, expect, it, vi } from "vitest";

// 1. Setup Hoisted Mocks
const { mockSharpMetadata } = vi.hoisted(() => {
	return {
		mockSharpMetadata: vi.fn(),
	};
});

// 2. Mock Modules
vi.mock("@gitframes/server-utils", () => ({
	container: {
		get: vi.fn(),
		isBound: vi.fn(() => true),
	},
	TOKENS: {
		STORAGE: Symbol.for("STORAGE"),
		MEDIA: Symbol.for("MEDIA"),
	},
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock("@gitframes/core", () => ({
	extractSvgDimensions: vi.fn(() => ({ w: 100, h: 100 })),
	generateId: vi.fn(() => "test-id"),
}));

vi.mock("sharp", () => ({
	default: vi.fn().mockImplementation(() => ({
		metadata: mockSharpMetadata,
	})),
}));

vi.mock("./utils/index.js", () => ({
	fixWebmMetadata: vi.fn(async (buf: Buffer) => buf),
	getMediaDuration: vi.fn(async () => 10),
	getVideoMetadata: vi.fn(async () => ({
		width: 1920,
		height: 1080,
		duration: 10,
		fps: 30,
	})),
	calculateFallbackMetadata: vi.fn(async () => ({ duration: 5, fps: 24 })),
	getAudioDetails: vi.fn(async () => ({
		sampleRate: 44100,
		channels: 2,
		bitDepth: 16,
		audioCodec: "aac",
		audioBitrate: 128000,
	})),
}));

import { extractSvgDimensions } from "@gitframes/core";
import { container } from "@gitframes/server-utils";
import { zipSync } from "fflate";
import {
	extractCaptionDuration,
	extractMediaMetadata,
	isLottieJson,
	processAndValidateLottie,
	resolveDataType,
} from "./import-utils.js";
import {
	calculateFallbackMetadata,
	getMediaDuration,
	getVideoMetadata,
} from "./utils/index.js";

describe("import-utils", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSharpMetadata.mockResolvedValue({
			width: 600,
			height: 400,
			delay: [100, 100, 100],
			pages: 3,
		});
	});

	describe("extractCaptionDuration", () => {
		it("should extract duration from valid SRT buffer", () => {
			const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:10,500
Goodbye world
`;
			const buffer = Buffer.from(srt);
			expect(extractCaptionDuration(buffer)).toBe(10.5);
		});

		it("should return null if no timestamps found", () => {
			const buffer = Buffer.from("just some text");
			expect(extractCaptionDuration(buffer)).toBeNull();
		});

		it("should return null on error", () => {
			const buffer = {
				toString: () => {
					throw new Error("fail");
				},
			} as unknown as Buffer;
			expect(extractCaptionDuration(buffer)).toBeNull();
		});
	});

	describe("resolveDataType", () => {
		it("should resolve SVG", async () => {
			expect(await resolveDataType("image/svg+xml", "test.svg")).toBe("SVG");
		});

		it("should resolve Image", async () => {
			expect(await resolveDataType("image/png", "test.png")).toBe("Image");
		});

		it("should resolve Video", async () => {
			expect(await resolveDataType("video/mp4", "test.mp4")).toBe("Video");
		});

		it("should resolve Audio", async () => {
			expect(await resolveDataType("audio/mpeg", "test.mp3")).toBe("Audio");
		});

		it("should resolve Caption from extension", async () => {
			expect(
				await resolveDataType("application/octet-stream", "test.srt"),
			).toBe("Caption");
		});

		it("should resolve Caption from mime type", async () => {
			expect(await resolveDataType("text/srt", "test.txt")).toBe("Caption");
		});

		it("should throw for unsupported types", async () => {
			await expect(
				resolveDataType("application/pdf", "test.pdf"),
			).rejects.toThrow();
		});

		it("should resolve animated WebP as GIF", async () => {
			mockSharpMetadata.mockResolvedValueOnce({
				pages: 3,
			});
			const res = await resolveDataType(
				"image/webp",
				"test.webp",
				Buffer.from("test"),
			);
			expect(res).toBe("GIF");
		});

		it("should resolve static WebP as Image", async () => {
			mockSharpMetadata.mockResolvedValueOnce({
				pages: 1,
			});
			const res = await resolveDataType(
				"image/webp",
				"test.webp",
				Buffer.from("test"),
			);
			expect(res).toBe("Image");
		});

		it("should resolve WebP as Image if buffer is missing", async () => {
			const res = await resolveDataType("image/webp", "test.webp");
			expect(res).toBe("Image");
		});
	});

	describe("extractMediaMetadata", () => {
		it("should extract image dimensions", async () => {
			const mockMediaService = {
				getImageDimensions: vi
					.fn()
					.mockResolvedValue({ width: 500, height: 500 }),
			};
			vi.mocked(container.get).mockReturnValue(mockMediaService);

			const result = await extractMediaMetadata(
				Buffer.from(""),
				"image/png",
				"Image",
			);
			expect(result).toEqual({
				width: 500,
				height: 500,
				durationInSec: null,
				fps: null,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});

		it("should throw if image dimensions extraction fails", async () => {
			const mockMediaService = {
				getImageDimensions: vi.fn().mockResolvedValue({}),
			};
			vi.mocked(container.get).mockReturnValue(mockMediaService);

			await expect(
				extractMediaMetadata(Buffer.from(""), "image/png", "Image"),
			).rejects.toThrow("Failed to extract image dimensions");
		});

		it("should extract video metadata", async () => {
			const result = await extractMediaMetadata(
				Buffer.from(""),
				"video/mp4",
				"Video",
			);
			expect(result).toEqual({
				width: 1920,
				height: 1080,
				durationInSec: 10,
				fps: 30,
				sampleRate: 44100,
				channels: 2,
				bitDepth: 16,
				audioCodec: "aac",
				audioBitrate: 128000,
			});
		});

		it("should use fallback for video metadata if duration or fps is 0", async () => {
			vi.mocked(getVideoMetadata).mockResolvedValueOnce({
				width: 1920,
				height: 1080,
				duration: 0,
				fps: 0,
			});

			const result = await extractMediaMetadata(
				Buffer.from(""),
				"video/mp4",
				"Video",
			);
			expect(result.durationInSec).toBe(5);
			expect(result.fps).toBe(24);
		});

		it("should throw if video metadata is incomplete after fallback", async () => {
			vi.mocked(getVideoMetadata).mockResolvedValueOnce({
				width: 1920,
				height: 1080,
				duration: 0,
				fps: 0,
			});
			vi.mocked(calculateFallbackMetadata).mockResolvedValueOnce({
				duration: 0,
				fps: 0,
			});

			await expect(
				extractMediaMetadata(Buffer.from(""), "video/mp4", "Video"),
			).rejects.toThrow("Incomplete video metadata");
		});

		it("should extract audio duration", async () => {
			const result = await extractMediaMetadata(
				Buffer.from(""),
				"audio/mpeg",
				"Audio",
			);
			expect(result).toEqual({
				width: null,
				height: null,
				durationInSec: 10,
				fps: null,
				sampleRate: 44100,
				channels: 2,
				bitDepth: 16,
				audioCodec: "aac",
				audioBitrate: 128000,
			});
		});

		it("should use fallback for audio duration", async () => {
			vi.mocked(getMediaDuration).mockResolvedValueOnce(0);
			const result = await extractMediaMetadata(
				Buffer.from(""),
				"audio/mpeg",
				"Audio",
			);
			expect(result.durationInSec).toBe(5);
		});

		it("should throw if audio duration extraction fails", async () => {
			vi.mocked(getMediaDuration).mockResolvedValueOnce(0);
			vi.mocked(calculateFallbackMetadata).mockResolvedValueOnce({
				duration: 0,
				fps: 0,
			});

			await expect(
				extractMediaMetadata(Buffer.from(""), "audio/mpeg", "Audio"),
			).rejects.toThrow("Failed to extract audio duration");
		});

		it("should extract caption duration", async () => {
			const srt = `1\n00:00:01,000 --> 00:00:04,000\nHello`;
			const result = await extractMediaMetadata(
				Buffer.from(srt),
				"text/srt",
				"Caption",
			);
			expect(result.durationInSec).toBe(4);
		});

		it("should extract SVG dimensions", async () => {
			const result = await extractMediaMetadata(
				Buffer.from("<svg></svg>"),
				"image/svg+xml",
				"SVG",
			);
			expect(result.width).toBe(100);
			expect(result.height).toBe(100);
		});

		it("should use default SVG dimensions if extraction returns 0", async () => {
			vi.mocked(extractSvgDimensions).mockReturnValueOnce({ w: 0, h: 0 });
			const result = await extractMediaMetadata(
				Buffer.from("<svg></svg>"),
				"image/svg+xml",
				"SVG",
			);
			expect(result.width).toBe(1080);
			expect(result.height).toBe(1080);
		});

		it("should use default SVG dimensions if extraction throws", async () => {
			vi.mocked(extractSvgDimensions).mockImplementationOnce(() => {
				throw new Error("fail");
			});
			const result = await extractMediaMetadata(
				Buffer.from("<svg></svg>"),
				"image/svg+xml",
				"SVG",
			);
			expect(result.width).toBe(1080);
			expect(result.height).toBe(1080);
		});
	});

	describe("isLottieJson", () => {
		it("should return true if object has layers array", () => {
			expect(isLottieJson({ layers: [] })).toBe(true);
		});

		it("should return false if missing layers array", () => {
			expect(isLottieJson({ v: "5.5.0" })).toBe(false);
			expect(isLottieJson(null)).toBe(false);
			expect(isLottieJson([])).toBe(false);
		});
	});

	describe("processAndValidateLottie", () => {
		it("should pass valid JSON Lottie through", () => {
			const validLottie = { layers: [], v: "5.5.0" };
			const buf = Buffer.from(JSON.stringify(validLottie));
			const res = processAndValidateLottie(
				buf,
				"anim.json",
				"application/json",
			);
			expect(res.filename).toBe("anim.json");
			expect(res.contentType).toBe("application/json");
			expect(JSON.parse(res.buffer.toString("utf-8"))).toEqual(validLottie);
		});

		it("should throw error for invalid JSON", () => {
			const buf = Buffer.from("{invalid");
			expect(() =>
				processAndValidateLottie(buf, "anim.json", "application/json"),
			).toThrow();
		});

		it("should throw error for non-Lottie JSON", () => {
			const buf = Buffer.from(JSON.stringify({ someKey: "value" }));
			expect(() =>
				processAndValidateLottie(buf, "anim.json", "application/json"),
			).toThrow();
		});

		it("should extract valid Lottie JSON from a .lottie zip archive with manifest", () => {
			const animation = {
				v: "5.5.0",
				layers: [],
				w: 500,
				h: 500,
				fr: 30,
				ip: 0,
				op: 90,
			};
			const manifest = {
				animations: [
					{
						id: "anim",
						file: "a/anim.json",
					},
				],
				initial: "anim",
			};
			const zipData = {
				"manifest.json": Buffer.from(JSON.stringify(manifest)),
				"a/anim.json": Buffer.from(JSON.stringify(animation)),
			};
			const zipBuffer = Buffer.from(zipSync(zipData));
			const result = processAndValidateLottie(
				zipBuffer,
				"test.lottie",
				"application/zip",
			);
			expect(result.filename).toBe("test.json");
			expect(result.contentType).toBe("application/json");
			const parsed = JSON.parse(result.buffer.toString("utf-8"));
			expect(parsed.v).toBe("5.5.0");
		});

		it("should extract valid Lottie JSON from a .lottie zip archive without manifest", () => {
			const animation = {
				v: "5.5.0",
				layers: [],
				w: 500,
				h: 500,
				fr: 30,
				ip: 0,
				op: 90,
			};
			const zipData = {
				"random_filename.json": Buffer.from(JSON.stringify(animation)),
			};
			const zipBuffer = Buffer.from(zipSync(zipData));
			const result = processAndValidateLottie(
				zipBuffer,
				"test.lottie",
				"application/zip",
			);
			expect(result.filename).toBe("test.json");
			expect(result.contentType).toBe("application/json");
			const parsed = JSON.parse(result.buffer.toString("utf-8"));
			expect(parsed.v).toBe("5.5.0");
		});

		it("should extract valid Lottie JSON from a .lottie zip archive with standard id-based manifest (no file field)", () => {
			const animation = {
				v: "5.5.0",
				layers: [],
				w: 800,
				h: 600,
				fr: 60,
				ip: 0,
				op: 180,
			};
			const manifest = {
				animations: [
					{
						id: "my-animation",
						speed: 1,
					},
				],
			};
			const zipData = {
				"manifest.json": Buffer.from(JSON.stringify(manifest)),
				"animations/my-animation.json": Buffer.from(JSON.stringify(animation)),
			};
			const zipBuffer = Buffer.from(zipSync(zipData));
			const result = processAndValidateLottie(
				zipBuffer,
				"awesome.lottie",
				"application/zip",
			);
			expect(result.filename).toBe("awesome.json");
			expect(result.contentType).toBe("application/json");
			const parsed = JSON.parse(result.buffer.toString("utf-8"));
			expect(parsed.w).toBe(800);
			expect(parsed.h).toBe(600);
			expect(parsed.fr).toBe(60);
		});
	});

	describe("resolveDataType (Lottie extension/mime)", () => {
		it("should resolve Lottie from json/lottie extension or mime", async () => {
			expect(await resolveDataType("application/json", "test.json")).toBe(
				"Lottie",
			);
			expect(await resolveDataType("application/zip", "test.lottie")).toBe(
				"Lottie",
			);
		});
	});

	describe("extractMediaMetadata (Lottie)", () => {
		it("should extract Lottie metadata from JSON buffer", async () => {
			const animation = {
				w: 500,
				h: 400,
				fr: 30,
				ip: 0,
				op: 90,
				layers: [],
			};
			const result = await extractMediaMetadata(
				Buffer.from(JSON.stringify(animation)),
				"application/json",
				"Lottie",
			);
			expect(result).toEqual({
				width: 500,
				height: 400,
				durationInSec: 3,
				fps: 30,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});

		it("should extract Lottie metadata directly from .lottie zip buffer", async () => {
			const animation = {
				w: 1920,
				h: 1080,
				fr: 60,
				ip: 0,
				op: 300,
				layers: [],
			};
			const zipData = {
				"animations/anim.json": Buffer.from(JSON.stringify(animation)),
			};
			const zipBuffer = Buffer.from(zipSync(zipData));
			const result = await extractMediaMetadata(
				zipBuffer,
				"application/zip",
				"Lottie",
			);
			expect(result).toEqual({
				width: 1920,
				height: 1080,
				durationInSec: 5,
				fps: 60,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});
	});

	describe("resolveDataType (GIF)", () => {
		it("should resolve GIF from extension", async () => {
			expect(
				await resolveDataType("application/octet-stream", "test.gif"),
			).toBe("GIF");
		});

		it("should resolve GIF from mime type", async () => {
			expect(await resolveDataType("image/gif", "test.bin")).toBe("GIF");
		});
	});

	describe("extractMediaMetadata (GIF)", () => {
		it("should extract GIF metadata with delays", async () => {
			const result = await extractMediaMetadata(
				Buffer.from(""),
				"image/gif",
				"GIF",
			);
			expect(result).toEqual({
				width: 600,
				height: 400,
				durationInSec: 0.3,
				fps: 10,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});

		it("should fallback for GIF metadata if no delay is present", async () => {
			mockSharpMetadata.mockResolvedValueOnce({
				width: 600,
				height: 400,
				pages: 5,
			});

			const result = await extractMediaMetadata(
				Buffer.from(""),
				"image/gif",
				"GIF",
			);
			expect(result).toEqual({
				width: 600,
				height: 400,
				durationInSec: 0.5,
				fps: 10,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});
	});

	describe("resolveDataType (LUT)", () => {
		it("should resolve LUT from extension", async () => {
			expect(
				await resolveDataType("application/octet-stream", "test.cube"),
			).toBe("LUT");
		});
	});

	describe("extractMediaMetadata (LUT)", () => {
		it("should extract 3D LUT metadata size and type", async () => {
			const cubeContent = `
# Some comments
LUT_3D_SIZE 33
0.0 0.0 0.0
`;
			const result = await extractMediaMetadata(
				Buffer.from(cubeContent),
				"application/octet-stream",
				"LUT",
			);
			expect(result).toEqual({
				width: 33,
				height: 3,
				durationInSec: null,
				fps: null,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});

		it("should extract 1D LUT metadata size and type", async () => {
			const cubeContent = `
# Some comments
LUT_1D_SIZE 1024
0.0 0.0 0.0
`;
			const result = await extractMediaMetadata(
				Buffer.from(cubeContent),
				"application/octet-stream",
				"LUT",
			);
			expect(result).toEqual({
				width: 1024,
				height: 1,
				durationInSec: null,
				fps: null,
				sampleRate: null,
				channels: null,
				bitDepth: null,
				audioCodec: null,
				audioBitrate: null,
			});
		});
	});
});
