/**
 * Act III — AUTONOMOUS CODE → 3D REALITY (8.0s – 12.0s · 132 frames)
 * A floating 3D brushed-obsidian glass IDE stands over the mirror floor while
 * live JetBrains Mono code streams at light speed. A curved luminous
 * `Layer3D.tube` data beam connects the screen to a sculptural iridescent
 * `Layer3D.sdf` gyroid-sphere manifold materializing beside it in real time.
 * On Bar 5 (local frame 66 = global frame 300), the build passes with an
 * acid-lime verification pulse (840 TOK/S · 0.08s TTFT) and the SDF blooms.
 */
import { Layer, Layer3D, LayerAnimation, type LayoutNode } from "framefields";
import { buildCameraRig } from "../camera-rig.js";
import { actHeader, cornerTicks, floorShockwave } from "../hud.js";
import { computeMusicalEnergy } from "../score.js";
import { NEON_FIELD_WGSL } from "../shaders/neon-field.js";
import {
	FONT_MONO,
	FONT_SANS,
	H,
	PALETTE,
	pulseAt,
	SCENE_DURATIONS,
	SCENE_STARTS,
	W,
} from "../theme.js";

const DUR = SCENE_DURATIONS.agentic;
const PASS_FRAME = 66; // Global frame 300 (Bar 5)

const IDE_X = -320;
const IDE_Y = -335;
const IDE_W = 680;
const IDE_H = 420;

const SDF_X = 355;
const SDF_Y = -335;
const SDF_Z = -40;

interface CodeLineSpec {
	readonly text: string;
	readonly color: string;
	readonly at: number;
}

const CODE_LINES: readonly CodeLineSpec[] = [
	{ text: "$ neon build --target webgpu --verify", color: PALETTE.cyan, at: 8 },
	{ text: "const core = Layer3D.sdf({", color: PALETTE.white, at: 18 },
	{
		text: '  primitives: [{ shape: "gyroid", scale: 52 },',
		color: PALETTE.slate,
		at: 26,
	},
	{
		text: '    { shape: "sphere", op: "intersect", r: 175 }],',
		color: PALETTE.slate,
		at: 34,
	},
	{ text: "  iridescence: 1.0, clearcoat: 1.0,", color: "#C594FF", at: 42 },
	{ text: '  emissive: "#00F0FF", resolution: 72', color: "#FF7CC4", at: 50 },
	{
		text: "}); // 14,820 tris synthesized in 0.08s",
		color: PALETTE.dimSlate,
		at: 58,
	},
];

/** Builds the live 3D glassmorphic terminal / IDE panel standing in 3D space. */
function floatingIde(): LayoutNode[] {
	const screenChildren: LayoutNode[] = [
		// Window chrome header bar.
		Layer.box({
			id: "s3-ide-bar",
			position: "absolute",
			x: 0,
			y: 0,
			width: IDE_W,
			height: 46,
			background: "rgba(18, 26, 46, 0.92)",
			children: [
				Layer.shape("circle", {
					id: "s3-dot-1",
					position: "absolute",
					x: 20,
					y: 17,
					width: 12,
					height: 12,
					fill: PALETTE.magenta,
				}),
				Layer.shape("circle", {
					id: "s3-dot-2",
					position: "absolute",
					x: 40,
					y: 17,
					width: 12,
					height: 12,
					fill: PALETTE.cyan,
				}),
				Layer.shape("circle", {
					id: "s3-dot-3",
					position: "absolute",
					x: 60,
					y: 17,
					width: 12,
					height: 12,
					fill: PALETTE.lime,
				}),
				Layer.text("gemini-4-neon · agentic-compiler.ts", {
					id: "s3-ide-title",
					position: "absolute",
					x: 92,
					y: 13,
					width: 520,
					fontFamily: FONT_MONO,
					fontSize: 16,
					fontWeight: 500,
					fill: PALETTE.slate,
				}),
			],
		}),
		// Streaming code lines revealed sequentially with wipe mattes.
		...CODE_LINES.map((line, i) => {
			const y = 74 + i * 36;
			return Layer.text(line.text, {
				id: `s3-code-${i}`,
				position: "absolute",
				x: 28,
				y,
				width: IDE_W - 56,
				fontFamily: FONT_MONO,
				fontSize: 19,
				fontWeight: i === 0 ? 700 : 500,
				fill: line.color,
				opacity: 0,
			}).animate(
				LayerAnimation.create()
					.keys("opacity", [
						[line.at, 0],
						[line.at + 6, 1, "power2.out"],
					])
					.keys("x", [
						[line.at, 44],
						[line.at + 10, 28, "expo.out"],
					]),
			) as LayoutNode;
		}),
		// Progress fill bar racing to 100% right at PASS_FRAME.
		Layer.box({
			id: "s3-prog-track",
			position: "absolute",
			x: 28,
			y: 332,
			width: IDE_W - 56,
			height: 6,
			borderRadius: 3,
			background: "rgba(255, 255, 255, 0.1)",
			children: [
				Layer.box({
					id: "s3-prog-fill",
					position: "absolute",
					x: 0,
					y: 0,
					width: 10,
					height: 6,
					borderRadius: 3,
					background: "linear-gradient(90deg, #00F0FF, #C8FF00)",
				}).animate(
					LayerAnimation.keys("width", [
						[10, 12],
						[PASS_FRAME, IDE_W - 56, "expo.inOut"],
					]),
				) as LayoutNode,
			],
		}),
		// Acid-lime PASS verification pill locking in on Bar 5 (frame 66).
		Layer.box({
			id: "s3-pass-pill",
			position: "absolute",
			x: 28,
			y: 354,
			width: IDE_W - 56,
			height: 46,
			borderRadius: 10,
			background: "rgba(200, 255, 0, 0.14)",
			borderWidth: 1.5,
			borderColor: PALETTE.lime,
			opacity: 0,
			children: [
				Layer.text("VERIFIED PASS  ·  840 TOK/S  ·  0.08s TTFT", {
					id: "s3-pass-text",
					position: "absolute",
					x: 0,
					y: 12,
					width: IDE_W - 56,
					align: "center",
					fontFamily: FONT_MONO,
					fontSize: 18,
					fontWeight: 700,
					letterSpacing: 1.8,
					fill: PALETTE.lime,
				}),
			],
		}).animate(
			LayerAnimation.create()
				.keys("opacity", [
					[PASS_FRAME - 2, 0],
					[PASS_FRAME + 6, 1, "expo.out"],
				])
				.keys("scale", [
					[PASS_FRAME - 2, 0.94],
					[PASS_FRAME + 8, 1.0, "back.out(1.6)"],
				]),
		) as LayoutNode,
	];

	// Dark metallic chassis behind the screen plane.
	const chassis = Layer3D.roundedBox({
		id: "s3-ide-chassis",
		x: IDE_X,
		y: IDE_Y,
		z: 18,
		width: IDE_W + 24,
		height: IDE_H + 24,
		depth: 22,
		radius: 16,
		rotateY: 16,
		color: "#0C1120",
		metallic: 0.92,
		roughness: 0.22,
		clearcoat: 1,
		emissive: PALETTE.sapphire,
		emissiveIntensity: 0.22,
		castShadow: true,
	}).animate(
		LayerAnimation.keys("y", [
			[0, IDE_Y + 90],
			[22, IDE_Y, "expo.out"],
			[DUR - 1, IDE_Y - 12, "sine.inOut"],
		]),
	) as LayoutNode;

	// Live screen plane mounted 2 px in front of the chassis (-z faces camera).
	const screen = Layer3D.plane({
		id: "s3-ide-screen",
		x: IDE_X - IDE_W / 2,
		y: IDE_Y - IDE_H / 2,
		z: 4,
		width: IDE_W,
		height: IDE_H,
		rotateY: 16,
		background: "rgba(6, 10, 20, 0.94)",
		borderRadius: 14,
		material: "unlit",
		children: screenChildren,
	}).animate(
		LayerAnimation.keys("y", [
			[0, IDE_Y - IDE_H / 2 + 90],
			[22, IDE_Y - IDE_H / 2, "expo.out"],
			[DUR - 1, IDE_Y - IDE_H / 2 - 12, "sine.inOut"],
		]),
	) as LayoutNode;

	return [chassis, screen];
}

/** Live sculpted 3D SDF gyroid-crystal manifold synthesized beside the IDE. */
function synthesizedSdfSculpture(): LayoutNode[] {
	// Outer sculpted obsidian-sapphire gyroid shell with deep carved architectural tunnels and iridescent metallic clearcoat.
	const sculpture = Layer3D.sdf({
		id: "s3-sdf-manifold",
		x: SDF_X,
		y: SDF_Y,
		z: SDF_Z,
		bounds: [370, 370, 370],
		resolution: 76,
		primitives: [
			{ shape: "sphere", radius: 168, color: "#122248" },
			{
				shape: "gyroid",
				op: "intersect",
				scale: 88,
				thickness: 22,
				smoothness: 5,
				color: "#1275B8",
			},
			{
				shape: "torus",
				op: "union",
				radius: 158,
				tube: 14,
				rotation: [58, 25, 0],
				smoothness: 14,
				color: "#B41F84",
			},
			{
				shape: "torus",
				op: "union",
				radius: 158,
				tube: 11,
				rotation: [-45, -35, 20],
				smoothness: 12,
				color: "#00B8D4",
			},
		],
		metallic: 0.9,
		roughness: 0.22,
		clearcoat: 0.85,
		clearcoatRoughness: 0.12,
		iridescence: { intensity: 1, thickness: 500, ior: 1.48 },
		emissive: PALETTE.sapphire,
		emissiveIntensity: 0.05,
		castShadow: true,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.14],
				[20, 0.62, "power2.out"],
				[PASS_FRAME, 1.05, "expo.out"],
				[PASS_FRAME + 14, 1.0, "sine.out"],
			])
			.keys("rotateY", [
				[0, -45],
				[DUR - 1, 145, "none"],
			])
			.keys("rotateX", [
				[0, 12],
				[DUR - 1, -18, "sine.inOut"],
			])
			.keys("emissiveIntensity", [
				[0, 0.04],
				[PASS_FRAME - 2, 0.08],
				[PASS_FRAME + 4, 0.32, "expo.out"],
				[DUR - 1, 0.12, "sine.out"],
			]),
	) as LayoutNode;

	// Compact glowing energy pearl nested INSIDE the gyroid tunnels so cyan light radiates outward through the carvings!
	const innerCore = Layer3D.sphere({
		id: "s3-sdf-inner-core",
		x: SDF_X,
		y: SDF_Y,
		z: SDF_Z,
		radius: 42,
		color: PALETTE.iceCyan,
		emissive: PALETTE.cyan,
		emissiveIntensity: 1.2,
		castShadow: false,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.2],
				[PASS_FRAME, 1.15, "expo.out"],
				[DUR - 1, 0.95, "sine.out"],
			])
			.keys("emissiveIntensity", [
				[0, 0.8],
				[PASS_FRAME + 3, 3.6, "expo.out"],
				[DUR - 1, 2.0, "sine.out"],
			]),
	) as LayoutNode;

	// Holographic wireframe bounding cage surrounding the SDF while compiling.
	const cage = Layer3D.icosahedron({
		id: "s3-sdf-cage",
		x: SDF_X,
		y: SDF_Y,
		z: SDF_Z,
		radius: 215,
		detail: 1,
		wireframe: true,
		color: PALETTE.cyan,
		material: "unlit",
		emissive: PALETTE.cyan,
		emissiveIntensity: 1.4,
		castShadow: false,
	}).animate(
		LayerAnimation.create()
			.keys("rotateY", [
				[0, 0],
				[DUR - 1, -90, "none"],
			])
			.keys("opacity", [
				[0, 0.72],
				[PASS_FRAME - 4, 0.72],
				[PASS_FRAME + 14, 0.14, "power2.out"],
			]),
	) as LayoutNode;

	// Double-helix curved neon fiber beams flowing from the IDE directly into the SDF core.
	const beamPointsA: Array<[number, number, number]> = Array.from(
		{ length: 28 },
		(_, k) => {
			const t = k / 27;
			const x = IDE_X + 310 + (SDF_X - 130 - (IDE_X + 310)) * t;
			const y = IDE_Y + 25 * (1 - t) - Math.sin(t * Math.PI * 2) * 72;
			const z = 10 * (1 - t) + SDF_Z * t - Math.sin(t * Math.PI) * 120;
			return [x, y, z];
		},
	);
	const beamPointsB: Array<[number, number, number]> = Array.from(
		{ length: 28 },
		(_, k) => {
			const t = k / 27;
			const x = IDE_X + 310 + (SDF_X - 130 - (IDE_X + 310)) * t;
			const y = IDE_Y - 15 * (1 - t) + Math.sin(t * Math.PI * 2) * 58;
			const z = 10 * (1 - t) + SDF_Z * t - Math.sin(t * Math.PI) * 90;
			return [x, y, z];
		},
	);
	const beamA = Layer3D.tube({
		id: "s3-code-beam",
		points: beamPointsA,
		radius: 3.0,
		tubularSegments: 64,
		radialSegments: 8,
		color: PALETTE.cyan,
		material: "unlit",
		emissive: PALETTE.cyan,
		emissiveIntensity: 1.6,
		castShadow: false,
	}).animate(
		LayerAnimation.keys("emissiveIntensity", [
			[0, 1.0],
			[PASS_FRAME, 3.0, "expo.out"],
			[DUR - 1, 1.6, "sine.out"],
		]),
	) as LayoutNode;

	const beamB = Layer3D.tube({
		id: "s3-code-beam-b",
		points: beamPointsB,
		radius: 2.0,
		tubularSegments: 64,
		radialSegments: 8,
		color: PALETTE.magenta,
		material: "unlit",
		emissive: PALETTE.magenta,
		emissiveIntensity: 1.4,
		castShadow: false,
	}).animate(
		LayerAnimation.keys("emissiveIntensity", [
			[0, 0.8],
			[PASS_FRAME, 2.6, "expo.out"],
			[DUR - 1, 1.3, "sine.out"],
		]),
	) as LayoutNode;

	return [sculpture, innerCore, cage, beamA, beamB];
}

export function scene3Agentic(): LayoutNode {
	const backdrop = Layer.shader({
		id: "s3-wgsl-backdrop",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: 0,
		durationFrames: DUR,
		uniforms: {
			phase: 5.1,
			magentaMix: 0.72,
			horizon: 0.85,
			intensity: 0.84,
			energy: (ctx) => computeMusicalEnergy(SCENE_STARTS.agentic + ctx.frame),
			flare: (ctx) => pulseAt(ctx.frame, PASS_FRAME, 14) * 0.9,
			raySpin: (ctx) => 1.6 - ctx.frame * 0.02,
		},
		fragment: NEON_FIELD_WGSL,
	}) as LayoutNode;

	const camera = buildCameraRig({
		id: "s3-camera",
		duration: DUR,
		baseFov: 37,
		stations: [
			{
				at: 0,
				eye: [-420, -350, -1620],
				look: [-30, -330, 0],
				roll: -2,
				snap: 0.65,
			},
			{
				at: 50,
				eye: [-120, -390, -1460],
				look: [30, -330, 0],
				roll: 0,
				snap: 0.75,
			},
			{
				at: PASS_FRAME + 12,
				eye: [240, -350, -1410],
				look: [110, -330, -20],
				roll: 2.2,
				snap: 0.8,
			},
			{
				at: DUR - 1,
				eye: [420, -410, -1520],
				look: [140, -330, -20],
				roll: 1.5,
				snap: 0.4,
			},
		],
		hits: [{ at: PASS_FRAME, amount: 22, frames: 14, fovKick: 4.5 }],
		motionBlur: { shutter: 130, samples: 16 },
	});

	const stage3d = Layer.box({
		id: "s3-3d-stage",
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
				id: "s3-env",
				exposure: 0.18,
				toneMapping: "agx",
				fog: { color: PALETTE.void, start: 1900, end: 8000 },
				bloom: { intensity: 0.24, threshold: 1.55, radius: 5 },
				floor: {
					y: 0,
					color: PALETTE.floor,
					reflectivity: 0.84,
					roughness: 0.13,
					fadeDistance: 2100,
					opacity: 0.94,
				},
			}) as LayoutNode,
			Layer.rectLight({
				id: "s3-top-softbox",
				x: -180,
				y: -1020,
				z: -560,
				targetX: 80,
				targetY: -330,
				targetZ: 0,
				width: 520,
				height: 160,
				color: "#DCEEFF",
				intensity: 1.35,
				radius: 3200,
				castShadow: true,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s3-cyan-key",
				x: SDF_X + 260,
				y: SDF_Y - 180,
				z: -260,
				color: PALETTE.cyan,
				intensity: 3.6,
				radius: 2200,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s3-mag-rim",
				x: SDF_X - 240,
				y: SDF_Y + 140,
				z: 240,
				color: PALETTE.magenta,
				intensity: 3.0,
				radius: 2200,
			}) as LayoutNode,
			...floatingIde(),
			...synthesizedSdfSculpture(),
			floorShockwave({
				id: "s3-pass-ring",
				at: PASS_FRAME,
				span: 44,
				x: SDF_X,
				z: SDF_Z,
				color: PALETTE.lime,
				maxScale: 19,
				intensity: 2.5,
			}),
		],
	}) as LayoutNode;

	const embers = Layer.particles({
		id: "s3-data-embers",
		x: 0,
		y: 0,
		width: W,
		height: H,
		max: 1800,
		seed: 303,
		startFrame: 0,
		durationFrames: DUR,
		prewarm: 1.5,
		emitter: {
			shape: "rect",
			x: 160,
			y: H - 140,
			width: W - 320,
			height: 120,
			rate: 240,
			bursts: [{ frame: PASS_FRAME, count: 420 }],
		},
		lifetime: [2.0, 3.6],
		speed: [40, 140],
		direction: -90,
		spread: 40,
		gravity: -25,
		drag: 0.6,
		noise: { strength: 90, scale: 180, speed: 0.45 },
		size: [5, 1.2],
		sizeJitter: 0.45,
		fade: [0.15, 0.35],
		shape: "soft",
		blend: "add",
		color: [PALETTE.cyan, PALETTE.lime, PALETTE.sapphire],
		opacity: 0.72,
	}) as LayoutNode;

	const footerChip = Layer.text(
		"AUTONOMOUS FULL-STACK GENERATION · LIVE WEBGPU VERIFICATION",
		{
			id: "s3-footer-chip",
			position: "absolute",
			x: 96,
			y: 964,
			width: 1120,
			fontFamily: FONT_SANS,
			fontSize: 20,
			fontWeight: 500,
			letterSpacing: 3.2,
			fill: PALETTE.slate,
			opacity: 0,
			startFrame: 0,
			durationFrames: DUR,
		},
	).animate(
		LayerAnimation.keys("opacity", [
			[14, 0],
			[28, 0.9, "power2.out"],
		]),
	) as LayoutNode;

	return Layer.box({
		id: "scene-3-agentic",
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
			embers,
			...cornerTicks("s3", DUR),
			actHeader({
				id: "s3-header",
				tag: "02 // AGENTIC EXECUTION",
				title: "CODE TO",
				accentWord: "REALITY.",
				x: 96,
				y: 76,
				enterAt: 4,
				duration: DUR,
				titleSize: 58,
			}),
			footerChip,
		],
	}) as LayoutNode;
}
