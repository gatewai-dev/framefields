/**
 * Act II — DEEP REASONING & 10M TOKEN CONTEXT (4.0s – 8.0s · 132 frames)
 * A 2,000-shard 3D iridescent neural constellation (`Layer3D.instances`)
 * threaded with luminous `Layer3D.tube` synaptic light-highways morphs from
 * a swirling thought nebula into a locked crystalline tensor hypercube on
 * Bar 3 (local frame 66 = global frame 180), paired with a live 10M context
 * readout and native WebGPU reasoning curve chart (`Layer.chart`).
 */
import { Layer, Layer3D, LayerAnimation, type LayoutNode } from "framefields";
import { buildCameraRig } from "../camera-rig.js";
import { actHeader, cornerTicks, floorShockwave } from "../hud.js";
import { computeMusicalEnergy } from "../score.js";
import { NEON_FIELD_WGSL } from "../shaders/neon-field.js";
import {
	clamp01,
	easeInOutCubic,
	FONT_DISPLAY,
	FONT_MONO,
	H,
	hash,
	lerp,
	PALETTE,
	pulseAt,
	SCENE_DURATIONS,
	SCENE_STARTS,
	W,
} from "../theme.js";

const DUR = SCENE_DURATIONS.reasoning;
const LOCK = 66; // Global frame 180 (Bar 3)
const NODE_COUNT = 1800;
const CLUSTER_X = 330;
const CLUSTER_Y = -360;

interface NeuralCell {
	readonly sx: number;
	readonly sy: number;
	readonly sz: number;
	readonly gx: number;
	readonly gy: number;
	readonly gz: number;
	readonly phase: number;
	readonly hue: number;
	readonly scale: number;
}

function buildNeuralCells(): NeuralCell[] {
	const cells: NeuralCell[] = [];
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	// 12 x 10 x 15 = 1800 crystalline tensor lattice positions.
	const nx = 12;
	const ny = 10;
	const nz = 15;
	const pitch = 56;

	for (let i = 0; i < NODE_COUNT; i++) {
		// Phase A: Golden Fibonacci neural sphere-cloud.
		const yNorm = 1 - (i / (NODE_COUNT - 1)) * 2;
		const rAtY = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
		const theta = goldenAngle * i;
		const shellR = 300 + 230 * hash(i, 1);
		const sx = Math.cos(theta) * rAtY * shellR;
		const sy = yNorm * shellR * 0.82;
		const sz = Math.sin(theta) * rAtY * shellR;

		// Phase B: Locked precision crystalline tensor lattice.
		const ix = i % nx;
		const iy = Math.floor(i / nx) % ny;
		const iz = Math.floor(i / (nx * ny)) % nz;
		const gx = (ix - (nx - 1) / 2) * pitch;
		const gy = (iy - (ny - 1) / 2) * pitch;
		const gz = (iz - (nz - 1) / 2) * pitch;

		cells.push({
			sx,
			sy,
			sz,
			gx,
			gy,
			gz,
			phase: hash(i, 2) * Math.PI * 2,
			hue: hash(i, 3),
			scale: 0.42 + 0.52 * hash(i, 4),
		});
	}
	return cells;
}

function neuralConstellation(): LayoutNode {
	const cells = buildNeuralCells();
	const mesh = Layer3D.shard({
		radius: 9.5,
		facets: 10,
		irregularity: 0.25,
		seed: 42,
		color: "#FFFFFF",
		metallic: 0.85,
		roughness: 0.16,
	});
	const out = {
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
		id: "s2-neural-lattice",
		mesh,
		count: NODE_COUNT,
		material: "lit",
		metallic: 0.85,
		roughness: 0.16,
		clearcoat: 1.0,
		iridescence: 0.85,
		instanceAt: (i, frame) => {
			const c = cells[i];
			if (!c) return undefined;

			// Staggered morph from swirling sphere-cloud → locked hypercube around `LOCK`.
			const morphT = easeInOutCubic((frame - (LOCK - 22) - c.hue * 10) / 26);
			const spin = frame * 0.016 * (1 - morphT * 0.65);
			const cs = Math.cos(spin);
			const ss = Math.sin(spin);
			const rx = c.sx * cs - c.sz * ss;
			const rz = c.sx * ss + c.sz * cs;

			const lx = lerp(rx, c.gx, morphT);
			const ly = lerp(c.sy, c.gy, morphT);
			const lz = lerp(rz, c.gz, morphT);

			// Crisp narrow synaptic scan plane + harmonic wave across the locked lattice.
			const wave =
				0.5 + 0.5 * Math.sin(lx * 0.014 - frame * 0.24 + c.phase * 0.3);
			const scanX = lerp(-440, 440, clamp01((frame - (LOCK - 10)) / 30));
			const scanHit =
				frame >= LOCK - 10 && frame <= LOCK + 28
					? Math.exp(-(((lx - scanX) / 46) ** 2))
					: 0;
			const energy = clamp01(0.2 + 0.45 * wave + scanHit * 0.9);

			out.x = CLUSTER_X + lx;
			out.y =
				CLUSTER_Y +
				ly +
				Math.sin(frame * 0.08 + c.phase) * 8 * (1 - morphT * 0.5);
			out.z = lz;
			out.scale = c.scale * (0.88 + 0.34 * scanHit + 0.12 * morphT);
			out.rotation[0] = frame * 1.4 + c.phase * 57;
			out.rotation[1] = frame * 2.1 + c.hue * 360;
			out.rotation[2] = c.phase * 25;

			// Jewel-like obsidian-sapphire/cyan/magenta shards; narrow scan plane glints cyan-white.
			const isMagenta = c.hue > 0.72;
			const isCyan = c.hue < 0.34;
			const baseR = isMagenta ? 0.78 : isCyan ? 0.04 : 0.14;
			const baseG = isMagenta ? 0.14 : isCyan ? 0.76 : 0.38;
			const baseB = isMagenta ? 0.62 : 0.96;
			const r = lerp(baseR, 0.95, scanHit * 0.7);
			const g = lerp(baseG, 0.98, scanHit * 0.7);
			const b = lerp(baseB, 1.0, scanHit * 0.7);
			out.color[0] = r;
			out.color[1] = g;
			out.color[2] = b;
			out.emissive[0] = r;
			out.emissive[1] = g;
			out.emissive[2] = b;
			out.emissiveIntensity = 0.16 + energy * 0.55 + scanHit * 1.45;
			return out;
		},
	}) as LayoutNode;
}

/** Luminous fiber-optic synaptic tubes curving around the tensor lattice. */
function synapticPathways(): LayoutNode[] {
	const specs = [
		{ id: "s2-tube-0", color: PALETTE.cyan, r: 440, tilt: 0.4, phase: 0 },
		{
			id: "s2-tube-1",
			color: PALETTE.magenta,
			r: 480,
			tilt: -0.55,
			phase: 1.4,
		},
		{
			id: "s2-tube-2",
			color: PALETTE.sapphire,
			r: 410,
			tilt: 0.82,
			phase: 2.7,
		},
		{ id: "s2-tube-3", color: PALETTE.cyan, r: 510, tilt: -0.22, phase: 4.1 },
	];

	return specs.map((s, idx) => {
		const pts: Array<[number, number, number]> = [];
		for (let k = 0; k <= 36; k++) {
			const a = (k / 36) * Math.PI * 1.65 + s.phase;
			const rad = s.r * (0.88 + 0.16 * Math.sin(a * 3));
			const px = CLUSTER_X + Math.cos(a) * rad;
			const py = CLUSTER_Y + Math.sin(a * 2) * 190 * Math.cos(s.tilt);
			const pz = Math.sin(a) * rad;
			pts.push([px, py, pz]);
		}
		return Layer3D.tube({
			id: s.id,
			points: pts,
			radius: 2.6,
			tubularSegments: 72,
			radialSegments: 8,
			color: s.color,
			material: "unlit",
			emissive: s.color,
			emissiveIntensity: 1.5,
			castShadow: false,
		}).animate(
			LayerAnimation.create()
				.keys("rotateY", [
					[0, -25 + idx * 14],
					[DUR - 1, 35 + idx * 14, "sine.inOut"],
				])
				.keys("emissiveIntensity", [
					[0, 1.2],
					[LOCK, 2.4, "expo.out"],
					[DUR - 1, 1.5, "sine.out"],
				]),
		) as LayoutNode;
	});
}

function reasoningHud(): LayoutNode[] {
	// Progressive token counter frames: 1.2M → 4.8M → 8.4M → 10M.
	const steps: Array<{ text: string; start: number; end: number }> = [
		{ text: "1.2M", start: 4, end: 22 },
		{ text: "4.8M", start: 22, end: 42 },
		{ text: "8.4M", start: 42, end: LOCK },
		{ text: "10M", start: LOCK, end: DUR },
	];

	const counterNodes: LayoutNode[] = steps.map((st, i) => {
		const isFinal = i === steps.length - 1;
		return Layer.text(st.text, {
			id: `s2-stat-${i}`,
			position: "absolute",
			x: 0,
			y: 0,
			width: 560,
			fontFamily: FONT_DISPLAY,
			fontSize: 156,
			fontWeight: 800,
			fontVariations: { wdth: 112 },
			letterSpacing: -3,
			fill: isFinal ? PALETTE.cyan : PALETTE.white,
			startFrame: st.start,
			durationFrames: st.end - st.start,
		}).animate(
			isFinal
				? LayerAnimation.create()
						.keys("scale", [
							[0, 1.12],
							[14, 1.0, "expo.out"],
						])
						.keys("opacity", [
							[0, 0.85],
							[6, 1],
						])
				: LayerAnimation.keys("opacity", [
						[0, 0.7],
						[4, 1],
					]),
		) as LayoutNode;
	});

	// Glass metric panel on left-middle with counter + live native Layer.chart.
	const chart = Layer.chart(
		{
			type: "area",
			width: 500,
			height: 170,
			categories: ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"],
			series: [
				{
					name: "Reasoning Accuracy",
					data: [42, 54, 65, 76, 86, 93, 97, 99.4],
					color: PALETTE.cyan,
					curve: "smooth",
					pointRadius: 5,
				},
			],
			xAxis: { ticks: 4, grid: false },
			yAxis: { min: 30, max: 100, ticks: 3, grid: true },
			legend: false,
			fontFamily: FONT_MONO,
			fontSize: 13,
			animate: { start: 18, duration: 48, ease: "expo.out" },
		},
		{
			id: "s2-reasoning-chart",
			position: "absolute",
			x: 24,
			y: 268,
		},
	) as LayoutNode;

	const card = Layer.box({
		id: "s2-telemetry-card",
		position: "absolute",
		x: 96,
		y: 274,
		width: 556,
		height: 556,
		borderRadius: 24,
		background: "rgba(8, 12, 24, 0.76)",
		borderWidth: 1.5,
		borderColor: PALETTE.glassBorder,
		opacity: 0,
		startFrame: 0,
		durationFrames: DUR,
		children: [
			Layer.box({
				id: "s2-counter-slot",
				position: "absolute",
				x: 34,
				y: 26,
				width: 500,
				height: 164,
				children: counterNodes,
			}),
			Layer.text("ACTIVE CONTEXT WINDOW · TOKENS", {
				id: "s2-stat-label",
				position: "absolute",
				x: 38,
				y: 194,
				width: 500,
				fontFamily: FONT_MONO,
				fontSize: 17,
				fontWeight: 600,
				letterSpacing: 3,
				fill: PALETTE.slate,
			}),
			Layer.box({
				id: "s2-divider",
				position: "absolute",
				x: 34,
				y: 240,
				width: 488,
				height: 1.5,
				background: "linear-gradient(90deg, #00F0FF, #9D3BFF 65%, transparent)",
			}),
			chart,
			Layer.box({
				id: "s2-lock-badge",
				position: "absolute",
				x: 34,
				y: 472,
				width: 488,
				height: 52,
				borderRadius: 12,
				background: "rgba(0, 240, 255, 0.12)",
				borderWidth: 1,
				borderColor: "rgba(0, 240, 255, 0.45)",
				opacity: 0,
				children: [
					Layer.text("SYNAPTIC LOCK  ·  99.4% RECALL DEPTH", {
						id: "s2-lock-text",
						position: "absolute",
						x: 0,
						y: 15,
						width: 488,
						align: "center",
						fontFamily: FONT_MONO,
						fontSize: 17,
						fontWeight: 700,
						letterSpacing: 2.2,
						fill: PALETTE.iceCyan,
					}),
				],
			}).animate(
				LayerAnimation.keys("opacity", [
					[LOCK - 2, 0],
					[LOCK + 8, 1, "expo.out"],
				]),
			) as LayoutNode,
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[4, 0],
				[20, 1, "power2.out"],
			])
			.keys("y", [
				[4, 308],
				[22, 274, "expo.out"],
			]),
	) as LayoutNode;

	return [
		actHeader({
			id: "s2-header",
			tag: "01 // DEEP REASONING",
			title: "THINK ACROSS",
			accentWord: "MILLIONS.",
			x: 96,
			y: 82,
			enterAt: 4,
			duration: DUR,
			titleSize: 58,
		}),
		card,
	];
}

export function scene2Reasoning(): LayoutNode {
	const backdrop = Layer.shader({
		id: "s2-wgsl-backdrop",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: 0,
		durationFrames: DUR,
		uniforms: {
			phase: 2.6,
			magentaMix: 0.55,
			horizon: 0.75,
			intensity: 0.88,
			energy: (ctx) => computeMusicalEnergy(SCENE_STARTS.reasoning + ctx.frame),
			flare: (ctx) => pulseAt(ctx.frame, LOCK, 15) * 0.95,
			raySpin: (ctx) => 0.8 + ctx.frame * 0.018,
		},
		fragment: NEON_FIELD_WGSL,
	}) as LayoutNode;

	const camera = buildCameraRig({
		id: "s2-camera",
		duration: DUR,
		baseFov: 38,
		stations: [
			{
				at: 0,
				eye: [-180, -340, -1720],
				look: [160, CLUSTER_Y, 0],
				roll: -2,
				snap: 0.6,
			},
			{
				at: LOCK,
				eye: [80, -450, -1480],
				look: [190, CLUSTER_Y, 0],
				roll: 2.5,
				snap: 0.8,
			},
			{
				at: DUR - 1,
				eye: [420, -290, -1380],
				look: [210, CLUSTER_Y, 0],
				roll: 1,
				snap: 0.4,
			},
		],
		hits: [{ at: LOCK, amount: 24, frames: 16, fovKick: 5 }],
		motionBlur: { shutter: 130, samples: 16 },
	});

	const stage3d = Layer.box({
		id: "s2-3d-stage",
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
				id: "s2-env",
				exposure: 0.1,
				toneMapping: "agx",
				fog: { color: PALETTE.void, start: 1900, end: 8000 },
				bloom: { intensity: 0.22, threshold: 1.55, radius: 5 },
				floor: {
					y: 0,
					color: PALETTE.floor,
					reflectivity: 0.84,
					roughness: 0.14,
					fadeDistance: 2100,
					opacity: 0.94,
				},
			}) as LayoutNode,
			Layer.directionalLight({
				id: "s2-key",
				x: -400,
				y: -1100,
				z: -700,
				targetX: CLUSTER_X,
				targetY: CLUSTER_Y,
				targetZ: 0,
				color: "#E8F6FF",
				intensity: 1.8,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s2-cyan-pt",
				x: CLUSTER_X + 380,
				y: CLUSTER_Y - 120,
				z: -240,
				color: PALETTE.cyan,
				intensity: 3.4,
				radius: 2200,
			}) as LayoutNode,
			Layer.pointLight({
				id: "s2-mag-pt",
				x: CLUSTER_X - 320,
				y: CLUSTER_Y + 180,
				z: 280,
				color: PALETTE.magenta,
				intensity: 2.8,
				radius: 2200,
			}) as LayoutNode,
			neuralConstellation(),
			...synapticPathways(),
			floorShockwave({
				id: "s2-lock-ring",
				at: LOCK,
				span: 46,
				x: CLUSTER_X,
				z: 0,
				color: PALETTE.cyan,
				maxScale: 20,
				intensity: 4.5,
			}),
		],
	}) as LayoutNode;

	return Layer.box({
		id: "scene-2-reasoning",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: PALETTE.void,
		overflow: "hidden",
		children: [backdrop, stage3d, ...cornerTicks("s2", DUR), ...reasoningHud()],
	}) as LayoutNode;
}
