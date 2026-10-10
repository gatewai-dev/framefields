import fs from "node:fs/promises";
import path from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import {
	CameraAnimation,
	Composition,
	FontManager,
	Layer,
	Layer3D,
	LayerAnimation,
} from "../packages/framefields/dist/index.mjs";

async function main() {
	console.log("=== WebGPU 2D & 3D Typography Render Engine ===");

	const outputDir =
		process.env.OUTPUT_DIR ||
		path.resolve(process.cwd(), "examples/output/text_2d_3d");
	const artifactDir = process.env.ARTIFACT_DIR || outputDir;
	await fs.mkdir(artifactDir, { recursive: true });
	await fs.mkdir(outputDir, { recursive: true });

	// Register fonts
	try {
		await FontManager.register("assets/fonts/Inter.ttf");
		await FontManager.register("assets/fonts/SpaceGrotesk.ttf");
	} catch (err) {
		console.log("Font registration notice:", err?.message);
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

	// 1. Camera with smooth perspective dolly and pan
	const camAnim = CameraAnimation.camera()
		.dolly(-1120, -960, { start: 0, end: 30, ease: "sine.inOut" })
		.dolly(-960, -1120, { start: 30, end: 60, ease: "sine.inOut" });

	comp.add(
		Layer.camera({
			id: "scene-camera",
			x: width / 2,
			y: height / 2,
			z: -1050,
			targetX: width / 2,
			targetY: height / 2,
			targetZ: 0,
			animation: camAnim,
		}),
	);

	// 2. Ambient Light Base (Slate/Navy)
	comp.add(Layer.ambientLight("#0f172a", 0.7));

	// 3. Dynamic Amber Point Light (Animates across the 3D text)
	const pointLightAnim = LayerAnimation.create()
		.keyframe("x", 0, 480, "sine.inOut")
		.keyframe("x", 30, 1440, "sine.inOut")
		.keyframe("x", 60, 480, "sine.inOut")
		.keyframe("intensity", 0, 2.0, "sine.inOut")
		.keyframe("intensity", 15, 3.2, "expo.out")
		.keyframe("intensity", 30, 2.0, "sine.inOut")
		.keyframe("intensity", 45, 3.2, "expo.out")
		.keyframe("intensity", 60, 2.0, "sine.inOut");

	comp.add(
		Layer.pointLight({
			id: "amber-point-light",
			color: "#f59e0b",
			intensity: 2.2,
			x: 480,
			y: 380,
			z: -420,
			radius: 2600,
			decay: 1.0,
			animation: pointLightAnim,
		}),
	);

	// 4. Dynamic Cyan Rim Spot Light (Highlights bevel edges)
	const spotLightAnim = LayerAnimation.create()
		.keyframe("targetX", 0, 780, "sine.inOut")
		.keyframe("targetX", 30, 1140, "sine.inOut")
		.keyframe("targetX", 60, 780, "sine.inOut");

	comp.add(
		Layer.spotLight({
			id: "cyan-rim-light",
			color: "#06b6d4",
			intensity: 2.8,
			x: 1460,
			y: 260,
			z: -550,
			targetX: width / 2,
			targetY: 480,
			targetZ: 0,
			angle: 65,
			penumbra: 0.35,
			radius: 2600,
			animation: spotLightAnim,
		}),
	);

	// 5. 3D Volumetric Extruded Typography (Layer3D.extrudedText)
	const extrudedAnim = LayerAnimation.create()
		.keyframe("rotateX", 0, 16, "sine.inOut")
		.keyframe("rotateX", 30, 24, "sine.inOut")
		.keyframe("rotateX", 60, 16, "sine.inOut")
		.keyframe("rotateY", 0, -20, "sine.inOut")
		.keyframe("rotateY", 30, 18, "sine.inOut")
		.keyframe("rotateY", 60, -20, "sine.inOut");

	const extrudedHeadline = Layer3D.extrudedText({
		id: "volumetric-3d-headline",
		text: "FRAMEFIELDS 3D",
		fontSize: 104,
		fontWeight: "bold",
		fill: "#ffffff",
		bevelColor: "#0284c7",
		depth: 44,
		slices: 12,
		x: width / 2,
		y: 470,
		z: 0,
		rotateX: 16,
		rotateY: -20,
		material: "lit",
		shininess: 96,
		specularIntensity: 1.0,
		letterSpacing: 4,
	});
	extrudedHeadline.animate(extrudedAnim);
	comp.add(extrudedHeadline);

	// 6. 3D Planar Tilted Subtitle (Layer3D.text)
	const subTextAnim = LayerAnimation.create()
		.keyframe("rotateX", 0, 12, "sine.inOut")
		.keyframe("rotateX", 30, 18, "sine.inOut")
		.keyframe("rotateX", 60, 12, "sine.inOut")
		.keyframe("rotateY", 0, -14, "sine.inOut")
		.keyframe("rotateY", 30, 14, "sine.inOut")
		.keyframe("rotateY", 60, -14, "sine.inOut");

	const planar3DText = Layer3D.text({
		id: "planar-3d-text",
		text: "VOLUMETRIC WEBGPU TYPOGRAPHY // 3D CAMERA SPACE",
		fontSize: 22,
		fontWeight: "bold",
		fill: "#38bdf8",
		x: width / 2,
		y: 620,
		z: 32,
		rotateX: 12,
		rotateY: -14,
		material: "lit",
		shininess: 64,
		specularIntensity: 0.9,
		letterSpacing: 5,
	});
	planar3DText.animate(subTextAnim);
	comp.add(planar3DText);

	// 7. 2D HUD Header & Kinetic Badges (Layer.flex & Layer.text)
	comp.add(
		Layer.flex({
			id: "hud-top-bar",
			position: "absolute",
			x: 60,
			y: 50,
			width: width - 120,
			dir: "row",
			justify: "space-between",
			align: "center",
			children: [
				Layer.flex({
					id: "hud-badge",
					dir: "row",
					align: "center",
					gap: 12,
					padding: 10,
					background: "rgba(15, 23, 42, 0.75)",
					borderRadius: 8,
					borderWidth: 1,
					borderColor: "rgba(56, 189, 248, 0.4)",
					children: [
						Layer.text("● 2D SLUG ANALYTIC ENGINE", {
							id: "badge-2d-tag",
							fontSize: 13,
							fontWeight: "bold",
							fill: "#38bdf8",
							letterSpacing: 2,
						}),
						Layer.text("// GPOS KERNING & CONTRAST GAIN ACTIVE", {
							id: "badge-2d-desc",
							fontSize: 12,
							fontWeight: 500,
							fill: "#94a3b8",
							letterSpacing: 1.5,
						}),
					],
				}),
				Layer.text("GPU NDC PROJECTION [DEPTH RANGE 0..1]", {
					id: "hud-telemetry",
					fontSize: 12,
					fontWeight: "bold",
					fill: "#64748b",
					letterSpacing: 2.5,
				}),
			],
		}),
	);

	// 8. 2D Headline Card with GPOS Pair Kerning Demo
	comp.add(
		Layer.flex({
			id: "kerning-demo-card",
			position: "absolute",
			x: 60,
			y: 140,
			width: 600,
			dir: "column",
			gap: 8,
			padding: 18,
			background: "rgba(15, 23, 42, 0.6)",
			borderRadius: 10,
			borderWidth: 1,
			borderColor: "rgba(30, 41, 59, 0.8)",
			children: [
				Layer.text("2D KINETIC TYPOGRAPHY", {
					id: "card-title-2d",
					fontSize: 14,
					fontWeight: "bold",
					fill: "#f59e0b",
					letterSpacing: 3,
				}),
				Layer.text("AVATAR QUANTUM", {
					id: "card-headline-2d",
					fontSize: 38,
					fontWeight: "bold",
					fill: "#ffffff",
					letterSpacing: 0, // Tests pair kerning: AV, VA, AT, AR
				}),
				Layer.text(
					"Zero-error pair kerning verified against Skia reference rasters (Δ = 0px).",
					{
						id: "card-sub-2d",
						fontSize: 13,
						fontWeight: 400,
						fill: "#94a3b8",
						lineHeight: 1.4,
					},
				),
			],
		}),
	);

	// 9. 2D Bottom HUD Status Bar
	comp.add(
		Layer.flex({
			id: "hud-footer",
			position: "absolute",
			x: 60,
			y: height - 80,
			width: width - 120,
			dir: "row",
			justify: "space-between",
			align: "center",
			padding: 12,
			background: "rgba(15, 23, 42, 0.7)",
			borderRadius: 8,
			borderWidth: 1,
			borderColor: "rgba(30, 41, 59, 0.7)",
			children: [
				Layer.text(
					"WEBGPU PIPELINE: 0 CHURN / 0 PIPELINE REBUILDS / 120 FPS ZERO-CPU-RE-RASTER",
					{
						id: "footer-left",
						fontSize: 12,
						fontWeight: "bold",
						fill: "#10b981",
						letterSpacing: 2,
					},
				),
				Layer.text("FRAMEFIELDS CORE ENGINE", {
					id: "footer-right",
					fontSize: 12,
					fontWeight: "bold",
					fill: "#64748b",
					letterSpacing: 2,
				}),
			],
		}),
	);

	console.log("Rendering Hero Frame 0 (2D + 3D Text)...");
	const frame0Buf = await comp.renderFrame({ frame: 0 });
	const heroPath = path.join(outputDir, "text_2d_3d_frame_000.png");
	const artifactHeroPath = path.join(artifactDir, "text_2d_3d_hero.png");
	await fs.writeFile(heroPath, frame0Buf);
	await fs.writeFile(artifactHeroPath, frame0Buf);

	console.log("Rendering Frame 20 (Dynamic Light Pulse & Tilt)...");
	const frame20Buf = await comp.renderFrame({ frame: 20 });
	const frame20Path = path.join(outputDir, "text_2d_3d_frame_020.png");
	await fs.writeFile(frame20Path, frame20Buf);

	console.log("Rendering FrameGrid Contact Sheet (0..60 frames)...");
	const gridBuf = await comp.renderFrameGrid({
		startFrame: 0,
		endFrame: 60,
		stepFrames: 12,
		cellWidth: 480,
		showLabels: true,
	});
	const gridPath = path.join(outputDir, "text_2d_3d_framegrid.png");
	const artifactGridPath = path.join(artifactDir, "text_2d_3d_framegrid.png");
	await fs.writeFile(gridPath, gridBuf);
	await fs.writeFile(artifactGridPath, gridBuf);

	// Validate rendered output via Skia-Canvas pixel sampling
	const heroImg = await loadImage(frame0Buf);
	console.log(`Verified Frame 0: ${heroImg.width}x${heroImg.height}px`);

	const testCanvas = new Canvas(heroImg.width, heroImg.height);
	const ctx = testCanvas.getContext("2d");
	ctx.drawImage(heroImg, 0, 0);

	// Sample 2D text region (top left card)
	const cardData = ctx.getImageData(80, 160, 200, 50).data;
	let has2DTextPixels = false;
	for (let i = 0; i < cardData.length; i += 4) {
		if (cardData[i] > 180 && cardData[i + 1] > 180 && cardData[i + 2] > 180) {
			has2DTextPixels = true;
			break;
		}
	}

	// Sample 3D text region (center extruded typography)
	const text3DData = ctx.getImageData(width / 2 - 200, 420, 400, 100).data;
	let has3DTextPixels = false;
	for (let i = 0; i < text3DData.length; i += 4) {
		if (
			text3DData[i] > 150 ||
			text3DData[i + 1] > 120 ||
			text3DData[i + 2] > 180
		) {
			has3DTextPixels = true;
			break;
		}
	}

	console.log(`2D Text Rasterization Verified: ${has2DTextPixels}`);
	console.log(`3D Extruded Text Rasterization Verified: ${has3DTextPixels}`);

	if (!has2DTextPixels || !has3DTextPixels) {
		throw new Error(
			"Validation failed: text pixels not detected in expected regions.",
		);
	}

	console.log("✅ Successfully rendered 2D & 3D text!");
	console.log("Artifact hero saved to:", artifactHeroPath);
	console.log("Artifact framegrid saved to:", artifactGridPath);
}

main().catch((err) => {
	console.error("Render error:", err);
	process.exit(1);
});
