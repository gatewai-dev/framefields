import fs from "node:fs/promises";
import path from "node:path";
import { Composition, FilmGrain } from "framefields";
import { trackScene } from "./scenes/track.js";
import { FPS, H, INK, registerFonts, W } from "./theme.js";

const currentDir =
	typeof import.meta.dirname === "string"
		? import.meta.dirname
		: path.resolve(".");
const outputDir = path.resolve(currentDir, "../output");

async function main(): Promise<void> {
	console.log("=== Framefields Film: Chapter 05 'Track it.' Scene Rendering ===");
	await fs.mkdir(outputDir, { recursive: true });
	await registerFonts();

	// 4.8 seconds @ 30 FPS by default; override with TRACK_FRAMES=120 for a 4 s cut
	const totalFrames = Number(process.env.TRACK_FRAMES ?? 144);
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: totalFrames,
		backgroundColor: INK,
	});

	comp.add(trackScene({ from: 0, to: totalFrames }));
	comp.apply(new FilmGrain({ strength: 0.05, size: 1.6, animated: true }));

	console.log(
		`✓ Composition assembled: ${W}x${H} @ ${FPS} FPS (${totalFrames} frames)`,
	);

	const [mode = "all"] = process.argv.slice(2);

	// 1. Render Hero Preview Frames
	if (mode === "frames" || mode === "all") {
		console.log("\n📸 Rendering Hero Preview Frames...");
		const heroFrames = [
			{
				frame: 12,
				label:
					"Soft-Alpha Cutout · 3D Ground Contact Rings · Reticle Lock",
			},
			{
				frame: 48,
				label: "Subject Sandwich · Behind-Text Depth · Telemetry HUD (~120°)",
			},
			{
				frame: 84,
				label:
					"Mid-Spin Contact Plane Tracking · Concentric Floor Pulses (~210°)",
			},
			{
				frame: Math.min(120, totalFrames - 12),
				label: "Continuous Soft-Alpha Segmentation · Full-Spectrum Hue Sweep",
			},
		];

		for (const { frame, label } of heroFrames) {
			// The vision readback runs one render-call behind (the frame encoder is
			// submitted after the node renderer returns), so prime it with the
			// preceding frame to keep this capture's silhouette mask aligned.
			await comp.renderFrame({ frame: Math.max(0, frame - 1) });

			const filename = `track_frame_${String(frame).padStart(4, "0")}.png`;
			const outPath = path.join(outputDir, filename);
			const tStart = performance.now();
			const png = await comp.renderFrame({ frame });
			const elapsed = performance.now() - tStart;
			await fs.writeFile(outPath, png);
			console.log(
				`  - Rendered frame ${frame}: ${filename} (${elapsed.toFixed(1)} ms) — ${label}`,
			);
		}
	}

	// 2. Render MP4 Video Preview
	if (mode === "video" || mode === "all") {
		console.log("\n🎬 Rendering Master MP4 Video Preview...");
		const videoPath = path.join(outputDir, "track-scene.mp4");
		const renderResult = await comp.renderVideo({
			outputPath: videoPath,
			quality: "high",
		});
		console.log(`✓ Video successfully rendered to: ${renderResult.filePath}`);
		await renderResult.cleanup().catch(() => {});
	}
	console.log(
		`\n🎉 Chapter 05 'Track it.' Render Complete! Outputs saved in: ${outputDir}`,
	);
}

main()
	.then(() => {
		setTimeout(() => process.exit(0), 200);
	})
	.catch((err: unknown) => {
		console.error("❌ Error rendering track scene:", err);
		process.exit(1);
	});
