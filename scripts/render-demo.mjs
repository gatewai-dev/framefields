import fs from "node:fs/promises";
import path from "node:path";
import {
	AudioSignal,
	AudioSignalExtractor,
	Blur,
	ColorBalance,
	Composition,
	computed,
	FontManager,
	Layer,
	LayerAnimation,
	Media,
	Signal,
	signal,
	Vignette,
} from "../packages/framefields/dist/index.mjs";
import { HeadlessMediaRenderer } from "../packages/framefields/dist/renderer/index.mjs";

async function main() {
	console.log("=== Framefields Signal-Driven Animation Pipeline ===");
	const inputVideo =
		process.env.INPUT_VIDEO || path.resolve(process.cwd(), "export.mp4");
	const outputPng = path.resolve(process.cwd(), "rendered_preview.png");
	const outputMp4 = path.resolve(process.cwd(), "rendered_composition.mp4");

	console.log("1. Registering TrueType fonts via FontManager singleton...");
	const font = await FontManager.register("assets/fonts/Inter.ttf");
	console.log(
		`   FontManager registered: "${font.family}" (${font.postscriptName}), unitsPerEm: ${font.unitsPerEm}`,
	);

	console.log(
		"2. Initializing AudioSignalExtractor node & extracting WebGPU audio features...",
	);
	const audioExtractor = new AudioSignalExtractor({
		nodeId: "speech_extractor",
		extractionMode: "rms_envelope",
		attackMs: 12,
		releaseMs: 140,
		sensitivity: 1.25,
		noiseFloorDb: -42,
		dynamicRangeDb: 40,
		smoothing: 0.18,
		curve: "smoothstep",
	});

	const audio = await audioExtractor.extract(inputVideo, { fps: 24 });
	console.log(
		`   Extracted WebGPU audio speech signals (${audio.numFrames} frames) via AudioSignalExtractor`,
	);

	console.log("3. Initializing composition and defining reactive signals...");
	const comp = new Composition({
		width: 1280,
		height: 720,
		fps: 24,
		backgroundColor: "#0d1117",
	});

	// Define reactive signals
	// 1. Rhythmic breathing pulse signal (1.4 Hz sinusoidal LFO)
	comp.addSignal("pulse_lfo", (frame, fps) => {
		const t = frame / fps;
		const wave = Math.sin(t * Math.PI * 2 * 1.4);
		return (wave + 1) * 0.5; // normalized 0..1
	});

	// 2. Real-time speech energy signal extracted via AudioSignalExtractor
	comp.addSignal("energy_signal", (frame) => {
		audio.seekFrame(frame);
		return audio.energy.value;
	});

	// Base video layer
	comp.add(
		Layer.video(inputVideo, {
			x: 0,
			y: 0,
			width: 1280,
			height: 720,
			fit: "cover",
		}),
	);

	// Audio track (mixed directly from video source)
	comp.addAudio(
		Layer.audio(inputVideo, {
			volume: 1.0,
		}),
	);

	// 1. Frosted dark card container behind typography
	comp.add(
		Layer.shape("rect", {
			id: "card-container",
			x: 70,
			y: 490,
			width: 1140,
			height: 165,
			borderRadius: 18,
			fillColor: "rgba(15, 23, 42, 0.88)",
		}).animate(
			new LayerAnimation()
				.slideInY(590, 490, 0, 22, "power3.out")
				.fadeIn(0, 16),
		),
	);

	// 2. Pulsing glowing indicator circle (scale & color modulated by pulse_lfo signal)
	comp.add(
		Layer.shape("circle", {
			id: "pulse-dot",
			x: 100,
			y: 520,
			width: 14,
			height: 14,
			borderRadius: 7,
			fillColor: "#38bdf8",
		}).animate(
			new LayerAnimation()
				.signal("scale", "pulse_lfo", { multiplier: 0.35, offset: 0.85 })
				.colorSignal("fillColor", "pulse_lfo", {
					colorA: "#38bdf8",
					colorB: "#ec4899",
				})
				.fadeIn(0, 18),
		),
	);

	// 3. Accent pill badge (scale modulated by signal, organic rotation wiggle)
	comp.add(
		Layer.shape("rect", {
			id: "vfx-badge",
			x: 126,
			y: 514,
			width: 185,
			height: 26,
			borderRadius: 6,
			fillColor: "#38bdf8",
		}).animate(
			new LayerAnimation()
				.signal("scale", "pulse_lfo", { multiplier: 0.08, offset: 1.0 })
				.wiggle("rotation", { frequency: 1.2, amplitude: 3.0, seed: 101 })
				.slideInY(536, 514, 6, 22)
				.fadeIn(6, 18),
		),
	);

	// 4. Badge label
	comp.add(
		Layer.text("AUDIO SIGNAL EXTRACTOR", {
			id: "badge-label",
			x: 136,
			y: 520,
			fontSize: 11,
			fill: "#0f172a",
			fontFamily: "Inter",
			fontWeight: "bold",
		}).animate(new LayerAnimation().slideInY(542, 520, 6, 22).fadeIn(6, 18)),
	);

	// 5. Signal reactive level track (meter background)
	comp.add(
		Layer.shape("rect", {
			id: "meter-bg",
			x: 330,
			y: 524,
			width: 220,
			height: 6,
			borderRadius: 3,
			fillColor: "rgba(255, 255, 255, 0.12)",
		}).animate(new LayerAnimation().fadeIn(10, 24)),
	);

	// 6. Active signal meter bar (width & color dynamically modulated by speech energy_signal)
	comp.add(
		Layer.shape("rect", {
			id: "meter-active",
			x: 330,
			y: 524,
			width: 60,
			height: 6,
			borderRadius: 3,
			fillColor: "#38bdf8",
		}).animate(
			new LayerAnimation()
				.signal("width", "energy_signal", { multiplier: 190, offset: 25 })
				.colorSignal("fillColor", "energy_signal", {
					colorA: "#38bdf8",
					colorB: "#f43f5e",
				})
				.fadeIn(10, 24),
		),
	);

	// 7. Signal meter label
	comp.add(
		Layer.text("SIGNAL MODULATION", {
			id: "meter-label",
			x: 566,
			y: 522,
			fontSize: 11,
			fill: "#94a3b8",
			fontFamily: "Inter",
			fontWeight: "bold",
		}).animate(new LayerAnimation().fadeIn(12, 26)),
	);

	// 8. Main title (entrance slide-up & fade-in)
	comp.add(
		Layer.text("Framefields Render Engine", {
			id: "main-title",
			x: 100,
			y: 554,
			fontSize: 32,
			fill: "#ffffff",
			fontFamily: "Inter",
		}).animate(new LayerAnimation().slideInY(580, 554, 8, 26).fadeIn(8, 22)),
	);

	// 9. Subtitle (entrance slide-up & fade-in)
	comp.add(
		Layer.text(
			"node-audio-signal-extractor • WebGPU Audio DSP • Reactive Speech Blur",
			{
				id: "subtitle",
				x: 100,
				y: 605,
				fontSize: 15,
				fill: "#94a3b8",
				fontFamily: "Inter",
			},
		).animate(new LayerAnimation().slideInY(625, 605, 14, 32).fadeIn(14, 28)),
	);

	console.log(
		"3. Dynamically computing composition duration & configuring reactive effects...",
	);
	const durationMs = await comp.computeDuration();
	console.log(
		`   Dynamically computed duration: ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`,
	);

	console.log(
		"4. Instantiating reactive effect classes with game-engine per-frame lifecycle hooks...",
	);

	// 1. First-class ColorBalance effect
	const colorBalance = new ColorBalance({
		shadows: { cyanRed: 12, magentaGreen: -4, yellowBlue: -12 },
		midtones: { cyanRed: 4, magentaGreen: 6, yellowBlue: 2 },
		highlights: { cyanRed: -4, magentaGreen: 0, yellowBlue: 8 },
		preserveLuminosity: true,
	});

	// 2. Procedural breathing LFO for subtle vignette modulation
	const vignetteBreathing = Signal.builder({
		type: "sine",
		frequency: 0.8,
		amplitude: 8.0,
		offset: 50.0,
	});

	// 3. First-class Vignette effect bound to reactive signals with per-frame mutation
	const vignette = new Vignette({
		strength: vignetteBreathing,
		radius: 0.85,
		softness: 0.55,
	});

	// Per-frame game engine hook: dynamically adjust radius over frames
	vignette.onRequestFrame(({ frame }) => {
		if (frame < 50) {
			vignette.radius = 0.75 + frame * 0.002;
		}
	});

	// 4. Reactive Speech Blur: Screen blurs dynamically when the man is talking!
	// When quiet/silent: 0 blur (crystal clear).
	// When speech detected: blur smoothly scales with voice energy (up to 20px).
	const speechBlurStrength = computed(() => {
		const energy = audio.energy.value;
		if (energy < 0.15) return 0;
		return Math.min(22, Math.max(0, (energy - 0.15) * 32 + 2));
	});

	const blur = new Blur({
		blurType: "Gaussian",
		strength: speechBlurStrength,
	});

	blur.onRequestFrame(({ frame }) => {
		audio.seekFrame(frame);
	});

	const compVM = await comp.toVirtualMediaAsync();
	const styledMedia = new Media(compVM)
		.apply(colorBalance)
		.apply(vignette)
		.apply(blur);

	const finalVM = styledMedia.toVirtualMedia();
	const renderer = new HeadlessMediaRenderer();

	console.log("5. Rendering high-quality preview frame at frame 48 (2.0s)...");
	const t0 = Date.now();
	const pngBuffer = await renderer.renderImage(finalVM, 48, 24);
	await fs.writeFile(outputPng, pngBuffer);
	console.log(
		`   Saved preview PNG (${(pngBuffer.length / 1024).toFixed(1)} KB) in ${Date.now() - t0}ms`,
	);

	console.log(
		`6. Rendering and encoding full-duration MP4 video (${(durationMs / 1000).toFixed(2)}s, ${Math.round((durationMs / 1000) * 24)} frames @ 24fps)...`,
	);
	const t1 = Date.now();
	const { filePath: tempVideoPath, cleanup } = await renderer.renderVideo(
		finalVM,
		{
			codec: "h264",
			quality: "medium",
		},
	);

	await fs.copyFile(tempVideoPath, outputMp4);
	await cleanup();
	const stat = await fs.stat(outputMp4);
	console.log(
		`   Saved full-length MP4 video (${(stat.size / 1024 / 1024).toFixed(2)} MB) in ${Date.now() - t1}ms`,
	);

	console.log("=== Render Completed Successfully ===");
}

main().catch((err) => {
	console.error("Pipeline execution failed:", err);
	process.exit(1);
});
