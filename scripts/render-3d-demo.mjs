import fs from "node:fs/promises";
import path from "node:path";
import {
	CameraAnimation,
	Composition,
	FontManager,
	Layer,
} from "../packages/framefields/dist/index.mjs";

async function main() {
	console.log("=== WebGPU 3D Camera & Multiplane Render Demonstration ===");

	const assetsDir =
		process.env.ASSETS_DIR || path.resolve(process.cwd(), "assets/renders-3d");
	const artifactDir = process.env.ARTIFACT_DIR || assetsDir;
	await fs.mkdir(artifactDir, { recursive: true });
	await fs.mkdir(assetsDir, { recursive: true });

	// Register font if available
	try {
		await FontManager.register("assets/fonts/Inter.ttf");
	} catch (err) {
		console.log("Font registration skipped:", err?.message);
	}

	// 1. Dolly & Multiplane Composition
	console.log("Rendering 1: 3D Camera Dolly Multiplane...");
	const compDolly = new Composition({
		width: 1280,
		height: 720,
		fps: 30,
		durationMs: 2000,
		backgroundColor: "#030712",
	});

	const dollyAnim = CameraAnimation.camera().dolly({
		fromDistance: -2400,
		toDistance: -1200,
		start: 0,
		end: 30,
		ease: "power2.inOut",
	});

	compDolly.add(
		Layer.camera({
			id: "main-cam",
			x: 640,
			y: 360,
			z: -1800,
			targetX: 640,
			targetY: 360,
			targetZ: 0,
			animation: dollyAnim,
		}),
	);

	// Deep backdrop
	compDolly.add(
		Layer.box({
			id: "deep-grid",
			is3D: true,
			z: 1200,
			x: 240,
			y: 110,
			width: 800,
			height: 500,
			borderRadius: 24,
			background: "#1e1b4b",
		}),
	);

	// Midground Card
	compDolly.add(
		Layer.box({
			id: "mid-card",
			is3D: true,
			z: 200,
			x: 390,
			y: 210,
			width: 500,
			height: 300,
			borderRadius: 16,
			background: "#4338ca",
		}),
	);

	// Foreground Hero Card
	compDolly.add(
		Layer.box({
			id: "hero-card",
			is3D: true,
			z: -300,
			x: 490,
			y: 260,
			width: 300,
			height: 200,
			borderRadius: 12,
			background: "#06b6d4",
		}),
	);

	const dollyBuffer = await compDolly.renderFrame({ frame: 20 });
	await fs.writeFile(
		path.join(artifactDir, "3d_camera_dolly.png"),
		dollyBuffer,
	);
	await fs.writeFile(path.join(assetsDir, "3d_camera_dolly.png"), dollyBuffer);
	console.log("   Saved: 3d_camera_dolly.png");

	// 2. Orbit Turntable Composition
	console.log("Rendering 2: 3D Orbit Turntable...");
	const compOrbit = new Composition({
		width: 1280,
		height: 720,
		fps: 30,
		durationMs: 2000,
		backgroundColor: "#080c14",
	});

	const orbitAnim = CameraAnimation.camera().orbit({
		azimuth: { from: -45, to: 45 },
		elevation: { from: 15, to: 15 },
		radius: { to: 1600 },
		start: 0,
		end: 30,
		ease: "none",
	});

	compOrbit.add(
		Layer.camera({
			id: "orbit-cam",
			targetX: 640,
			targetY: 360,
			targetZ: 0,
			animation: orbitAnim,
		}),
	);

	// Central tilted element
	compOrbit.add(
		Layer.box({
			id: "tilted-center",
			is3D: true,
			z: 0,
			x: 440,
			y: 210,
			width: 400,
			height: 300,
			rotateX: 10,
			rotateY: -25,
			borderRadius: 20,
			background: "#8b5cf6",
		}),
	);

	const orbitBuffer = await compOrbit.renderFrame({ frame: 22 });
	await fs.writeFile(
		path.join(artifactDir, "3d_camera_orbit.png"),
		orbitBuffer,
	);
	await fs.writeFile(path.join(assetsDir, "3d_camera_orbit.png"), orbitBuffer);
	console.log("   Saved: 3d_camera_orbit.png");

	// 3. Cinematic Depth of Field (DoF) Bokeh Composition
	console.log("Rendering 3: Depth of Field (DoF) Bilateral Bokeh...");
	const compDof = new Composition({
		width: 1280,
		height: 720,
		fps: 30,
		durationMs: 2000,
		backgroundColor: "#020617",
	});

	compDof.add(
		Layer.camera({
			id: "dof-cam",
			x: 640,
			y: 360,
			z: -1600,
			targetX: 640,
			targetY: 360,
			targetZ: 0,
			dof: {
				enabled: true,
				focusDistance: 1200, // Focused sharply on subject at z = -400 (distance = 1200)
				fStop: 1.2,
				maxBlurRadius: 36,
			},
		}),
	);

	// Sharp Subject Card
	compDof.add(
		Layer.box({
			id: "sharp-subject",
			is3D: true,
			z: -400,
			x: 390,
			y: 210,
			width: 280,
			height: 300,
			borderRadius: 16,
			background: "#f59e0b", // Amber
		}),
	);

	// Blurred Deep Background Card
	compDof.add(
		Layer.box({
			id: "blurred-bg",
			is3D: true,
			z: 900,
			x: 680,
			y: 160,
			width: 360,
			height: 400,
			borderRadius: 24,
			background: "#ec4899", // Pink
		}),
	);

	// Blurred Near Foreground Card
	compDof.add(
		Layer.box({
			id: "blurred-fg",
			is3D: true,
			z: -900,
			x: 220,
			y: 400,
			width: 240,
			height: 240,
			borderRadius: 16,
			background: "#06b6d4", // Cyan
		}),
	);

	const dofBuffer = await compDof.renderFrame({ frame: 0 });
	await fs.writeFile(path.join(artifactDir, "3d_camera_dof.png"), dofBuffer);
	await fs.writeFile(path.join(assetsDir, "3d_camera_dof.png"), dofBuffer);
	console.log("   Saved: 3d_camera_dof.png");

	console.log(
		"=== All 3D Camera Render Demonstrations Generated Successfully ===",
	);
}

main().catch((err) => {
	console.error("Render failed:", err);
	process.exit(1);
});
