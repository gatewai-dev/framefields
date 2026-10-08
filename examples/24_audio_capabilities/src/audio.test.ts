import { encodeStereoWav, HeadlessMediaRenderer } from "framefields";
import { describe, expect, it } from "vitest";
import {
	buildStep1InitialAudio,
	buildStep2FadedAudio,
	buildStep3FadedReverbAudio,
	buildStep4DelayAudio,
	buildStep5ParametricEqAudio,
	buildStep6CompressorAudio,
	buildStep7StereoPanningAudio,
	DURATION_FRAMES,
	DURATION_MS,
	FPS,
	SAMPLE_RATE,
} from "./audio-pipeline.js";

describe("Example 24: Audio Capabilities", () => {
	it("compositions compile and export valid specs across all 7 steps", () => {
		const steps = [
			buildStep1InitialAudio(),
			buildStep2FadedAudio(),
			buildStep3FadedReverbAudio(),
			buildStep4DelayAudio(),
			buildStep5ParametricEqAudio(),
			buildStep6CompressorAudio(),
			buildStep7StereoPanningAudio(),
		];

		for (const comp of steps) {
			expect(comp.durationMs).toBe(DURATION_MS);
			const spec = comp.toSpec();
			expect(spec.layout.some((n) => n.kind === "media")).toBe(true);
		}
	});

	it("renders audio PCM channels and validates DSP effects", async () => {
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
		const pcm4 = await renderer.renderAudio(
			buildStep4DelayAudio().toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);
		const pcm5 = await renderer.renderAudio(
			buildStep5ParametricEqAudio().toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);
		const pcm6 = await renderer.renderAudio(
			buildStep6CompressorAudio().toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);
		const pcm7 = await renderer.renderAudio(
			buildStep7StereoPanningAudio().toVirtualMedia({
				durationMs: DURATION_MS,
			}),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);

		const expectedSamples = Math.ceil((DURATION_FRAMES / FPS) * SAMPLE_RATE);
		const allPcms = [pcm1, pcm2, pcm3, pcm4, pcm5, pcm6, pcm7];

		for (const p of allPcms) {
			expect(p.channels.length).toBe(2);
			expect(p.channels[0].length).toBe(expectedSamples);
			expect(p.channels[1].length).toBe(expectedSamples);
		}

		// 1. Validate RIFF WAV output
		const wav = encodeStereoWav([pcm1.channels[0], pcm1.channels[1]], {
			sampleRate: SAMPLE_RATE,
		});
		expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
		expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
		expect(wav.subarray(36, 40).toString("ascii")).toBe("data");

		// 2. Validate Step 2 AudioFade attenuation in early window (0.0s to 1.5s)
		const earlyCount = Math.round(1.5 * SAMPLE_RATE);
		let sum1 = 0;
		let sum2 = 0;
		for (let i = 0; i < earlyCount; i++) {
			sum1 += (pcm1.channels[0][i] ?? 0) ** 2;
			sum2 += (pcm2.channels[0][i] ?? 0) ** 2;
		}
		expect(Math.sqrt(sum2 / earlyCount)).toBeLessThan(
			Math.sqrt(sum1 / earlyCount),
		);

		// 3. Validate Step 3 Reverb tail difference vs Step 2
		let reverbDiff = 0;
		const midStart = Math.round(2.0 * SAMPLE_RATE);
		const midEnd = Math.round(4.0 * SAMPLE_RATE);
		for (let i = midStart; i < midEnd; i++) {
			if (
				Math.abs((pcm3.channels[0][i] ?? 0) - (pcm2.channels[0][i] ?? 0)) >
				0.001
			) {
				reverbDiff++;
			}
		}
		expect(reverbDiff).toBeGreaterThan(0);

		// 4. Validate Step 4 Ping-Pong Delay echo differences
		let delayDiff = 0;
		for (let i = midStart; i < midEnd; i++) {
			if (
				Math.abs((pcm4.channels[0][i] ?? 0) - (pcm1.channels[0][i] ?? 0)) >
				0.001
			) {
				delayDiff++;
			}
		}
		expect(delayDiff).toBeGreaterThan(0);

		// 5. Validate Step 5 Low-Pass EQ filters high frequencies
		let eqDiff = 0;
		for (let i = midStart; i < midEnd; i++) {
			if (
				Math.abs((pcm5.channels[0][i] ?? 0) - (pcm1.channels[0][i] ?? 0)) >
				0.001
			) {
				eqDiff++;
			}
		}
		expect(eqDiff).toBeGreaterThan(0);

		// 6. Validate Step 7 Stereo Panning dynamic sweep: early window panned left, late window panned right
		const earlyStart = Math.round(0.5 * SAMPLE_RATE);
		const earlyEnd = Math.round(1.5 * SAMPLE_RATE);
		let leftSumEarly = 0;
		let rightSumEarly = 0;
		for (let i = earlyStart; i < earlyEnd; i++) {
			leftSumEarly += (pcm7.channels[0][i] ?? 0) ** 2;
			rightSumEarly += (pcm7.channels[1][i] ?? 0) ** 2;
		}
		expect(leftSumEarly).toBeGreaterThan(rightSumEarly);

		const lateStart = Math.round(4.5 * SAMPLE_RATE);
		const lateEnd = Math.round(5.5 * SAMPLE_RATE);
		let leftSumLate = 0;
		let rightSumLate = 0;
		for (let i = lateStart; i < lateEnd; i++) {
			leftSumLate += (pcm7.channels[0][i] ?? 0) ** 2;
			rightSumLate += (pcm7.channels[1][i] ?? 0) ** 2;
		}
		expect(rightSumLate).toBeGreaterThan(leftSumLate);
	}, 30_000);
});
