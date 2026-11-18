/**
 * Act I — THE NEON SINGULARITY (0.0s – 4.2s · 126 frames)
 * Opens in deep obsidian space over a glossy mirror floor. A sweeping studio
 * rect-light reveals the dark iridescent chrome silhouette of the sculpted
 * 4-point Gemini Star Prism. On Bar 1 (frame 60), the core ignites into
 * bioluminescent cyan & plasma magenta, sending a shockwave across the floor,
 * bursting GPU sparks, and revealing the monumental "GEMINI 4 NEON" title.
 */
import {
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
	TextAnimator,
} from "framefields";
import { buildCameraRig } from "../camera-rig.js";
import { cornerTicks, floorShockwave } from "../hud.js";
import { computeMusicalEnergy } from "../score.js";
import { NEON_FIELD_WGSL } from "../shaders/neon-field.js";
import { geminiStarFramePath, geminiStarPath } from "../star-geometry.js";
import {
	FONT_DISPLAY,
	FONT_MONO,
	H,
	PALETTE,
	pulseAt,
	SCENE_DURATIONS,
	smoothstep,
	W,
} from "../theme.js";

const DUR = SCENE_DURATIONS.ignition;
const IGNITE = 60;
const STAR_Y = -360;

function ignitionCamera(): LayoutNode {
	return buildCameraRig({
		id: "s1-camera",
		duration: DUR,
		baseFov: 36,
		stations: [
			{
				at: 0,
				eye: [-420, -140, -1720],
				look: [0, STAR_Y + 30, 0],
				roll: -4,
				snap: 0.7,
			},
			{
				at: 54,
				eye: [-110, -310, -1180],
				look: [0, STAR_Y + 10, 0],
				roll: -1.2,
				snap: 0.85,
			},
			{
				at: 74,
				eye: [240, -400, -1580],
				look: [0, STAR_Y + 40, 0],
				roll: 2.5,
				snap: 0.9,
			},
			{
				at: DUR - 1,
				eye: [420, -360, -1440],
				look: [0, STAR_Y + 60, 0],
				roll: 1.2,
				snap: 0.4,
			},
		],
		hits: [{ at: IGNITE, amount: 34, frames: 20, fovKick: 8 }],
		motionBlur: { shutter: 140, samples: 16 },
	});
}

function starPrismAssembly(): LayoutNode[] {
	// Outer sculpted obsidian chrome star with glowing cyan beveled walls.
	const prismBody = Layer3D.extrude({
		id: "s1-star-body",
		d: geminiStarPath(248, 0.17),
		depth: 56,
		bevelThickness: 16,
		bevelSize: 14,
		bevelSegments: 4,
		x: 0,
		y: STAR_Y,
		z: 0,
		color: "#090E1C",
		bevelColor: PALETTE.cyan,
		metallic: 0.96,
		roughness: 0.12,
		clearcoat: 1,
		clearcoatRoughness: 0.05,
		iridescence: { intensity: 0.9, thickness: 460, ior: 1.4 },
		castShadow: true,
	}).animate(
		LayerAnimation.create()
			.keys("rotateY", [
				[0, -42],
				[IGNITE, 8, "power2.inOut"],
				[DUR - 1, 52, "sine.out"],
			])
			.keys("rotateX", [
				[0, 14],
				[IGNITE, -6, "sine.inOut"],
				[DUR - 1, 6, "sine.inOut"],
			])
			.keys("scale", [
				[0, 0.84],
				[IGNITE - 2, 0.94, "power2.in"],
				[IGNITE + 6, 1.08, "back.out(1.6)"],
				[DUR - 1, 1.0, "sine.out"],
			]),
	) as LayoutNode;

	// Luminous outer rim frame tracing the exact 4-point contour.
	const neonRim = Layer3D.extrude({
		id: "s1-star-rim",
		d: geminiStarFramePath(264, 232, 0.17),
		depth: 18,
		bevelThickness: 3,
		bevelSize: 3,
		bevelSegments: 2,
		x: 0,
		y: STAR_Y,
		z: 0,
		color: PALETTE.cyan,
		emissive: PALETTE.cyan,
		emissiveIntensity: 0.6,
		castShadow: false,
	}).animate(
		LayerAnimation.create()
			.keys("rotateY", [
				[0, -42],
				[IGNITE, 8, "power2.inOut"],
				[DUR - 1, 52, "sine.out"],
			])
			.keys("rotateX", [
				[0, 14],
				[IGNITE, -6, "sine.inOut"],
				[DUR - 1, 6, "sine.inOut"],
			])
			.keys("emissiveIntensity", [
				[0, 0.55],
				[IGNITE - 3, 1.15, "power2.in"],
				[IGNITE + 2, 3.2, "expo.out"],
				[IGNITE + 24, 2.0, "power2.out"],
				[DUR - 1, 1.85, "sine.inOut"],
			]),
	) as LayoutNode;

	// Compact incandescent plasma core nested cleanly inside the sculpted star prism.
	const core = Layer3D.icosphere({
		id: "s1-star-core",
		radius: 34,
		detail: 2,
		x: 0,
		y: STAR_Y,
		z: 0,
		color: PALETTE.white,
		emissive: PALETTE.magenta,
		emissiveIntensity: 0.5,
		castShadow: false,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.55],
				[IGNITE - 2, 0.78, "power2.in"],
				[IGNITE + 4, 1.25, "expo.out"],
				[IGNITE + 22, 0.95, "power2.out"],
				[DUR - 1, 1.0, "sine.inOut"],
			])
			.keys("emissiveIntensity", [
				[0, 0.4],
				[IGNITE - 2, 1.1, "power2.in"],
				[IGNITE + 2, 3.2, "expo.out"],
				[DUR - 1, 1.8, "sine.out"],
			]),
	) as LayoutNode;

	// Three counter-rotating precision orbital rings.
	const rings: LayoutNode[] = [
		{
			id: "s1-ring-a",
			r: 345,
			tube: 4.2,
			color: PALETTE.cyan,
			rx: 68,
			ry0: -20,
			ry1: 110,
			rz: 18,
		},
		{
			id: "s1-ring-b",
			r: 430,
			tube: 3.4,
			color: PALETTE.violet,
			rx: -56,
			ry0: 40,
			ry1: -95,
			rz: -24,
		},
		{
			id: "s1-ring-c",
			r: 525,
			tube: 2.6,
			color: PALETTE.sapphire,
			rx: 78,
			ry0: 15,
			ry1: 135,
			rz: 6,
		},
	].map(
		(cfg, idx) =>
			Layer3D.torus({
				id: cfg.id,
				x: 0,
				y: STAR_Y,
				z: 0,
				radius: cfg.r,
				tube: cfg.tube,
				tubularSegments: 140,
				radialSegments: 12,
				rotateX: cfg.rx,
				rotateZ: cfg.rz,
				color: "#111A2E",
				metallic: 0.95,
				roughness: 0.14,
				emissive: cfg.color,
				emissiveIntensity: 0.4,
				castShadow: false,
			}).animate(
				LayerAnimation.create()
					.keys("rotateY", [
						[0, cfg.ry0],
						[DUR - 1, cfg.ry1, "sine.inOut"],
					])
					.keys("emissiveIntensity", [
						[0, 0.3],
						[IGNITE - 2, 0.7, "power2.in"],
						[IGNITE + 4 + idx * 3, 2.3, "expo.out"],
						[DUR - 1, 1.35, "sine.out"],
					]),
			) as LayoutNode,
	);

	return [prismBody, neonRim, core, ...rings];
}

function ignitionLights(): LayoutNode[] {
	// Sweeping keynote highlight bar gliding across the chrome facets before ignition.
	const sweepLight = Layer.rectLight({
		id: "s1-sweep-rect",
		x: -900,
		y: -760,
		z: -620,
		targetX: 0,
		targetY: STAR_Y,
		targetZ: 0,
		width: 480,
		height: 160,
		color: "#D8EEFF",
		intensity: 3.4,
		radius: 3600,
		castShadow: true,
	}).animate(
		LayerAnimation.keys("x", [
			[0, -950],
			[IGNITE, 850, "sine.inOut"],
			[DUR - 1, 220, "sine.out"],
		]),
	) as LayoutNode;

	const cyanRim = Layer.pointLight({
		id: "s1-cyan-rim",
		x: -560,
		y: -520,
		z: 360,
		color: PALETTE.cyan,
		intensity: 1.2,
		radius: 2600,
	}).animate(
		LayerAnimation.keys("intensity", [
			[0, 0.9],
			[IGNITE - 2, 1.4],
			[IGNITE + 3, 6.2, "expo.out"],
			[DUR - 1, 3.8, "sine.out"],
		]),
	) as LayoutNode;

	const magentaRim = Layer.pointLight({
		id: "s1-magenta-rim",
		x: 560,
		y: -240,
		z: 280,
		color: PALETTE.magenta,
		intensity: 0.8,
		radius: 2400,
	}).animate(
		LayerAnimation.keys("intensity", [
			[0, 0.7],
			[IGNITE - 2, 1.1],
			[IGNITE + 4, 5.4, "expo.out"],
			[DUR - 1, 3.2, "sine.out"],
		]),
	) as LayoutNode;

	return [sweepLight, cyanRim, magentaRim];
}

function ignitionTypography(): LayoutNode[] {
	// Subtle pre-ignition system ping.
	const preTag = Layer.text("NEXT-GEN REASONING ARCHITECTURE", {
		id: "s1-pre-tag",
		position: "absolute",
		x: 0,
		y: 916,
		width: W,
		align: "center",
		fontFamily: FONT_MONO,
		fontSize: 20,
		fontWeight: 500,
		letterSpacing: 7,
		fill: PALETTE.slate,
		opacity: 0,
		startFrame: 0,
		durationFrames: IGNITE + 4,
	}).animate(
		LayerAnimation.keys("opacity", [
			[8, 0],
			[22, 0.85, "power2.out"],
			[50, 0.85],
			[IGNITE, 0, "power2.in"],
		]),
	) as LayoutNode;

	// Post-ignition eyebrow near top safe margin.
	const introTag = Layer.text("INTRODUCING", {
		id: "s1-intro-tag",
		position: "absolute",
		x: 0,
		y: 78,
		width: W,
		align: "center",
		fontFamily: FONT_MONO,
		fontSize: 22,
		fontWeight: 600,
		letterSpacing: 11,
		fill: PALETTE.cyan,
		opacity: 0,
		startFrame: 0,
		durationFrames: DUR,
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[IGNITE + 2, 0],
				[IGNITE + 14, 1, "power2.out"],
			])
			.keys("y", [
				[IGNITE + 2, 94],
				[IGNITE + 18, 78, "expo.out"],
			]),
	) as LayoutNode;

	// Monumental "GEMINI 4 NEON" lockup at lower third, clear of the 3D star prism.
	const geminiWord = Layer.text("GEMINI 4", {
		id: "s1-title-gemini",
		fontFamily: FONT_DISPLAY,
		fontSize: 136,
		fontWeight: 800,
		fontVariations: { wdth: 112 },
		letterSpacing: 4,
		fill: PALETTE.white,
		animators: [
			TextAnimator.waveRise({
				y: 36,
				rotationX: 32,
				opacity: 0,
				blur: 8,
				easing: "expo.in",
			}),
		],
	}).animate(
		LayerAnimation.create().kineticSweep(
			-1,
			1,
			IGNITE + 2,
			IGNITE + 24,
			"power2.out",
		),
	) as LayoutNode;

	const neonWord = Layer.text("NEON", {
		id: "s1-title-neon",
		fontFamily: FONT_DISPLAY,
		fontSize: 136,
		fontWeight: 300,
		fontVariations: { wdth: 118 },
		letterSpacing: 32,
		fill: PALETTE.cyan,
		opacity: 0,
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[IGNITE + 6, 0],
				[IGNITE + 18, 1, "power2.out"],
			])
			.keys("letterSpacing", [
				[IGNITE + 6, 36],
				[IGNITE + 32, 8, "expo.out"],
			]),
	) as LayoutNode;

	const titleRow = Layer.flex({
		id: "s1-title-row",
		position: "absolute",
		x: 0,
		y: 808,
		width: W,
		height: 170,
		dir: "row",
		justify: "center",
		align: "end",
		gap: 34,
		startFrame: 0,
		durationFrames: DUR,
		children: [geminiWord, neonWord],
	}) as LayoutNode;

	return [preTag, introTag, titleRow];
}

export function scene1Ignition(): LayoutNode {
	const backdrop = Layer.shader({
		id: "s1-wgsl-backdrop",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: 0,
		durationFrames: DUR,
		uniforms: {
			phase: 0.4,
			magentaMix: 0.8,
			horizon: 1.0,
			intensity: (ctx) => 0.55 + 0.55 * smoothstep(40, 72, ctx.frame),
			energy: (ctx) => computeMusicalEnergy(ctx.frame),
			flare: (ctx) => pulseAt(ctx.frame, IGNITE, 16) * 1.15,
			raySpin: (ctx) => ctx.frame * 0.025,
		},
		fragment: NEON_FIELD_WGSL,
	}) as LayoutNode;

	// Dedicated 3D scene box over the WGSL caustic backdrop.
	const stage3d = Layer.box({
		id: "s1-3d-stage",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "transparent",
		startFrame: 0,
		durationFrames: DUR,
		children: [
			ignitionCamera(),
			Layer.environment("night", {
				id: "s1-env",
				exposure: -0.15,
				toneMapping: "agx",
				fog: { color: PALETTE.void, start: 1800, end: 8500 },
				bloom: { intensity: 0.24, threshold: 1.55, radius: 5 },
				floor: {
					y: 0,
					color: PALETTE.floor,
					reflectivity: 0.86,
					roughness: 0.12,
					fadeDistance: 2200,
					opacity: 0.94,
				},
			}).animate(
				LayerAnimation.keys("exposure", [
					[0, -0.3],
					[IGNITE - 2, -0.05, "sine.in"],
					[IGNITE + 4, 0.35, "expo.out"],
					[DUR - 1, 0.15, "sine.out"],
				]),
			) as LayoutNode,
			...ignitionLights(),
			...starPrismAssembly(),
			floorShockwave({
				id: "s1-shockwave-cyan",
				at: IGNITE,
				span: 52,
				color: PALETTE.cyan,
				maxScale: 24,
				intensity: 2.8,
			}),
			floorShockwave({
				id: "s1-shockwave-magenta",
				at: IGNITE + 5,
				span: 46,
				color: PALETTE.magenta,
				maxScale: 18,
				intensity: 2.4,
			}),
		],
	}) as LayoutNode;

	// Fine additive GPU particle sparks radiating cleanly from the star's outer halo (behind the 3D star so its silhouette stays razor sharp).
	const sparks = Layer.particles({
		id: "s1-sparks",
		x: 0,
		y: 0,
		width: W,
		height: H,
		max: 3200,
		seed: 104,
		startFrame: 0,
		durationFrames: DUR,
		emitter: {
			shape: "ring",
			x: W * 0.5,
			y: H * 0.43,
			radius: 195,
			radial: true,
			rate: (f) => (f >= IGNITE ? 160 : 25),
			bursts: [{ frame: IGNITE, count: 680 }],
		},
		lifetime: [1.1, 2.3],
		speed: [180, 740],
		drag: 1.8,
		gravity: -25,
		noise: { strength: 140, scale: 220, speed: 0.5 },
		size: [3.8, 0.9],
		sizeJitter: 0.5,
		fade: [0.06, 0.4],
		shape: "spark",
		stretch: 0.04,
		blend: "add",
		color: [PALETTE.white, PALETTE.cyan, PALETTE.sapphire, PALETTE.magenta],
		colorBySpeed: 540,
		opacity: 0.85,
	}) as LayoutNode;

	return Layer.box({
		id: "scene-1-ignition",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: PALETTE.void,
		overflow: "hidden",
		children: [
			backdrop,
			sparks,
			stage3d,
			...cornerTicks("s1", DUR),
			...ignitionTypography(),
		],
	}) as LayoutNode;
}
