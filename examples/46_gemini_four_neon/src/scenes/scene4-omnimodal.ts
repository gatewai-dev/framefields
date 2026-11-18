/**
 * Act IV — OMNI-MODAL & PHYSICAL WORLD INTELLIGENCE (12.0s – 16.0s · 132 frames)
 * An iridescent obsidian crystalline monolith hovers over the mirror floor.
 * On Bar 6.5 (local frame 36 = global frame 390), a blazing neon plasma
 * projectile strikes it — `Physics.world3d` + `world.fracture` shatters the
 * monolith into 48 rigid shards with luminous cyan interiors that explode
 * outward, tumble through 3D gravity, and bounce across the mirror floor,
 * accompanied by a GPU `Layer3D.swarm` spark cascade and a live audio-driven
 * omni-modal spectrum dock.
 */
import {
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	Physics,
} from "framefields";
import { buildCameraRig } from "../camera-rig.js";
import { actHeader, cornerTicks, floorShockwave } from "../hud.js";
import { computeMusicalEnergy } from "../score.js";
import { NEON_FIELD_WGSL } from "../shaders/neon-field.js";
import {
	FONT_MONO,
	FPS,
	H,
	PALETTE,
	pulseAt,
	SCENE_DURATIONS,
	SCENE_STARTS,
	W,
} from "../theme.js";

const DUR = SCENE_DURATIONS.omnimodal;
const SHATTER = 36; // Global frame 390 (Bar 6.5)
const MONOLITH_Y = -345;

/** Live 24-bar audio-reactive spectrum equalizer + 4 modality badges at bottom safe area. */
function omnimodalDock(): LayoutNode {
	const modalities = [
		{ label: "VISION", color: PALETTE.cyan, at: 8 },
		{ label: "AUDIO", color: PALETTE.sapphire, at: 18 },
		{ label: "3D SPACE", color: PALETTE.violet, at: 28 },
		{ label: "PHYSICS", color: PALETTE.magenta, at: SHATTER },
	];

	const pills: LayoutNode[] = modalities.map(
		(m, i) =>
			Layer.box({
				id: `s4-pill-${i}`,
				width: 158,
				height: 44,
				borderRadius: 22,
				background: "rgba(12, 18, 34, 0.84)",
				borderWidth: 1.5,
				borderColor: m.color,
				opacity: 0,
				children: [
					Layer.text(m.label, {
						id: `s4-pill-txt-${i}`,
						position: "absolute",
						x: 0,
						y: 11,
						width: 158,
						align: "center",
						fontFamily: FONT_MONO,
						fontSize: 16,
						fontWeight: 700,
						letterSpacing: 2.2,
						fill: PALETTE.white,
					}),
				],
			}).animate(
				LayerAnimation.create()
					.keys("opacity", [
						[m.at, 0],
						[m.at + 8, 1, "power2.out"],
					])
					.keys("scale", [
						[m.at, 0.82],
						[m.at + 10, 1.0, "back.out(1.6)"],
					]),
			) as LayoutNode,
	);

	// 24 animated equalizer bars synced to our synthesized score's energy envelope.
	const barCount = 24;
	const bars: LayoutNode[] = Array.from({ length: barCount }, (_, idx) => {
		const keys: Array<[number, number, string]> = [];
		const centerWeight = 1 - Math.abs(idx / (barCount - 1) - 0.5) * 1.1;
		for (let f = 0; f < DUR; f += 2) {
			const e = computeMusicalEnergy(SCENE_STARTS.omnimodal + f);
			const harmonic =
				0.5 +
				0.5 * Math.sin(f * 0.42 + idx * 0.65) * Math.cos(f * 0.21 - idx * 0.35);
			const shatterBoost = pulseAt(f, SHATTER, 14) * 0.9;
			const h = Math.round(
				10 + (e * 34 + harmonic * 18 + shatterBoost * 24) * centerWeight,
			);
			keys.push([f, Math.min(62, Math.max(8, h)), "none"]);
		}
		const barColor =
			idx < 8 ? PALETTE.cyan : idx < 16 ? PALETTE.sapphire : PALETTE.magenta;
		return Layer.box({
			id: `s4-eq-${idx}`,
			width: 8,
			height: 16,
			borderRadius: 4,
			background: barColor,
		}).animate(LayerAnimation.create().keys("height", keys)) as LayoutNode;
	});

	return Layer.box({
		id: "s4-dock",
		position: "absolute",
		x: 180,
		y: 920,
		width: W - 360,
		height: 88,
		borderRadius: 20,
		background: "rgba(6, 10, 22, 0.78)",
		borderWidth: 1.5,
		borderColor: PALETTE.glassBorder,
		startFrame: 0,
		durationFrames: DUR,
		children: [
			Layer.flex({
				id: "s4-pills-row",
				position: "absolute",
				x: 28,
				y: 22,
				width: 720,
				height: 44,
				dir: "row",
				align: "center",
				gap: 16,
				children: pills,
			}),
			Layer.flex({
				id: "s4-eq-row",
				position: "absolute",
				x: 820,
				y: 12,
				width: 700,
				height: 64,
				dir: "row",
				justify: "center",
				align: "center",
				gap: 12,
				children: bars,
			}),
		],
	}) as LayoutNode;
}

export async function scene4Omnimodal(): Promise<LayoutNode> {
	// 3D deterministic rigid-body physics world (runs on this 3D scene's local clock 0..131).
	const world = await Physics.world3d({
		fps: FPS,
		frames: DUR,
		gravity: 1380,
		substeps: 4,
	});
	world.ground({ y: 0 });

	// Hero crystalline monolith fractured into 48 obsidian-and-cyan Voronoi pieces!
	// Note: scale stays rigid (unanimated) as required by Physics.fracture.
	const monolith = Layer3D.icosahedron({
		id: "s4-monolith",
		x: 0,
		y: MONOLITH_Y,
		z: 0,
		radius: 196,
		detail: 1,
		flatShaded: true,
		color: "#0C1428",
		metallic: 0.94,
		roughness: 0.14,
		clearcoat: 1,
		clearcoatRoughness: 0.05,
		iridescence: { intensity: 0.95, thickness: 480, ior: 1.42 },
		castShadow: true,
	}).animate(
		LayerAnimation.keys("rotateY", [
			[0, 0],
			[SHATTER, 68, "none"],
		]),
	);

	world.fracture(monolith, {
		cells: 48,
		seed: 14,
		fractureFrame: SHATTER,
		impactPoint: [-110, MONOLITH_Y - 10, -70],
		explosionSpeed: 700,
		spin: 280,
		interiorColor: PALETTE.cyan,
		interiorRoughness: 0.16,
		restitution: 0.44,
		friction: 0.55,
	});

	world.simulate();

	// Blazing neon plasma projectile streaking into the monolith right on frame 36!
	const projectile = Layer3D.sphere({
		id: "s4-plasma-orb",
		x: -1400,
		y: MONOLITH_Y - 80,
		z: -360,
		radius: 30,
		color: PALETTE.white,
		emissive: PALETTE.magenta,
		emissiveIntensity: 6.2,
		castShadow: false,
		startFrame: 16,
		durationFrames: SHATTER - 12,
	}).animate(
		LayerAnimation.create()
			.keys("x", [
				[0, -1400],
				[SHATTER - 16, -65, "expo.in"],
				[SHATTER - 13, 180, "none"],
			])
			.keys("y", [
				[0, MONOLITH_Y - 80],
				[SHATTER - 16, MONOLITH_Y, "power2.in"],
			])
			.keys("z", [
				[0, -360],
				[SHATTER - 16, -40, "power2.in"],
			])
			.keys("opacity", [
				[0, 1],
				[SHATTER - 16, 1],
				[SHATTER - 13, 0],
			]),
	) as LayoutNode;

	// GPU-simulated 3D micro-shard & spark swarm erupting on Voronoi impact.
	const shardSwarm = Layer3D.swarm({
		id: "s4-shatter-swarm",
		max: 650,
		seed: 404,
		substeps: 4,
		mesh: { type: "shard", variants: 6, facets: 10, irregularity: 0.42 },
		emitter: {
			shape: "sphere",
			x: 0,
			y: MONOLITH_Y,
			z: 0,
			radius: 130,
			rate: 0,
			bursts: [{ frame: SHATTER, count: 480 }],
		},
		lifetime: [2.2, 3.8],
		speed: [220, 880],
		size: [15, 7],
		sizeJitter: 0.45,
		fade: [0.05, 0.25],
		gravity: [0, 1250, 0],
		drag: 0.45,
		vortex: {
			x: 0,
			y: MONOLITH_Y,
			z: 0,
			axis: [0, 1, 0],
			swirl: 240,
			pull: -80,
			radius: 600,
		},
		noise: { strength: 160, scale: 260, speed: 0.7 },
		floor: {
			y: 0,
			bounce: 0.48,
			friction: 0.85,
			heatGain: 1.4,
			heatDecay: 0.65,
		},
		angularSpeed: [140, 420],
		color: ["#0E1730", PALETTE.sapphire, PALETTE.cyan, PALETTE.violet],
		heat: {
			source: "both",
			maxSpeed: 760,
			color: [PALETTE.sapphire, PALETTE.cyan, PALETTE.magenta, PALETTE.white],
			intensity: 3.6,
			curve: 1.5,
		},
		sparks: {
			max: 900,
			rate: 360,
			threshold: 0.35,
			speed: [180, 460],
			lifetime: [0.22, 0.55],
			size: [1.8, 3.2],
			stretch: 0.055,
			color: [PALETTE.cyan, PALETTE.magenta, PALETTE.white],
			intensity: 2.2,
		},
		material: "lit",
		metallic: 0.82,
		roughness: 0.18,
	}) as LayoutNode;

	// Orbital precision reticle rings framing the monolith before shatter.
	const reticle = Layer3D.torus({
		id: "s4-reticle",
		x: 0,
		y: MONOLITH_Y,
		z: 0,
		radius: 290,
		tube: 3,
		tubularSegments: 128,
		radialSegments: 8,
		rotateX: 74,
		color: PALETTE.cyan,
		material: "unlit",
		emissive: PALETTE.cyan,
		emissiveIntensity: 2.2,
		castShadow: false,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.85],
				[SHATTER - 1, 1.0, "sine.inOut"],
				[SHATTER + 18, 2.6, "expo.out"],
			])
			.keys("opacity", [
				[0, 0.75],
				[SHATTER, 0.9],
				[SHATTER + 22, 0, "power2.out"],
			]),
	) as LayoutNode;

	const camera = buildCameraRig({
		id: "s4-camera",
		duration: DUR,
		baseFov: 38,
		stations: [
			{
				at: 0,
				eye: [-340, -340, -1420],
				look: [0, MONOLITH_Y + 20, 0],
				roll: -2.5,
				snap: 0.6,
			},
			{
				at: SHATTER - 2,
				eye: [-180, -380, -1240],
				look: [0, MONOLITH_Y + 15, 0],
				roll: -1,
				snap: 0.75,
			},
			{
				at: SHATTER + 30,
				eye: [460, -240, -1480],
				look: [40, -210, 0],
				roll: 4.5,
				snap: 0.85,
			},
			{
				at: DUR - 1,
				eye: [760, -320, -1620],
				look: [60, -180, 0],
				roll: 2,
				snap: 0.4,
			},
		],
		hits: [{ at: SHATTER, amount: 42, frames: 22, fovKick: 10 }],
		motionBlur: { shutter: 165, samples: 20 },
	});

	const backdrop = Layer.shader({
		id: "s4-wgsl-backdrop",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: 0,
		durationFrames: DUR,
		uniforms: {
			phase: 7.4,
			magentaMix: 1.05,
			horizon: 0.9,
			intensity: 0.9,
			energy: (ctx) => computeMusicalEnergy(SCENE_STARTS.omnimodal + ctx.frame),
			flare: (ctx) => pulseAt(ctx.frame, SHATTER, 18) * 1.35,
			raySpin: (ctx) => 2.4 + ctx.frame * 0.03,
		},
		fragment: NEON_FIELD_WGSL,
	}) as LayoutNode;

	const stage3d = Layer.box({
		id: "s4-3d-stage",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "transparent",
		startFrame: 0,
		durationFrames: DUR,
		children: [
			camera,
			Layer.environment("night", {
				id: "s4-env",
				exposure: 0.22,
				toneMapping: "agx",
				fog: { color: PALETTE.void, start: 1800, end: 8000 },
				bloom: { intensity: 0.26, threshold: 1.5, radius: 5 },
				floor: {
					y: 0,
					color: PALETTE.floor,
					reflectivity: 0.88,
					roughness: 0.11,
					fadeDistance: 2200,
					opacity: 0.95,
				},
			}) as LayoutNode,
			Layer.directionalLight({
				id: "s4-key",
				x: -600,
				y: -1200,
				z: -800,
				targetX: 0,
				targetY: -220,
				targetZ: 0,
				color: "#EEF7FF",
				intensity: 2.1,
				castShadow: true,
				shadowSoftness: 2.5,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s4-cyan-light",
				x: -420,
				y: -380,
				z: -240,
				color: PALETTE.cyan,
				intensity: 4.0,
				radius: 2600,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s4-mag-light",
				x: 480,
				y: -260,
				z: 240,
				color: PALETTE.magenta,
				intensity: 3.6,
				radius: 2600,
			}) as LayoutNode,
			monolith as LayoutNode,
			projectile,
			reticle,
			shardSwarm,
			floorShockwave({
				id: "s4-shock-cyan",
				at: SHATTER,
				span: 52,
				color: PALETTE.cyan,
				maxScale: 24,
				intensity: 2.8,
			}),
			floorShockwave({
				id: "s4-shock-mag",
				at: SHATTER + 4,
				span: 46,
				color: PALETTE.magenta,
				maxScale: 19,
				intensity: 2.4,
			}),
		],
	}) as LayoutNode;

	return Layer.box({
		id: "scene-4-omnimodal",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: PALETTE.void,
		overflow: "hidden",
		children: [
			backdrop,
			stage3d,
			...cornerTicks("s4", DUR),
			actHeader({
				id: "s4-header",
				tag: "03 // OMNI-MODAL & PHYSICS",
				title: "MODELS THE",
				accentWord: "PHYSICAL WORLD.",
				x: 96,
				y: 74,
				enterAt: 4,
				duration: DUR,
				titleSize: 54,
			}),
			omnimodalDock(),
		],
	}) as LayoutNode;
}
