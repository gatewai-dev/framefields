import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { mixAudioTracks } from "@framefields/compositions";
import { imageLoader } from "@framefields/webgpu-renderers";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Composition, FontManager, Layer } from "./index.js";

describe("Web HTTP Asset Loading Pipeline", () => {
	let server: http.Server;
	let baseUrl: string;
	let fontBuffer: Buffer;
	let wavBuffer: Buffer;
	let pngBuffer: Buffer;

	beforeAll(async () => {
		// 1. Locate and read real test assets
		const fontCandidates = [
			path.resolve(process.cwd(), "assets/fonts/Inter.ttf"),
			path.resolve(process.cwd(), "../../assets/fonts/Inter.ttf"),
			path.resolve(__dirname, "../../../assets/fonts/Inter.ttf"),
		];
		let foundPath: string | null = null;
		for (const c of fontCandidates) {
			try {
				await fs.access(c);
				foundPath = c;
				break;
			} catch {}
		}
		if (!foundPath) throw new Error("Could not find Inter.ttf for test server");
		fontBuffer = await fs.readFile(foundPath);

		// Create a 16-bit 48kHz mono 0.1s WAV test buffer (4800 samples)
		const sampleRate = 48000;
		const numSamples = 4800; // 0.1 sec
		const dataSize = numSamples * 2;
		const header = Buffer.alloc(44);
		header.write("RIFF", 0);
		header.writeUInt32LE(36 + dataSize, 4);
		header.write("WAVE", 8);
		header.write("fmt ", 12);
		header.writeUInt32LE(16, 16); // PCM header size
		header.writeUInt16LE(1, 20); // PCM format
		header.writeUInt16LE(1, 22); // mono
		header.writeUInt32LE(sampleRate, 24);
		header.writeUInt32LE(sampleRate * 2, 28); // byte rate
		header.writeUInt16LE(2, 32); // block align
		header.writeUInt16LE(16, 34); // bits per sample
		header.write("data", 36);
		header.writeUInt32LE(dataSize, 40);

		const pcmData = Buffer.alloc(dataSize);
		for (let i = 0; i < numSamples; i++) {
			const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
			const int16 = Math.max(
				-32768,
				Math.min(32767, Math.round(sample * 32767)),
			);
			pcmData.writeInt16LE(int16, i * 2);
		}
		wavBuffer = Buffer.concat([header, pcmData]);

		// 1x1 Transparent PNG buffer
		pngBuffer = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
			"base64",
		);

		// 2. Start HTTP server
		server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname === "/fonts/Inter.ttf") {
				res.writeHead(200, {
					"Content-Type": "font/ttf",
					"Content-Length": fontBuffer.length,
				});
				res.end(fontBuffer);
				return;
			}
			if (url.pathname === "/audio/chime.wav") {
				res.writeHead(200, {
					"Content-Type": "audio/wav",
					"Content-Length": wavBuffer.length,
					"Accept-Ranges": "bytes",
				});
				res.end(wavBuffer);
				return;
			}
			if (url.pathname === "/images/pixel.png") {
				res.writeHead(200, {
					"Content-Type": "image/png",
					"Content-Length": pngBuffer.length,
				});
				res.end(pngBuffer);
				return;
			}
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		});

		await new Promise<void>((resolve) => {
			server.listen(0, () => {
				const addr = server.address();
				if (addr && typeof addr === "object") {
					baseUrl = `http://localhost:${addr.port}`;
				}
				resolve();
			});
		});
	});

	afterAll(async () => {
		if (server) {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	beforeEach(() => {
		FontManager.clear();
	});

	it("1. FontManager downloads, parses and registers remote HTTP TTF font", async () => {
		const remoteFontUrl = `${baseUrl}/fonts/Inter.ttf`;
		const reg = await FontManager.register("RemoteInter", remoteFontUrl);

		expect(reg).toBeDefined();
		expect(reg.family).toBe("RemoteInter");
		expect(reg.source).toBe(remoteFontUrl);
		expect(reg.filePath).toBe(remoteFontUrl);
		expect(reg.format).toBe("truetype");
		expect(reg.unitsPerEm).toBe(2048);
		expect(FontManager.has("RemoteInter")).toBe(true);
	});

	it("2. FontManager rejects unreachable or 404 HTTP fonts with clear message", async () => {
		const missingUrl = `${baseUrl}/fonts/nonexistent.ttf`;
		await expect(
			FontManager.register("MissingFont", missingUrl),
		).rejects.toThrow(/Failed to download font.*404/i);
	});

	it("3. ImageLoader loads remote HTTP images and local images symmetrically", async () => {
		// Remote HTTP load
		const remoteImg = await imageLoader.load(
			`${baseUrl}/images/pixel.png`,
			true,
		);
		expect(remoteImg).toBeDefined();
		expect(remoteImg.width).toBe(1);
		expect(remoteImg.height).toBe(1);
		expect(remoteImg.buffer).toBeDefined();

		// Local file load (write temporary PNG file)
		const tmpPngPath = path.resolve(process.cwd(), "test_tmp_pixel.png");
		await fs.writeFile(tmpPngPath, pngBuffer);
		try {
			const localImg = await imageLoader.load(tmpPngPath, true);
			expect(localImg).toBeDefined();
			expect(localImg.width).toBe(1);
			expect(localImg.height).toBe(1);
			expect(localImg.buffer).toBeDefined();
		} finally {
			await fs.unlink(tmpPngPath).catch(() => {});
		}
	});

	it("4. Composition handles remote HTTP audio tracks with mixAudioTracks", async () => {
		const comp = new Composition({
			fps: 30,
			width: 640,
			height: 360,
			durationMs: 100,
		});

		const audioUrl = `${baseUrl}/audio/chime.wav`;
		comp.addAudio(
			Layer.audio(audioUrl, {
				id: "remote-audio-chime",
				volume: 0.8,
			}),
		);

		const vm = comp.toVirtualMedia();
		const mixed = await mixAudioTracks(vm, 30, 48000);

		expect(mixed.channels.length).toBe(2);
		expect(mixed.sampleRate).toBe(48000);
		// At 100ms duration at 48000Hz, we expect 4800 samples
		expect(mixed.channels[0].length).toBe(4800);

		// Verify non-zero mixed samples were extracted from remote stream
		let hasSignal = false;
		for (let i = 0; i < mixed.channels[0].length; i++) {
			if (Math.abs(mixed.channels[0][i]!) > 1e-4) {
				hasSignal = true;
				break;
			}
		}
		expect(hasSignal).toBe(true);
	});

	it("5. Composition binds remote HTTP font in spec.fonts and integrates text layer", async () => {
		const comp = new Composition({
			fps: 30,
			width: 1280,
			height: 720,
		});

		const remoteFontUrl = `${baseUrl}/fonts/Inter.ttf`;
		await comp.registerFont("CloudInter", remoteFontUrl);

		comp.add(
			Layer.text("Cloud Typography", {
				fontFamily: "CloudInter",
				fontSize: 48,
				fill: "#ffffff",
			}),
		);

		const spec = comp.toSpec();
		expect(spec.fonts).toBeDefined();
		expect(spec.fonts).toContain(remoteFontUrl);
		expect(Array.isArray(spec.layout)).toBe(true);
		expect(spec.layout.length).toBe(1);
	});
});
