/**
 * Step-by-step audio capability export script:
 *
 * 1. Step 1: Baseline / Initial Audio (score.mp3 without effects)
 * 2. Step 2: Faded Audio (with WebGPU AudioFade effect)
 * 3. Step 3: Faded + Reverb Audio (AudioFade + AudioReverb DSP chain)
 * 4. Step 4: Ping-Pong Delay (AudioDelay spatial stereo echo)
 * 5. Step 5: Parametric EQ Filter (AudioParametricEq biquad low-pass filter)
 * 6. Step 6: Dynamics Compressor (AudioCompressor dynamics limiter & makeup gain)
 * 7. Step 7: Stereo Panning (StereoPanning spatial soundstage balance)
 *
 * Exports both uncompressed 16-bit WAV PCM files and encoded MP4 videos.
 *
 * Usage:
 *   pnpm render          # Renders all audio steps (.wav) and videos (.mp4)
 *   pnpm render wav      # Renders only WAV audio files
 */
import fs from "node:fs/promises";
import path from "node:path";
import { encodeStereoWav, HeadlessMediaRenderer } from "framefields";
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
	DURATION_SEC,
	FPS,
	SAMPLE_RATE,
} from "./audio-pipeline.js";

const OUTPUT_DIR = path.resolve(import.meta.dirname, "../output");
const mode = process.argv[2] ?? "all";

function calculateRms(
	channel: Float32Array,
	startSample: number,
	endSample: number,
): number {
	let sum = 0;
	const count = Math.max(1, endSample - startSample);
	for (let i = startSample; i < endSample; i++) {
		const val = channel[i] ?? 0;
		sum += val * val;
	}
	return Math.sqrt(sum / count);
}

async function main() {
	await fs.mkdir(OUTPUT_DIR, { recursive: true });
	const renderer = new HeadlessMediaRenderer();

	const steps = [
		{
			name: "Step 1: Initial Audio",
			slug: "step1_initial",
			builder: buildStep1InitialAudio,
			description: "Clean baseline soundtrack without DSP modification",
		},
		{
			name: "Step 2: Faded Audio",
			slug: "step2_faded",
			builder: buildStep2FadedAudio,
			description: "WebGPU AudioFade (2.0s fade-in, 2.0s fade-out)",
		},
		{
			name: "Step 3: Faded + Reverb Audio",
			slug: "step3_faded_reverb",
			builder: buildStep3FadedReverbAudio,
			description:
				"Multi-stage chain: AudioFade → AudioReverb (room 0.85, wet 0.6)",
		},
		{
			name: "Step 4: Ping-Pong Delay",
			slug: "step4_delay",
			builder: buildStep4DelayAudio,
			description:
				"WebGPU AudioDelay: spatial ping-pong stereo echo (0.28s, 45% feedback)",
		},
		{
			name: "Step 5: Parametric EQ Filter",
			slug: "step5_parametric_eq",
			builder: buildStep5ParametricEqAudio,
			description:
				"WebGPU AudioParametricEq: 750 Hz biquad low-pass filter (Q: 1.2)",
		},
		{
			name: "Step 6: Dynamics Compressor",
			slug: "step6_compressor",
			builder: buildStep6CompressorAudio,
			description:
				"WebGPU AudioCompressor: -22 dB threshold, 6:1 ratio, +4 dB makeup gain",
		},
		{
			name: "Step 7: Stereo Panning",
			slug: "step7_stereo_pan",
			builder: buildStep7StereoPanningAudio,
			description:
				"WebGPU StereoPanning: dynamic signal sweep from left to right (pan: -1.0 → +1.0)",
		},
	];

	console.log("=========================================================");
	console.log(" Framefields Audio Capabilities Step-by-Step Renderer");
	console.log(
		` Duration: ${DURATION_SEC}s (${DURATION_FRAMES} frames @ ${FPS} fps)`,
	);
	console.log(` Sample rate: ${SAMPLE_RATE} Hz`);
	console.log("=========================================================\n");

	for (const step of steps) {
		console.log(`[Processing] ${step.name}`);
		console.log(`  Description: ${step.description}`);
		const comp = step.builder();

		// 1. Render Audio PCM via Headless Media Renderer
		const pcmStart = Date.now();
		const pcm = await renderer.renderAudio(
			comp.toVirtualMedia({ durationMs: DURATION_MS }),
			{ fps: FPS, sampleRate: SAMPLE_RATE },
		);
		const pcmDuration = ((Date.now() - pcmStart) / 1000).toFixed(2);

		// 2. Export 16-bit WAV
		const left = pcm.channels[0] ?? new Float32Array(0);
		const right = pcm.channels[1] ?? left;
		const wavBuffer = encodeStereoWav([left, right], {
			sampleRate: SAMPLE_RATE,
		});
		const wavPath = path.join(OUTPUT_DIR, `${step.slug}_audio.wav`);
		await fs.writeFile(wavPath, wavBuffer);

		// Compute RMS metrics across key timeline windows
		const fadeInRms = calculateRms(left, 0, Math.round(1.5 * SAMPLE_RATE));
		const sustainRms = calculateRms(
			left,
			Math.round(2.5 * SAMPLE_RATE),
			Math.round(3.5 * SAMPLE_RATE),
		);
		const fadeOutRms = calculateRms(
			left,
			Math.round(4.5 * SAMPLE_RATE),
			Math.round(6.0 * SAMPLE_RATE),
		);

		console.log(
			`  ✓ WAV exported: ${path.relative(process.cwd(), wavPath)} (${wavBuffer.length} bytes in ${pcmDuration}s)`,
		);
		console.log(
			`    • Fade-in window (0.0s - 1.5s) RMS:   ${fadeInRms.toFixed(5)}`,
		);
		console.log(
			`    • Sustain window (2.5s - 3.5s) RMS:   ${sustainRms.toFixed(5)}`,
		);
		console.log(
			`    • Fade-out window (4.5s - 6.0s) RMS:  ${fadeOutRms.toFixed(5)}`,
		);

		// 3. Export accompanying MP4 video with audio muxed
		if (mode !== "wav") {
			const mp4Path = path.join(OUTPUT_DIR, `${step.slug}.mp4`);
			const videoStart = Date.now();
			await comp.renderVideo(mp4Path);
			const videoDuration = ((Date.now() - videoStart) / 1000).toFixed(2);
			const stat = await fs.stat(mp4Path);
			console.log(
				`  ✓ MP4 exported: ${path.relative(process.cwd(), mp4Path)} (${stat.size} bytes in ${videoDuration}s)`,
			);
		}

		console.log();
	}

	console.log("All audio steps successfully exported to output/ directory.");
	process.exit(0);
}

main().catch((err) => {
	console.error("[render] Fatal error:", err);
	process.exit(1);
});
