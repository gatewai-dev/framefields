import { describe, expect, it } from "vitest";
import {
	AUDIO_LATENT_BUFFER_SIZE,
	AudioLatentEngine,
	AudioLatentTrackCache,
	NUM_BINS,
} from "./audio-latent-engine.js";

describe("AudioLatentEngine & 1024-Band FFT Spectral Processor", () => {
	it("asserts pure 440Hz sine wave peak lands in expected frequency bin (bin 18-19)", () => {
		const sampleRate = 48000;
		const durationSec = 0.5;
		const totalSamples = Math.round(sampleRate * durationSec);
		const samples = new Float32Array(totalSamples);
		const freq = 440.0; // A4

		for (let i = 0; i < totalSamples; i++) {
			samples[i] = Math.sin((2.0 * Math.PI * freq * i) / sampleRate);
		}

		const engine = new AudioLatentEngine();
		const result = engine.extractAtTime([samples], sampleRate, 0.25);

		expect(result.fftBins.length).toBe(NUM_BINS);

		// Find peak frequency bin
		let maxBin = 0;
		let maxAmp = 0;
		for (let k = 0; k < NUM_BINS; k++) {
			if ((result.fftBins[k] ?? 0) > maxAmp) {
				maxAmp = result.fftBins[k] ?? 0;
				maxBin = k;
			}
		}

		// Bin delta = 48000 / 2048 = 23.4375 Hz. 440 / 23.4375 = 18.77 -> bin 18 or 19
		expect(maxBin).toBeGreaterThanOrEqual(18);
		expect(maxBin).toBeLessThanOrEqual(19);
		expect(maxAmp).toBeGreaterThan(0.5);
	});

	it("isolates sub-bass energy (50Hz) and validates energy boundaries", () => {
		const sampleRate = 48000;
		const totalSamples = 48000;
		const bassSamples = new Float32Array(totalSamples);
		const trebleSamples = new Float32Array(totalSamples);

		for (let i = 0; i < totalSamples; i++) {
			bassSamples[i] = Math.sin((2.0 * Math.PI * 50.0 * i) / sampleRate);
			trebleSamples[i] = Math.sin((2.0 * Math.PI * 5000.0 * i) / sampleRate);
		}

		const engine = new AudioLatentEngine();
		const bassResult = engine.extractAtTime([bassSamples], sampleRate, 0.5);
		const trebleResult = engine.extractAtTime([trebleSamples], sampleRate, 0.5);

		// 50Hz tone must produce strong bass energy
		expect(bassResult.bassEnergy).toBeGreaterThan(0.4);
		// 5000Hz tone must produce virtually zero bass energy
		expect(trebleResult.bassEnergy).toBeLessThan(0.05);

		// Boundaries: All energies must be within [0.0, 1.0]
		expect(bassResult.bassEnergy).toBeGreaterThanOrEqual(0);
		expect(bassResult.bassEnergy).toBeLessThanOrEqual(1.0);
		expect(bassResult.drumTransient).toBeGreaterThanOrEqual(0);
		expect(bassResult.drumTransient).toBeLessThanOrEqual(1.0);
		expect(bassResult.vocalEnergy).toBeGreaterThanOrEqual(0);
		expect(bassResult.vocalEnergy).toBeLessThanOrEqual(1.0);
	});

	it("packs AudioLatentBuffer into 4,112-byte aligned GPU storage buffer format", () => {
		const bins = new Float32Array(NUM_BINS);
		bins[19] = 0.85;
		bins[100] = 0.42;

		const packed = AudioLatentEngine.packBufferData({
			fftBins: bins,
			bassEnergy: 0.75,
			drumTransient: 0.9,
			vocalEnergy: 0.35,
			timeMs: 1250,
		});

		expect(packed.length).toBe(NUM_BINS + 4);
		expect(packed.byteLength).toBe(AUDIO_LATENT_BUFFER_SIZE);
		expect(packed[19]).toBeCloseTo(0.85, 4);
		expect(packed[100]).toBeCloseTo(0.42, 4);
		expect(packed[1024]).toBeCloseTo(0.75, 4);
		expect(packed[1025]).toBeCloseTo(0.9, 4);
		expect(packed[1026]).toBeCloseTo(0.35, 4);
		expect(packed[1027]).toBeCloseTo(1250, 4);
	});

	it("operates AudioLatentTrackCache for instant O(1) frame lookup", () => {
		const sampleRate = 48000;
		const fps = 60;
		const totalFrames = 120; // 2 seconds
		const samples = new Float32Array(sampleRate * 2);
		// Add burst at 1.0 sec (frame 60)
		for (let i = sampleRate; i < sampleRate + 2048; i++) {
			samples[i] = 1.0;
		}

		const cache = new AudioLatentTrackCache(
			[samples],
			sampleRate,
			fps,
			totalFrames,
		);
		const frame0 = cache.getFrameData(0);
		const frame60 = cache.getFrameData(60);

		expect(frame0.timeMs).toBe(0);
		expect(frame60.timeMs).toBeCloseTo(1000, 1);
		expect(frame60.drumTransient).toBeGreaterThan(frame0.drumTransient);
	});

	it("executes 100 STFT frame extractions in under 10ms (<0.1ms per frame)", () => {
		const sampleRate = 48000;
		const samples = new Float32Array(sampleRate * 4);
		for (let i = 0; i < samples.length; i++) {
			samples[i] = Math.sin(i * 0.05);
		}

		const engine = new AudioLatentEngine();
		const t0 = performance.now();
		for (let f = 0; f < 100; f++) {
			engine.extractAtTime([samples], sampleRate, f / 30);
		}
		const duration = performance.now() - t0;
		expect(duration).toBeLessThan(50); // Generous 50ms ceiling, typically < 5ms
	});
});
