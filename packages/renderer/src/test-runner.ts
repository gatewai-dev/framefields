import assert from "node:assert";
import fs from "node:fs/promises";
import type { VirtualMediaData } from "@gitframes/core";
import { HeadlessWebGPURenderer } from "./headless-webgpu-renderer.js";

async function runTests() {
	process.env.GATEWAI_UNIT_TEST = "true";
	// Mock fetch for offline unit tests to avoid network requests hanging
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : (input as { url?: string }).url || "";
		if (
			url.includes("fonts/load") ||
			url.includes("NotoColorEmoji") ||
			url.includes("example.com")
		) {
			throw new Error("Network requests are disabled in unit tests");
		}
		return originalFetch(input, init);
	};

	console.log("\n🚀 Starting HeadlessWebGPURenderer Unit Tests...");
	const renderer = new HeadlessWebGPURenderer();

	// Test 1: Initialization
	console.log(
		"👉 Test 1: Verification of Headless WebGPU Initialization (Concurrent calls)...",
	);
	const initPromise1 = HeadlessWebGPURenderer.initialize();
	const initPromise2 = HeadlessWebGPURenderer.initialize();
	const initPromise3 = HeadlessWebGPURenderer.initialize();

	assert.strictEqual(
		initPromise1,
		initPromise2,
		"Concurrent initialization calls must return the exact same Promise instance",
	);
	assert.strictEqual(
		initPromise2,
		initPromise3,
		"Concurrent initialization calls must return the exact same Promise instance",
	);

	await Promise.all([initPromise1, initPromise2, initPromise3]);
	console.log("✅ Initialization successful!\n");

	// Test 2: Still image rendering (PNG structure)
	console.log("👉 Test 2: Verification of Still Image PNG Rendering...");
	const mockImageMedia: VirtualMediaData = {
		operation: {
			dataType: "Image",
			op: "source",
			volume: 1,
			opacity: 1,
			startFrame: 0,
			timeline: {
				startFrame: 0,
				segments: [],
			},
			params: {
				sourceUrl: "https://example.com/mock.png",
			},
		} as any,
		metadata: {
			durationMs: 1000,
			width: 1080,
			height: 1080,
		},
		children: [],
	};

	const pngBuffer = await renderer.renderImage(mockImageMedia, 0, 24);

	assert.ok(Buffer.isBuffer(pngBuffer), "Render output must be a Buffer");
	assert.ok(pngBuffer.length > 0, "PNG buffer must not be empty");

	// Verify standard PNG file signature: 0x89 50 4E 47 (.PNG)
	assert.strictEqual(pngBuffer[0], 0x89, "PNG header index 0 must be 0x89");
	assert.strictEqual(pngBuffer[1], 0x50, "PNG header index 1 must be 0x50");
	assert.strictEqual(pngBuffer[2], 0x4e, "PNG header index 2 must be 0x4e");
	assert.strictEqual(pngBuffer[3], 0x47, "PNG header index 3 must be 0x47");
	console.log("✅ Still Image PNG Rendering successful!\n");

	// Test 3: Text operation rendering and font handling
	console.log("👉 Test 3: Verification of Text Operation and Typography...");
	const mockTextMedia: VirtualMediaData = {
		operation: {
			dataType: "Image",
			op: "text",
			text: "Hello Gatewai",
			fontFamily: "Inter",
			fontSize: 32,
			color: "white",
			startFrame: 0,
			timeline: {
				startFrame: 0,
				segments: [],
			},
		} as any,
		metadata: {
			durationMs: 1000,
			width: 1080,
			height: 1080,
		},
		children: [],
	};

	const textBuffer = await renderer.renderImage(mockTextMedia, 0, 24);
	assert.ok(Buffer.isBuffer(textBuffer), "Text render output must be a Buffer");
	assert.ok(textBuffer.length > 0, "Text PNG buffer must not be empty");
	assert.strictEqual(
		textBuffer[0],
		0x89,
		"Text PNG must have valid PNG signature",
	);
	console.log("✅ Text Operation Rendering successful!\n");

	// Test 4: 10-second video rendering
	console.log("👉 Test 4: Verification of 10-second Video Export...");
	const mockVideoMedia: VirtualMediaData = {
		operation: {
			dataType: "Image",
			op: "text",
			text: "Integration Test Video",
			fontFamily: "Inter",
			fontSize: 48,
			color: "white",
			startFrame: 0,
			timeline: {
				startFrame: 0,
				segments: [],
			},
		} as any,
		metadata: {
			durationMs: 10000, // 10 seconds
			fps: 24,
			width: 640,
			height: 360,
		},
		children: [],
	};

	const { filePath: videoFilePath, cleanup: videoCleanup } =
		await renderer.renderVideo(mockVideoMedia, {
			codec: "h264",
			quality: "low",
			concurrency: 2,
		});

	const videoBuffer = await fs.readFile(videoFilePath);
	await videoCleanup();

	assert.ok(
		Buffer.isBuffer(videoBuffer),
		"Video render output must be a Buffer",
	);
	assert.ok(videoBuffer.length > 0, "Video buffer must not be empty");
	console.log("✅ 10-second Video Export successful!\n");

	// Test 5: 2-hour looped video rendering
	console.log("👉 Test 5: Verification of 2-Hour Video Composition seeking...");
	const videoUrl =
		"https://cdn.gatewai.studio/assets/Z1fx5laepIfqBgJ2nUBWzV43QTDxT3dO/wxncNAIoLjQz1d3csn7go-Video%20Generator_fX6z3G019u57E4V-8uU4c.mp4";
	// Loop the 8-second video 900 times to create a 2-hour duration timeline
	const segments = Array.from({ length: 900 }, () => ({
		startSec: 0,
		endSec: 8,
	}));

	const mock2HourMedia: VirtualMediaData = {
		operation: {
			dataType: "Video",
			op: "source",
			volume: 1,
			opacity: 1,
			startFrame: 0,
			timeline: {
				startFrame: 0,
				segments,
			},
			params: {
				sourceUrl: videoUrl,
			},
		} as any,
		metadata: {
			durationMs: 2 * 60 * 60 * 1000, // 2 hours (7,200,000 ms)
			fps: 24,
			width: 640,
			height: 360,
		},
		children: [],
	};

	// Seek and render frame at t = 0s (frame 0)
	console.log("   - Rendering frame at 0 seconds (t = 0s)...");
	const frame0 = await renderer.renderImage(mock2HourMedia, 0, 24);
	assert.ok(Buffer.isBuffer(frame0), "Render output must be a Buffer");
	assert.ok(frame0.length > 0, "Frame buffer at 0s must not be empty");
	assert.strictEqual(frame0[0], 0x89, "Must have valid PNG signature");

	// Seek and render frame at t = 1800s (30 mins, frame 43200)
	console.log("   - Seeking and rendering frame at 30 minutes (t = 1800s)...");
	const frame30m = await renderer.renderImage(mock2HourMedia, 43200, 24);
	assert.ok(Buffer.isBuffer(frame30m), "Render output must be a Buffer");
	assert.ok(frame30m.length > 0, "Frame buffer at 30m must not be empty");
	assert.strictEqual(frame30m[0], 0x89, "Must have valid PNG signature");

	// Seek and render frame at t = 7199s (just before 2 hours, frame 172776)
	console.log(
		"   - Seeking and rendering frame at 1 hour 59 minutes 59 seconds (t = 7199s)...",
	);
	const frame2h = await renderer.renderImage(mock2HourMedia, 172776, 24);
	assert.ok(Buffer.isBuffer(frame2h), "Render output must be a Buffer");
	assert.ok(frame2h.length > 0, "Frame buffer at 2h must not be empty");
	assert.strictEqual(frame2h[0], 0x89, "Must have valid PNG signature");

	console.log("✅ 2-Hour Video Composition seeking successful!\n");

	// Test 6: 2K Video Rendering with Backpressure
	console.log(
		"👉 Test 6: Verification of 2K Video Export with Backpressure...",
	);
	const video2kUrl =
		"https://cdn.gatewai.studio/assets/grk8tGJWuuirxPjvMpPDyy1PsIwvp4mc/AMpnpabEt3arTVproTefr-AI%20Upscaler_IMFCjBQEk0URUUnPZkA1r.mp4";

	const mock2KVideoMedia: VirtualMediaData = {
		operation: {
			dataType: "Video",
			op: "source",
			volume: 1,
			opacity: 1,
			startFrame: 0,
			timeline: {
				startFrame: 0,
				segments: [
					{
						startSec: 0,
						endSec: 2,
					},
				],
			},
			params: {
				sourceUrl: video2kUrl,
			},
		} as any,
		metadata: {
			durationMs: 2000,
			fps: 30,
			width: 2560,
			height: 1440,
		},
		children: [],
	};

	const { filePath: video2kFilePath, cleanup: video2kCleanup } =
		await renderer.renderVideo(mock2KVideoMedia, {
			codec: "h264",
			quality: "low",
			concurrency: 2,
		});

	const video2kBuffer = await fs.readFile(video2kFilePath);
	await video2kCleanup();

	assert.ok(
		Buffer.isBuffer(video2kBuffer),
		"2K Video render output must be a Buffer",
	);
	assert.ok(video2kBuffer.length > 0, "2K Video buffer must not be empty");
	console.log("✅ 2K Video Export with Backpressure successful!\n");

	console.log(
		"🎉 All HeadlessWebGPURenderer Unit Tests passed successfully!\n",
	);
	process.exit(0);
}

runTests().catch((error) => {
	console.error("❌ Test execution failed:", error);
	process.exit(1);
});
