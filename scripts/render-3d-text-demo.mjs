import {
	CameraAnimation,
	Composition,
	FontManager,
	Layer,
	Layer3D,
	LayerAnimation,
} from "../packages/framefields/dist/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
	console.log("=== WebGPU 3D Typography Render Demonstration ===");

	const artifactDir = "/Users/okanaslankan/.gemini/antigravity-ide/brain/18faf2d5-3c9b-408e-8ba7-bcbf855a7dc5";
	const outputDir = "/Users/okanaslankan/framefields/examples/output/3d_text_demo";
	await fs.mkdir(artifactDir, { recursive: true });
	await fs.mkdir(outputDir, { recursive: true });

	try {
		await FontManager.register("assets/fonts/Inter.ttf");
	} catch (err) {
		console.log("Font registration skipped:", err?.message);
	}

	const width = 1920;
	const height = 1080;
	const fps = 30;
	const totalFrames = 60;
	const durationMs = (totalFrames / fps) * 1000;

	const comp = new Composition({
		width,
		height,
		fps,
		durationMs,
		backgroundColor: "#030712",
	});

	// 1. Camera with subtle cinematic dolly
	const camAnim = CameraAnimation.camera()
		.dolly(-1100, -950, { start: 0, end: 30, ease: "sine.inOut" })
		.dolly(-950, -1100, { start: 30, end: 60, ease: "sine.inOut" });

	comp.add(
		Layer.camera({
			id: "text3d-camera",
			x: width / 2,
			y: height / 2,
			z: -1100,
			targetX: width / 2,
			targetY: height / 2,
			targetZ: 0,
			animation: camAnim,
		}),
	);

	// 2. Ambient Base Fill
	comp.add(Layer.ambientLight("#0f172a", 0.6));

	// 3. Point Light (Pulsing Gold / Amber)
	const pointAnim = LayerAnimation.create()
		.keyframe("x", 0, 500, "sine.inOut")
		.keyframe("x", 30, 1400, "sine.inOut")
		.keyframe("x", 60, 500, "sine.inOut")
		.keyframe("intensity", 0, 1.8, "sine.inOut")
		.keyframe("intensity", 15, 3.2, "expo.out")
		.keyframe("intensity", 30, 1.8, "sine.inOut")
		.keyframe("intensity", 45, 3.2, "expo.out")
		.keyframe("intensity", 60, 1.8, "sine.inOut");

	comp.add(
		Layer.pointLight({
			id: "gold-point-light",
			color: "#f59e0b",
			intensity: 2.2,
			x: 500,
			y: 350,
			z: -450,
			radius: 2500,
			decay: 1.0,
			animation: pointAnim,
		}),
	);

	// 4. Spot Light (Electric Cyan Rim)
	const spotAnim = LayerAnimation.create()
		.keyframe("targetX", 0, 800, "sine.inOut")
		.keyframe("targetX", 30, 1150, "sine.inOut")
		.keyframe("targetX", 60, 800, "sine.inOut");

	comp.add(
		Layer.spotLight({
			id: "cyan-spot-light",
			color: "#06b6d4",
			intensity: 2.5,
			x: 1400,
			y: 250,
			z: -550,
			targetX: width / 2,
			targetY: 460,
			targetZ: 0,
			angle: 60,
			penumbra: 0.4,
			radius: 2500,
			animation: spotAnim,
		}),
	);

	// 5. Extruded Volumetric 3D Headline Typography
	const mainTextAnim = LayerAnimation.create()
		.keyframe("rotateX", 0, 15, "sine.inOut")
		.keyframe("rotateX", 30, 22, "sine.inOut")
		.keyframe("rotateX", 60, 15, "sine.inOut")
		.keyframe("rotateY", 0, -18, "sine.inOut")
		.keyframe("rotateY", 30, 18, "sine.inOut")
		.keyframe("rotateY", 60, -18, "sine.inOut");

	const extrudedHeadline = Layer3D.extrudedText({
		id: "volumetric-headline",
		text: "FRAMEFIELDS 3D",
		fontSize: 100,
		fontWeight: "bold",
		fill: "#ffffff",
		bevelColor: "#0284c7",
		depth: 44,
		slices: 10,
		x: width / 2,
		y: 460,
		z: 0,
		rotateX: 15,
		rotateY: -18,
		material: "lit",
		shininess: 96,
		specularIntensity: 1.0,
		letterSpacing: 4,
	});
	extrudedHeadline.animate(mainTextAnim);
	comp.add(extrudedHeadline);

	// 6. Planar 3D Subtitle with Lit Material
	const subTextAnim = LayerAnimation.create()
		.keyframe("rotateX", 0, 12, "sine.inOut")
		.keyframe("rotateX", 30, 18, "sine.inOut")
		.keyframe("rotateX", 60, 12, "sine.inOut")
		.keyframe("rotateY", 0, -12, "sine.inOut")
		.keyframe("rotateY", 30, 12, "sine.inOut")
		.keyframe("rotateY", 60, -12, "sine.inOut");

	const subtitle3D = Layer3D.text({
		id: "subtitle-3d",
		text: "VOLUMETRIC WEBGPU TYPOGRAPHY // DYNAMIC LIGHTS",
		fontSize: 24,
		fontWeight: "bold",
		fill: "#38bdf8",
		x: width / 2,
		y: 600,
		z: 30,
		rotateX: 12,
		rotateY: -12,
		material: "lit",
		shininess: 64,
		specularIntensity: 0.9,
		letterSpacing: 6,
	});
	subtitle3D.animate(subTextAnim);
	comp.add(subtitle3D);

	// 8. 2D HUD Header Overlay
	comp.add(
		Layer.flex({
			id: "hud-header",
			position: "absolute",
			x: 60,
			y: 40,
			width: width - 120,
			dir: "row",
			justify: "space-between",
			align: "center",
			children: [
				Layer.text("FRAMEFIELDS // 3D GPU TYPOGRAPHY ENGINE", {
					id: "hud-title",
					fontSize: 14,
					fontWeight: "bold",
					fill: "#64748b",
					letterSpacing: 3,
				}),
				Layer.text("REAL-TIME MULTI-SLICE EXTRUSION + BLINN-PHONG SHADING", {
					id: "hud-status",
					fontSize: 12,
					fontWeight: "bold",
					fill: "#06b6d4",
					letterSpacing: 2,
				}),
			],
		}),
	);

	console.log("Rendering 3D Text Frame 0...");
	const f0 = await comp.renderFrame({ frame: 0 });
	await fs.writeFile(path.join(outputDir, "3d_text_frame_000.png"), f0);
	await fs.writeFile(path.join(artifactDir, "3d_text_hero.png"), f0);

	console.log("Rendering 3D Text Frame 15 (Light Pulse)...");
	const f15 = await comp.renderFrame({ frame: 15 });
	await fs.writeFile(path.join(outputDir, "3d_text_frame_015.png"), f15);

	console.log("Rendering 3D Text Frame 30 (Alternate Tilt)...");
	const f30 = await comp.renderFrame({ frame: 30 });
	await fs.writeFile(path.join(outputDir, "3d_text_frame_030.png"), f30);

	console.log("Rendering 3D Text FrameGrid Contact Sheet...");
	const gridBuf = await comp.renderFrameGrid({
		startFrame: 0,
		endFrame: 60,
		stepFrames: 10,
		cellWidth: 480,
		showLabels: true,
	});
	await fs.writeFile(path.join(outputDir, "3d_text_framegrid.png"), gridBuf);
	await fs.writeFile(path.join(artifactDir, "3d_text_framegrid.png"), gridBuf);

	console.log("Rendering 3D Text Master MP4...");
	await comp.renderVideo(path.join(outputDir, "3d_text_showcase.mp4"), {
		fps: 30,
		durationFrames: 60,
	});

	console.log("✅ 3D Text Rendering Demonstration Complete!");
	console.log("Output saved to:", outputDir);
}

main().catch(console.error);
