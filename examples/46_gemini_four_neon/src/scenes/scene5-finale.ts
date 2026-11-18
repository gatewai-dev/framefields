/**
 * Act V — SWARM CONVERGENCE & MONUMENTAL HERO END CARD (16.0s – 20.0s · 126 frames)
 * 1,500 luminous neon shards lift off a vast dark mirror field and arc along
 * graceful 3D trajectories into the exact faceted geometry of the 4-Point
 * Gemini Star. On Bar 8.5 (local frame 36 = global frame 510), the star locks
 * with a harmonic cyan-sapphire-magenta bloom flare, an expanding mirror floor
 * shockwave, a specular left-to-right metallic glint (frame 81), and the
 * monumental "GEMINI 4 NEON" lockup held proudly over a gentle camera drift.
 */
import { Layer, Layer3D, LayerAnimation, type LayoutNode } from "framefields";
import { buildCameraRig } from "../camera-rig.js";
import { cornerTicks, floorShockwave } from "../hud.js";
import { computeMusicalEnergy } from "../score.js";
import { NEON_FIELD_WGSL } from "../shaders/neon-field.js";
import { type StarSlot, sampleGeminiStarSlots } from "../star-geometry.js";
import {
	clamp01,
	easeInOutCubic,
	FONT_DISPLAY,
	FONT_MONO,
	FONT_SANS,
	H,
	hash,
	lerp,
	PALETTE,
	pulseAt,
	SCENE_DURATIONS,
	SCENE_STARTS,
	W,
} from "../theme.js";

const DUR = SCENE_DURATIONS.finale;
const STAR_LOCK = 36; // Global frame 510 (Bar 8.5)
const GLINT_FRAME = 81; // Global frame 555 (Bar 9.25)
const SHARD_COUNT = 1500;
const STAR_Y = -430;
const STAR_RADIUS = 250;

interface SwarmPiece {
	readonly startX: number;
	readonly startY: number;
	readonly startZ: number;
	readonly slot: StarSlot;
	readonly arcHeight: number;
	readonly sideSwing: number;
	readonly baseScale: number;
	readonly seed: number;
}

function buildSwarmPieces(): SwarmPiece[] {
	const slots = sampleGeminiStarSlots(SHARD_COUNT, STAR_RADIUS, 44);
	return slots.map((slot, i) => {
		const angle = hash(i, 31) * Math.PI * 2;
		const dist = 480 + 1350 * Math.sqrt(hash(i, 37));
		return {
			startX: Math.cos(angle) * dist,
			startY: -22 - hash(i, 41) * 140,
			startZ: Math.sin(angle) * dist * 0.85,
			slot,
			arcHeight: 160 + hash(i, 43) * 340,
			sideSwing: (hash(i, 47) - 0.5) * 420,
			baseScale:
				slot.rim > 0.9 ? 0.56 + 0.25 * hash(i, 53) : 0.45 + 0.35 * hash(i, 59),
			seed: hash(i, 61),
		};
	});
}

/** 1,500-shard 3D swarm converging into the glowing 4-point Gemini Star. */
function convergingGeminiStar(): LayoutNode {
	const pieces = buildSwarmPieces();
	const mesh = Layer3D.shard({
		radius: 13,
		facets: 10,
		irregularity: 0.22,
		seed: 88,
		color: "#FFFFFF",
		metallic: 0.85,
		roughness: 0.15,
	});
	const tObj = {
		x: 0,
		y: 0,
		z: 0,
		scale: 1,
		rotation: [0, 0, 0] as [number, number, number],
		color: [1, 1, 1, 1] as [number, number, number, number],
		emissive: [0, 0, 0] as [number, number, number],
		emissiveIntensity: 0,
	};

	return Layer3D.instances({
		id: "s5-star-swarm",
		mesh,
		count: SHARD_COUNT,
		material: "lit",
		metallic: 0.88,
		roughness: 0.14,
		clearcoat: 1,
		iridescence: 0.85,
		instanceAt: (i, frame) => {
			const p = pieces[i];
			if (!p) return undefined;

			// Staggered arrival completing tightly right at STAR_LOCK (frame 36).
			const startF = p.slot.order * 12;
			const flightDur = Math.max(14, STAR_LOCK - startF);
			const u = clamp01((frame - startF) / flightDur);
			const e = easeInOutCubic(u);
			const arc = Math.sin(Math.PI * u);

			// Gentle proud 3D hover rotation once locked.
			const postAngle =
				frame > STAR_LOCK ? Math.sin((frame - STAR_LOCK) * 0.032) * 0.22 : 0;
			const ca = Math.cos(postAngle);
			const sa = Math.sin(postAngle);
			const tx = p.slot.x * ca - p.slot.z * sa;
			const tz = p.slot.x * sa + p.slot.z * ca;
			const ty =
				STAR_Y +
				p.slot.y +
				(frame > STAR_LOCK ? Math.sin(frame * 0.06 + p.seed * 6) * 4 : 0);

			tObj.x = lerp(p.startX, tx, e) + p.sideSwing * arc;
			tObj.y = lerp(p.startY, ty, e) - p.arcHeight * arc;
			tObj.z = lerp(p.startZ, tz, e) - 180 * arc;

			// Lock flare + sweeping metallic glint across X at GLINT_FRAME.
			const lockFlare = pulseAt(frame, STAR_LOCK, 9);
			const glintT = (frame - GLINT_FRAME) / 22;
			const glintX = lerp(-STAR_RADIUS * 1.3, STAR_RADIUS * 1.3, glintT);
			const glintHit =
				glintT >= -0.2 && glintT <= 1.2
					? Math.exp(-(((tx - glintX) / 68) ** 2))
					: 0;

			tObj.scale =
				p.baseScale * (0.75 + 0.25 * e + 0.28 * lockFlare + 0.22 * glintHit);
			tObj.rotation[0] = (1 - e) * (360 * p.seed + frame * 5) + p.seed * 35;
			tObj.rotation[1] =
				(1 - e) * (240 * p.seed - frame * 4) + postAngle * 57.3;
			tObj.rotation[2] = (1 - e) * 180 * p.seed;

			// Smooth jewel-like cyan → sapphire → plasma magenta gradient across the faceted star.
			const sp = clamp01(p.slot.spectrum);
			let r =
				sp < 0.5 ? lerp(0.02, 0.2, sp * 2) : lerp(0.2, 0.92, (sp - 0.5) * 2);
			let g =
				sp < 0.5 ? lerp(0.88, 0.48, sp * 2) : lerp(0.48, 0.16, (sp - 0.5) * 2);
			let b = sp < 0.5 ? 0.98 : lerp(0.98, 0.62, (sp - 0.5) * 2);

			const whiteFlash = clamp01(lockFlare * 0.42 + glintHit * 0.44);
			r = lerp(r, 1.0, whiteFlash);
			g = lerp(g, 1.0, whiteFlash);
			b = lerp(b, 1.0, whiteFlash);

			tObj.color[0] = r;
			tObj.color[1] = g;
			tObj.color[2] = b;
			tObj.emissive[0] = r;
			tObj.emissive[1] = g;
			tObj.emissive[2] = b;
			// Controlled emission so individual crystal facets stay crisp rather than clipping white!
			tObj.emissiveIntensity =
				(p.slot.rim > 0.85 ? 0.78 : 0.26) + lockFlare * 1.2 + glintHit * 1.05;
			return tObj;
		},
	}) as LayoutNode;
}

/** Monumental "GEMINI 4 NEON" end card below the hovering star. */
function heroEndCard(): LayoutNode[] {
	const nameAt = STAR_LOCK + 6;
	const subAt = STAR_LOCK + 18;

	const gemini = Layer.text("GEMINI 4", {
		id: "s5-name-gemini",
		fontFamily: FONT_DISPLAY,
		fontSize: 132,
		fontWeight: 800,
		fontVariations: { wdth: 112 },
		letterSpacing: 34,
		fill: PALETTE.white,
		opacity: 0,
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[nameAt, 0],
				[nameAt + 12, 1, "power2.out"],
			])
			.keys("letterSpacing", [
				[nameAt, 34],
				[nameAt + 24, 4, "expo.out"],
			]),
	) as LayoutNode;

	const neon = Layer.text("NEON", {
		id: "s5-name-neon",
		fontFamily: FONT_DISPLAY,
		fontSize: 132,
		fontWeight: 300,
		fontVariations: { wdth: 118 },
		letterSpacing: 42,
		fill: PALETTE.cyan,
		opacity: 0,
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[nameAt + 4, 0],
				[nameAt + 16, 1, "power2.out"],
			])
			.keys("letterSpacing", [
				[nameAt + 4, 42],
				[nameAt + 28, 10, "expo.out"],
			]),
	) as LayoutNode;

	const titleRow = Layer.flex({
		id: "s5-name-row",
		position: "absolute",
		x: 0,
		y: 716,
		width: W,
		height: 150,
		dir: "row",
		justify: "center",
		align: "end",
		gap: 36,
		startFrame: 0,
		durationFrames: DUR,
		children: [gemini, neon],
	}) as LayoutNode;

	// Centered gradient hairline rule expanding outward on lock.
	const rule = Layer.box({
		id: "s5-rule",
		position: "absolute",
		x: W / 2 - 260,
		y: 874,
		width: 520,
		height: 2,
		background:
			"linear-gradient(90deg, transparent, #00F0FF 35%, #FF2E93 65%, transparent)",
		scaleX: 0.01,
		opacity: 0,
		startFrame: 0,
		durationFrames: DUR,
	}).animate(
		LayerAnimation.create()
			.keys("scaleX", [
				[subAt - 4, 0.01],
				[subAt + 16, 1, "expo.out"],
			])
			.keys("opacity", [
				[subAt - 4, 0],
				[subAt + 6, 1, "power2.out"],
			]),
	) as LayoutNode;

	const tagline = Layer.text("THINK DEEPER.  BUILD AT LIGHT SPEED.", {
		id: "s5-tagline",
		position: "absolute",
		x: 0,
		y: 904,
		width: W,
		align: "center",
		fontFamily: FONT_SANS,
		fontSize: 27,
		fontWeight: 500,
		letterSpacing: 7.5,
		fill: "#DCE7FF",
		opacity: 0,
		startFrame: 0,
		durationFrames: DUR,
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[subAt, 0],
				[subAt + 14, 1, "power2.out"],
			])
			.keys("y", [
				[subAt, 922],
				[subAt + 18, 904, "expo.out"],
			]),
	) as LayoutNode;

	const credit = Layer.text("NATIVE WEBGPU · FRAMEFIELDS", {
		id: "s5-credit",
		position: "absolute",
		x: 0,
		y: 984,
		width: W,
		align: "center",
		fontFamily: FONT_MONO,
		fontSize: 16,
		fontWeight: 500,
		letterSpacing: 5,
		fill: "#8DA6CF",
		opacity: 0,
		startFrame: 0,
		durationFrames: DUR,
	}).animate(
		LayerAnimation.keys("opacity", [
			[subAt + 8, 0],
			[subAt + 22, 0.9, "power2.out"],
		]),
	) as LayoutNode;

	return [titleRow, rule, tagline, credit];
}

export function scene5Finale(): LayoutNode {
	const backdrop = Layer.shader({
		id: "s5-wgsl-backdrop",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: 0,
		durationFrames: DUR,
		uniforms: {
			phase: 9.8,
			magentaMix: 0.9,
			horizon: 1.0,
			intensity: 0.95,
			energy: (ctx) => computeMusicalEnergy(SCENE_STARTS.finale + ctx.frame),
			flare: (ctx) =>
				pulseAt(ctx.frame, STAR_LOCK, 18) * 1.45 +
				pulseAt(ctx.frame, GLINT_FRAME, 12) * 0.45,
			raySpin: (ctx) => 0.4 + ctx.frame * 0.014,
		},
		fragment: NEON_FIELD_WGSL,
	}) as LayoutNode;

	const camera = buildCameraRig({
		id: "s5-camera",
		duration: DUR,
		baseFov: 36,
		stations: [
			{
				at: 0,
				eye: [0, -680, -1820],
				look: [0, STAR_Y + 60, 0],
				roll: 5,
				snap: 0.65,
			},
			{
				at: STAR_LOCK,
				eye: [0, -350, -1480],
				look: [0, STAR_Y + 95, 0],
				roll: 0,
				snap: 0.85,
			},
			{
				at: DUR - 1,
				eye: [0, -370, -1720],
				look: [0, STAR_Y + 110, 0],
				roll: 0,
				snap: 0.15,
			},
		],
		hits: [{ at: STAR_LOCK, amount: 30, frames: 18, fovKick: 7 }],
		motionBlur: { shutter: 135, samples: 16 },
	});

	// Compact radiant core nested deep inside the converged star.
	const coreHalo = Layer3D.sphere({
		id: "s5-core-halo",
		x: 0,
		y: STAR_Y,
		z: 18,
		radius: 26,
		color: PALETTE.white,
		emissive: PALETTE.cyan,
		emissiveIntensity: 0.2,
		castShadow: false,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[0, 0.1],
				[STAR_LOCK - 2, 0.4, "power2.in"],
				[STAR_LOCK + 3, 1.45, "expo.out"],
				[STAR_LOCK + 24, 0.9, "power2.out"],
				[DUR - 1, 0.95, "sine.inOut"],
			])
			.keys("emissiveIntensity", [
				[0, 0.2],
				[STAR_LOCK - 2, 0.8],
				[STAR_LOCK + 3, 3.0, "expo.out"],
				[DUR - 1, 1.2, "sine.out"],
			]),
	) as LayoutNode;

	const stage3d = Layer.box({
		id: "s5-3d-stage",
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
				id: "s5-env",
				exposure: 0.14,
				toneMapping: "agx",
				fog: { color: PALETTE.void, start: 2000, end: 9000 },
				bloom: { intensity: 0.25, threshold: 1.5, radius: 5 },
				floor: {
					y: 0,
					color: PALETTE.floor,
					reflectivity: 0.88,
					roughness: 0.1,
					fadeDistance: 2400,
					opacity: 0.95,
				},
			}) as LayoutNode,
			Layer.directionalLight({
				id: "s5-key",
				x: -500,
				y: -1100,
				z: -800,
				targetX: 0,
				targetY: STAR_Y,
				targetZ: 0,
				color: "#F0F8FF",
				intensity: 1.9,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s5-cyan-rim",
				x: -460,
				y: STAR_Y - 120,
				z: -240,
				color: PALETTE.cyan,
				intensity: 3.4,
				radius: 2600,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s5-mag-rim",
				x: 460,
				y: STAR_Y + 80,
				z: -200,
				color: PALETTE.magenta,
				intensity: 3.0,
				radius: 2600,
			}) as LayoutNode,
			coreHalo,
			convergingGeminiStar(),
			floorShockwave({
				id: "s5-lock-ring-cyan",
				at: STAR_LOCK,
				span: 56,
				color: PALETTE.cyan,
				maxScale: 26,
				intensity: 2.8,
			}),
			floorShockwave({
				id: "s5-lock-ring-mag",
				at: STAR_LOCK + 6,
				span: 50,
				color: PALETTE.magenta,
				maxScale: 20,
				intensity: 2.3,
			}),
		],
	}) as LayoutNode;

	// Rising starlight dust around the converged emblem.
	const starDust = Layer.particles({
		id: "s5-stardust",
		x: 0,
		y: 0,
		width: W,
		height: H,
		max: 2400,
		seed: 505,
		startFrame: 0,
		durationFrames: DUR,
		emitter: {
			shape: "ring",
			x: W * 0.5,
			y: H * 0.36,
			radius: 170,
			radial: true,
			rate: (f) => (f >= STAR_LOCK ? 180 : 60),
			bursts: [{ frame: STAR_LOCK, count: 900 }],
		},
		lifetime: [1.4, 3.0],
		speed: [90, 440],
		drag: 1.5,
		gravity: -30,
		noise: { strength: 130, scale: 200, speed: 0.4 },
		size: [5.5, 1.2],
		sizeJitter: 0.5,
		fade: [0.08, 0.38],
		shape: "soft",
		blend: "add",
		color: [PALETTE.white, PALETTE.cyan, PALETTE.sapphire, PALETTE.magenta],
		opacity: 0.85,
	}) as LayoutNode;

	return Layer.box({
		id: "scene-5-finale",
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
			starDust,
			...cornerTicks("s5", DUR),
			...heroEndCard(),
		],
	}) as LayoutNode;
}
