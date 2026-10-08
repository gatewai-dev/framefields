import path from "node:path";
import { Composition, Effect, Layer } from "framefields";

export const FPS = 30;
export const DURATION_SEC = 6;
export const DURATION_FRAMES = DURATION_SEC * FPS; // 180 frames
export const DURATION_MS = DURATION_SEC * 1000; // 6000 ms
export const SAMPLE_RATE = 48000;
export const W = 1280;
export const H = 720;

export const ASSETS_DIR = path.resolve(import.meta.dirname, "../assets");
export const SCORE_PATH = path.join(ASSETS_DIR, "score.mp3");

function createCard(title: string, subtitle: string, badge: string) {
	return Layer.flex({
		width: W,
		height: H,
		background: "#0d0f12",
		dir: "column",
		justify: "center",
		align: "center",
		padding: 60,
		gap: 20,
		children: [
			Layer.box({
				padding: 16,
				background: "#1e232d",
				borderRadius: 20,
				children: [
					Layer.text(badge, {
						fontSize: 18,
						fontWeight: 600,
						fill: "#38bdf8",
						letterSpacing: 2,
					}),
				],
			}),
			Layer.text(title, {
				fontSize: 56,
				fontWeight: 700,
				fill: "#f8fafc",
			}),
			Layer.text(subtitle, {
				fontSize: 24,
				fontWeight: 400,
				fill: "#94a3b8",
			}),
		],
	});
}

/**
 * Step 1: Baseline / Initial Audio.
 * Pure unprocessed soundtrack loaded from asset file with explicit frame duration.
 */
export function buildStep1InitialAudio(): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: DURATION_MS,
		backgroundColor: "#0d0f12",
	});

	comp.add(
		createCard(
			"Step 1: Initial Audio",
			"Raw soundtrack at baseline gain without DSP modification",
			"PASS-THROUGH",
		),
	);

	comp.addAudio(
		Layer.audio(SCORE_PATH, {
			id: "audio-step1-initial",
			durationFrames: DURATION_FRAMES,
			volume: 1.0,
		}),
	);

	return comp;
}

/**
 * Step 2: Faded Audio.
 * Applies WebGPU AudioFade for a smooth 2.0s fade-in from silence and 2.0s fade-out.
 */
export function buildStep2FadedAudio(): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: DURATION_MS,
		backgroundColor: "#0d0f12",
	});

	comp.add(
		createCard(
			"Step 2: Faded Audio",
			"WebGPU AudioFade: 2.0s linear fade-in and 2.0s scurve fade-out",
			"AUDIO FADE DSP",
		),
	);

	comp.addAudio(
		Layer.audio(SCORE_PATH, {
			id: "audio-step2-faded",
			durationFrames: DURATION_FRAMES,
			volume: 1.0,
		}).apply(
			Effect.audioFade({
				fadeInDuration: 2.0,
				fadeOutDuration: 2.0,
				fadeInCurve: "linear",
				fadeOutCurve: "scurve",
			}),
		),
	);

	return comp;
}

/**
 * Step 3: Faded Audio + Reverb.
 * Chains AudioFade and AudioReverb onto the soundtrack on native WebGPU compute.
 */
export function buildStep3FadedReverbAudio(): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: DURATION_MS,
		backgroundColor: "#0d0f12",
	});

	comp.add(
		createCard(
			"Step 3: Faded + Reverb",
			"Chained DSP: AudioFade (2.0s ramps) → AudioReverb (room 0.85, wet 0.6)",
			"MULTI-STAGE DSP",
		),
	);

	comp.addAudio(
		Layer.audio(SCORE_PATH, {
			id: "audio-step3-reverb",
			durationFrames: DURATION_FRAMES,
			volume: 1.0,
		})
			.apply(
				Effect.audioFade({
					fadeInDuration: 2.0,
					fadeOutDuration: 2.0,
					fadeInCurve: "linear",
					fadeOutCurve: "scurve",
				}),
			)
			.apply(
				Effect.audioReverb({
					roomSize: 0.85,
					damping: 0.2,
					wet: 0.6,
					dry: 0.7,
					width: 1.0,
				}),
			),
	);

	return comp;
}
