import {
	CameraAnimation,
	Composition,
	FilmGrain,
	Layer,
	Layer3D,
	LayerAnimation,
	Vignette,
} from "framefields";
import {
	ACCENT,
	BG,
	DURATION,
	FLOOR_COLOR,
	FLOOR_Y,
	FONT_DISPLAY,
	FONT_MONO,
	FPS,
	H,
	HEAT_COLD,
	HEAT_HOT,
	HEAT_INCANDESCENT,
	HEAT_WARM,
	registerFonts,
	SHARD_BASE,
	TEXT_MAIN,
	TEXT_MUTED,
	W,
} from "./theme.js";

export { DURATION };

/**
 * 3D Camera motion:
 * Sweeping orbit around the vortex with a low swoop near the reflective floor plane.
 */
function camera() {
	const half = Math.round(DURATION * 0.45);
	const cameraAnim = CameraAnimation.camera()
		.fromTo("orbitAzimuth", -48, 65, {
			from: 0,
			to: DURATION,
			ease: "sine.inOut",
		})
		.fromTo("orbitElevation", 24, 11, {
			from: 0,
			to: half,
			ease: "power2.out",
		})
		.fromTo("orbitElevation", 11, 26, {
			from: half,
			to: DURATION,
			ease: "power2.inOut",
		})
		.fromTo("orbitRadius", 1850, 1380, {
			from: 0,
			to: half,
			ease: "power2.out",
		})
		.fromTo("orbitRadius", 1380, 1720, {
			from: half,
			to: DURATION,
			ease: "power2.in",
		});

	return Layer.camera({
		id: "main-camera",
		mode: "orbit",
		targetX: 0,
		targetY: 85,
		targetZ: 0,
		lens: {
			focalLength: 50,
			sensorWidth: 36,
			near: 1,
			far: 20000,
			zoom: 1,
			fov: 44,
		},
		animation: cameraAnim,
	});
}

/**
 * Procedural shard variations generated with Fibonacci half-space clipping.
 */
function createShardVariants() {
	return [
		Layer3D.shard({
			radius: 22,
			facets: 12,
			irregularity: 0.35,
			seed: 101,
			color: SHARD_BASE,
			roughness: 0.32,
			metallic: 0.25,
		}),
		Layer3D.shard({
			radius: 30,
			facets: 16,
			irregularity: 0.48,
			seed: 202,
			color: SHARD_BASE,
			roughness: 0.28,
			metallic: 0.3,
		}),
		Layer3D.shard({
			radius: 17,
			facets: 10,
			irregularity: 0.28,
			seed: 303,
			color: SHARD_BASE,
			roughness: 0.38,
			metallic: 0.2,
		}),
		Layer3D.shard({
			radius: 36,
			facets: 18,
			irregularity: 0.52,
			seed: 404,
			color: SHARD_BASE,
			roughness: 0.3,
			metallic: 0.28,
		}),
		Layer3D.shard({
			radius: 25,
			facets: 14,
			irregularity: 0.4,
			seed: 505,
			color: SHARD_BASE,
			roughness: 0.34,
			metallic: 0.22,
		}),
		Layer3D.shard({
			radius: 19,
			facets: 12,
			irregularity: 0.44,
			seed: 606,
			color: SHARD_BASE,
			roughness: 0.36,
			metallic: 0.2,
		}),
	];
}

/**
 * 2D HUD and cinematic typography overlays.
 */
function hudOverlay() {
	const titleAnim = LayerAnimation.create()
		.fadeIn(0, 24, "power2.out")
		.fromTo("y", 30, 0, { from: 0, to: 28, ease: "power3.out" });

	const telemetryAnim = LayerAnimation.create().fadeIn(15, 30, "power2.out");

	return [
		// Top-left title card
		Layer.flex({
			id: "hud-title",
			position: "absolute",
			x: 90,
			y: 75,
			dir: "column",
			gap: 8,
			animation: titleAnim,
			children: [
				Layer.text("SHARD STORM", {
					id: "title-text",
					fontSize: 48,
					fontFamily: FONT_DISPLAY,
					fontWeight: 800,
					fill: TEXT_MAIN,
					letterSpacing: 2,
				}),
				Layer.text("REAL-TIME WebGPU 3D KINETIC SIMULATION", {
					id: "subtitle-text",
					fontSize: 13,
					fontFamily: FONT_MONO,
					fontWeight: 500,
					fill: TEXT_MUTED,
					letterSpacing: 4,
				}),
			],
		}),

		// Top-right telemetry stats badge
		Layer.flex({
			id: "hud-telemetry",
			position: "absolute",
			x: W - 460,
			y: 80,
			dir: "column",
			gap: 6,
			animation: telemetryAnim,
			children: [
				Layer.flex({
					id: "telemetry-row-1",
					dir: "row",
					gap: 12,
					children: [
						Layer.box({
							id: "indicator-dot",
							width: 8,
							height: 8,
							borderRadius: 4,
							background: ACCENT,
							y: 5,
						}),
						Layer.text("VORTEX 880 RPM // COULOMB μ 0.76", {
							id: "stat-1",
							fontSize: 12,
							fontFamily: FONT_MONO,
							fontWeight: 600,
							fill: TEXT_MAIN,
							letterSpacing: 1.5,
						}),
					],
				}),
				Layer.text("SHARDS 750 // CONTACT HEAT BLOOM // 60 FPS", {
					id: "stat-2",
					fontSize: 11,
					fontFamily: FONT_MONO,
					fill: TEXT_MUTED,
					letterSpacing: 1.5,
				}),
			],
		}),

		// Bottom subtle credit line
		Layer.flex({
			id: "hud-footer",
			position: "absolute",
			x: 90,
			y: H - 75,
			dir: "row",
			gap: 20,
			animation: telemetryAnim,
			children: [
				Layer.text("FRAMEFIELDS 3D ENGINE", {
					id: "footer-brand",
					fontSize: 11,
					fontFamily: FONT_MONO,
					fontWeight: 700,
					fill: ACCENT,
					letterSpacing: 2,
				}),
				Layer.text("//", {
					id: "footer-sep",
					fontSize: 11,
					fontFamily: FONT_MONO,
					fill: TEXT_MUTED,
				}),
				Layer.text("PLANAR GLOSSY FLOOR PASS // ANISOTROPIC ROUGHNESS BLUR", {
					id: "footer-desc",
					fontSize: 11,
					fontFamily: FONT_MONO,
					fill: TEXT_MUTED,
					letterSpacing: 1.5,
				}),
			],
		}),
	];
}

/**
 * Builds the complete Shard Storm composition.
 */
export async function buildFilm(): Promise<Composition> {
	await registerFonts();

	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: BG,
		fonts: ["assets/fonts/Syne.ttf", "assets/fonts/JetBrainsMono.ttf"],
	});

	// 1. Camera
	comp.add(camera());

	// 2. Physically-based environment with glossy planar floor reflection
	comp.add(
		Layer.environment("night", {
			exposure: 0.32,
			rotation: 20,
			bloom: {
				intensity: 0.78,
				threshold: 1.35,
				radius: 8,
			},
			floor: {
				y: FLOOR_Y,
				color: FLOOR_COLOR,
				reflectivity: 0.88,
				roughness: 0.22,
				fadeDistance: 1350,
				opacity: 1.0,
			},
		}),
	);

	// 3. Cinematic 3D lights
	comp.add([
		Layer.directionalLight({
			x: 650,
			y: -1300,
			z: -850,
			targetX: 0,
			targetY: 100,
			targetZ: 0,
			color: "#e4e0f4",
			intensity: 2.3,
			castShadow: true,
			shadowSoftness: 1.4,
		}),
		Layer.pointLight({
			x: -720,
			y: 120,
			z: -320,
			color: "#ff2266",
			intensity: 1.8,
		}),
		Layer.ambientLight({
			color: "#181524",
			intensity: 0.45,
		}),
	]);

	// 4. GPU 3D Swarm of procedural shards with vortex and floor friction
	const shardVariants = createShardVariants();
	comp.add(
		Layer3D.swarm({
			id: "shard-vortex-swarm",
			max: 750,
			seed: 42,
			prewarm: 2,
			mesh: shardVariants,
			size: [14, 28],
			sizeJitter: 0.55,
			lifetime: [4.5, 7.0],
			emitter: {
				shape: "ring",
				radius: 340,
				height: 340,
				rate: 230,
				y: -80,
			},
			gravity: [0, 540, 0],
			drag: 0.38,
			speed: [50, 200],
			noise: {
				strength: 270,
				scale: 190,
				speed: 0.32,
			},
			vortex: {
				swirl: 880,
				pull: 240,
				axial: -170,
				axis: [0, 1, 0],
			},
			floor: {
				y: FLOOR_Y,
				friction: 1.8,
				heatGain: 1.4,
				heatDecay: 0.45,
			},
			heat: {
				source: "both",
				maxSpeed: 1000,
				color: [HEAT_COLD, HEAT_WARM, HEAT_HOT, HEAT_INCANDESCENT],
				intensity: 5.8,
			},
			sparks: {
				rate: 550,
				speed: [80, 290],
				lifetime: [0.6, 1.3],
				color: ["#ffffff", "#ff8833", "#ff1166"],
			},
		}),
	);

	// 5. 2D HUD and typography
	comp.add(hudOverlay());

	// 6. Cinematic grading & grain
	comp.apply(new Vignette({ strength: 0.18, radius: 0.9, softness: 0.75 }));
	comp.apply(new FilmGrain({ strength: 0.035, size: 1.2, animated: true }));

	return comp;
}
