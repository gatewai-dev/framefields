import { HeadlessMediaRenderer } from "framefields";
import { describe, expect, it } from "vitest";
import {
	buildStep1InitialAudio,
	buildStep2FadedAudio,
	buildStep3FadedReverbAudio,
	DURATION_FRAMES,
	DURATION_MS,
	FPS,
	SAMPLE_RATE,
} from "./audio-pipeline.js";
import { pcmToWav } from "./wav.js";

describe("Example 24: Audio Capabilities", () => {
	it("compositions compile and export valid specs", () => {
		const comp1 = buildStep1InitialAudio();
		const comp2 = buildStep2FadedAudio();
		const comp3 = buildStep3FadedReverbAudio();

		expect(comp1.durationMs).toBe(DURATION_MS);
		expect(comp2.durationMs).toBe(DURATION_MS);
		expect(comp3.durationMs).toBe(DURATION_MS);

		const spec1 = comp1.toSpec();
		const spec2 = comp2.toSpec();
		const spec3 = comp3.toSpec();

		expect(spec1.layout.some((n) => n.kind === "media")).toBe(true);
		expect(spec2.layout.some((n) => n.kind === "media")).toBe(true);
		expect(spec3.layout.some((n) => n.kind === "media")).toBe(true);
	});

	it("renders audio PCM channels across all 3 steps", async () => {
		const renderer = new HeadlessMediaRenderer();

		const pcm1 = await renderer.renderAudio(
			buildStep1InitialAudio().toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);
		const pcm2 = await renderer.renderAudio(
			buildStep2FadedAudio().toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);
		const pcm3 = await renderer.renderAudio(
			buildStep3FadedReverbAudio().toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);

		const expectedSamples = Math.ceil((DURATION_FRAMES / FPS) * SAMPLE_RATE);
		expect(pcm1.channels.length).toBe(2);
		expect(pcm2.channels.length).toBe(2);
		expect(pcm3.channels.length).toBe(2);
		expect(pcm1.channels[0].length).toBe(expectedSamples);
		expect(pcm2.channels[0].length).toBe(expectedSamples);
		expect(pcm3.channels[0].length).toBe(expectedSamples);

		// Encode WAV and verify RIFF structure
		const wav = pcmToWav(pcm1.channels, SAMPLE_RATE);
		expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
		expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
		expect(wav.subarray(36, 40).toString("ascii")).toBe("data");

		// Calculate RMS in early fade-in window (0.0s to 1.5s)
		const earlyCount = Math.round(1.5 * SAMPLE_RATE);
		let sum1 = 0;
		let sum2 = 0;
		for (let i = 0; i < earlyCount; i++) {
			sum1 += (pcm1.channels[0][i] ?? 0) ** 2;
			sum2 += (pcm2.channels[0][i] ?? 0) ** 2;
		}
		const rms1 = Math.sqrt(sum1 / earlyCount);
		const rms2 = Math.sqrt(sum2 / earlyCount);

		// Fade-in should attenuate the early window
		expect(rms2).toBeLessThan(rms1);

		// Step 3 (Reverb) should differ from Step 2 in the sustain/tail region
		let diffCount = 0;
		const midStart = Math.round(2.0 * SAMPLE_RATE);
		const midEnd = Math.round(4.0 * SAMPLE_RATE);
		for (let i = midStart; i < midEnd; i++) {
			if (
				Math.abs((pcm3.channels[0][i] ?? 0) - (pcm2.channels[0][i] ?? 0)) >
				0.001
			) {
				diffCount++;
			}
		}
		expect(diffCount).toBeGreaterThan(0);
	});
});
