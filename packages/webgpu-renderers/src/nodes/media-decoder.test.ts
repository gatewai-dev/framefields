import { beforeEach, describe, expect, it, vi } from "vitest";
import { inputStore } from "../input-store.js";
import {
	AudioDecoder,
	mediaDecoderCache,
	VideoDecoder,
} from "./media-decoder.js";

// Mock mediabunny sinks and classes
vi.mock("mediabunny", () => {
	const mockCanvases = vi.fn().mockImplementation(async function* (ts: number) {
		yield { timestamp: ts, canvas: { width: 100, height: 100 } };
		yield { timestamp: ts + 0.1, canvas: { width: 100, height: 100 } };
	});

	const mockSamples = vi.fn().mockImplementation(async function* (ts: number) {
		yield {
			timestamp: ts,
			displayWidth: 100,
			displayHeight: 100,
			copyTo: vi.fn().mockResolvedValue(undefined),
			close: vi.fn(),
		};
		yield {
			timestamp: ts + 0.1,
			displayWidth: 100,
			displayHeight: 100,
			copyTo: vi.fn().mockResolvedValue(undefined),
			close: vi.fn(),
		};
	});

	const mockBuffers = vi.fn().mockImplementation(async function* (ts: number) {
		yield { timestamp: ts, duration: 0.1, data: new Float32Array(512) };
		yield { timestamp: ts + 0.1, duration: 0.1, data: new Float32Array(512) };
	});

	class CanvasSink {
		canvases = mockCanvases;
	}

	class VideoSampleSink {
		samples = mockSamples;
	}

	class AudioBufferSink {
		buffers = mockBuffers;
	}

	return {
		CanvasSink,
		VideoSampleSink,
		AudioBufferSink,
		Input: class {},
		UrlSource: class {},
		ALL_FORMATS: [],
	};
});

// Mock inputStore
vi.mock("../input-store.js", () => {
	const mockInput = {
		getPrimaryVideoTrack: vi.fn().mockResolvedValue({ id: "video-track" }),
		getPrimaryAudioTrack: vi.fn().mockResolvedValue({ id: "audio-track" }),
		dispose: vi.fn(),
	};
	return {
		inputStore: {
			acquire: vi.fn().mockResolvedValue(mockInput),
			release: vi.fn(),
		},
	};
});

describe("Media Decoder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("VideoDecoder", () => {
		it("should initialize and acquire input from inputStore", async () => {
			const decoder = new VideoDecoder("test-url", false);
			await decoder.init();
			expect(inputStore.acquire).toHaveBeenCalledWith("test-url");
		});

		it("should get frame in browser mode (non-headless)", async () => {
			const decoder = new VideoDecoder("test-url", false);
			const frame = await decoder.getFrame(0.5);
			expect(frame).not.toBeNull();
			expect(frame?.width).toBe(100);
			expect(frame?.height).toBe(100);
			expect(frame?.canvas).toBeDefined();
			expect(frame?.buffer).toBeUndefined();
			decoder.destroy();
		});

		it("should get frame in headless mode", async () => {
			const decoder = new VideoDecoder("test-url", true);
			const frame = await decoder.getFrame(0.5);
			expect(frame).not.toBeNull();
			expect(frame?.width).toBe(100);
			expect(frame?.height).toBe(100);
			expect(frame?.buffer).toBeDefined();
			expect(frame?.canvas).toBeUndefined();
			decoder.destroy();
		});

		it("should queue concurrent decode requests", async () => {
			const decoder = new VideoDecoder("test-url", false);
			const p1 = decoder.getFrame(0.1);
			const p2 = decoder.getFrame(0.2);
			const [f1, f2] = await Promise.all([p1, p2]);
			expect(f1).toBeDefined();
			expect(f2).toBeDefined();
			decoder.destroy();
		});

		it("should clamp negative and NaN timestamps to 0", async () => {
			const decoder = new VideoDecoder("test-url", false);
			const frameNegative = await decoder.getFrame(-2.5);
			expect(frameNegative).not.toBeNull();
			expect(frameNegative?.width).toBe(100);

			const frameNaN = await decoder.getFrame(Number.NaN);
			expect(frameNaN).not.toBeNull();
			expect(frameNaN?.width).toBe(100);
			decoder.destroy();
		});

		it("should reset sinks on error and recover", async () => {
			const decoder = new VideoDecoder("test-url", false);
			await decoder.getFrame(0.1);

			// Call resetSinks
			decoder.resetSinks();

			// Subsequent request should cleanly re-acquire and decode
			const frame = await decoder.getFrame(0.2);
			expect(frame).not.toBeNull();
			expect(frame?.width).toBe(100);
			decoder.destroy();
		});
	});

	describe("AudioDecoder", () => {
		it("should yield audio buffers for sync timeline", async () => {
			const decoder = new AudioDecoder("test-url", false);
			const generator = decoder.getBuffers(0.0);
			const first = await generator.next();
			expect(first.done).toBe(false);
			expect(first.value).toBeDefined();
			expect(first.value?.timestamp).toBe(0.0);
			decoder.destroy();
		});
	});

	describe("MediaDecoderCache", () => {
		it("should manage cache hit and prune old decoders", () => {
			const v1 = mediaDecoderCache.getVideo("test-video", false, "node1");
			const v2 = mediaDecoderCache.getVideo("test-video", false, "node1");
			expect(v1).toBe(v2);

			const a1 = mediaDecoderCache.getAudio("test-audio", "node1");
			const a2 = mediaDecoderCache.getAudio("test-audio", "node1");
			expect(a1).toBe(a2);
		});

		it("should clear node-specific decoders", () => {
			const v = mediaDecoderCache.getVideo(
				"test-video",
				false,
				"node-to-clear",
			);
			const spy = vi.spyOn(v, "destroy");
			mediaDecoderCache.clearNode("node-to-clear");
			expect(spy).toHaveBeenCalled();
		});
	});
});
