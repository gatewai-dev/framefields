/**
 * The 3D verse: one camera move through one world, every waypoint on a sung word.
 * ("Step inside the camera" closes the type chapter: its wall shrinks into a
 * viewfinder and the lens rushes it; this chapter opens mid-flight.)
 *   "fly the third dimension"       a banking flight past words standing in depth
 *   "paths and planes in motion"    curves draw themselves across the floor, planes rise and turn
 *   "cubes in every direction"      a cluster of cubes bursts outward on "direction"
 *   "orbit round and dolly through" the camera circles a ring of capabilities, then dollies through it
 *   "light it up in depth"          a light sweeps the world and DEPTH lands, extruded
 */
import { Layer, Layer3D, LayerAnimation, TextAnimator } from "gitframes";
import { BEAT, bar } from "../grid.js";
import { lineWords, type SungWord, sung } from "../lyrics.js";
import {
	ACCENT,
	ACCENT_DEEP,
	BG,
	DISPLAY,
	EASE_IN,
	EASE_IN_OUT,
	EASE_OUT,
	FG,
	H,
	type Key,
	keys,
	SNAP,
	SURFACE,
	scene,
	sungLine,
	W,
	window3D,
} from "../theme.js";
import { CH } from "../timeline.js";
import { meshFile } from "../warp/meshes.js";

const CX = W / 2;
const CY = H / 2;
const FLOOR = 900;

type Vec3 = [number, number, number];
interface Shot {
	f: number;
	eye: Vec3;
	at: Vec3;
	roll?: number;
	ease?: string;
}

/** Minimum frames between two waypoints: fast lyrics must not reorder the camera. */
const MIN_GAP = 6;

/** Writes a list of camera poses as eye / target / roll tracks, keeping waypoints in order. */
function camera(list: Shot[]) {
	const shots: Shot[] = [];
	for (const s of list) {
		const prev = shots[shots.length - 1];
		shots.push(prev ? { ...s, f: Math.max(s.f, prev.f + MIN_GAP) } : s);
	}
	const tracks = {
		cameraX: [],
		cameraY: [],
		cameraZ: [],
		targetX: [],
		targetY: [],
		targetZ: [],
		cameraRoll: [],
	} as Record<string, Key[]>;
	for (const s of shots) {
		const ease = s.ease ?? EASE_IN_OUT;
		const add = (prop: string, v: number) => tracks[prop].push([s.f, v, ease]);
		add("cameraX", s.eye[0]);
		add("cameraY", s.eye[1]);
		add("cameraZ", s.eye[2]);
		add("targetX", s.at[0]);
		add("targetY", s.at[1]);
		add("targetZ", s.at[2]);
		add("cameraRoll", s.roll ?? 0);
	}
	let anim = LayerAnimation.create();
	for (const [prop, list] of Object.entries(tracks))
		anim = keys(prop as never, list, anim);
	return anim;
}

interface Standing {
	id: string;
	text: string;
	at: number;
	/** Scene-local frame the word is gone (the camera has passed it). */
	until?: number;
	x: number;
	y: number;
	z: number;
	size: number;
	weight?: number;
	color?: string;
	font?: string;
	rotateY?: number;
}

/** A word standing in the world, rising letter by letter as it is sung. */
function standing(s: Standing) {
	const width = 1600;
	const height = Math.round(s.size * 1.3);
	return Layer.text(s.text, {
		id: s.id,
		is3D: true,
		position: "absolute",
		x: s.x - width / 2,
		y: s.y - height / 2,
		z: s.z,
		width,
		height,
		rotateY: s.rotateY ?? 0,
		fontFamily: s.font ?? DISPLAY,
		fontSize: s.size,
		fontWeight: s.weight ?? 900,
		fill: s.color ?? FG,
		align: "center",
		verticalAlign: "middle",
		startFrame: s.at,
		durationFrames: s.until === undefined ? undefined : s.until - s.at,
		animators: [
			TextAnimator.waveRise({
				y: s.size * 0.7,
				rotationX: 85,
				opacity: 0,
				blur: 0,
				easing: EASE_OUT,
			}),
		],
	} as never).animate(
		LayerAnimation.create().kineticSweep(-1, 1, 0, 12, "power2.out"),
	);
}

// ── 3. Paths and planes ──────────────────────────────────────────────────────
const PATHS_Z = 5200;

function floorCurves(drawAt: number) {
	const curves = [
		"M 0 900 C 600 100 1400 1700 2000 900 S 3200 100 4000 900",
		"M 0 1200 C 800 400 1600 2000 2400 1200 S 3400 600 4000 1300",
		"M 0 600 C 700 1400 1300 -200 2000 600 S 3300 1300 4000 500",
	];
	return curves.map((d, i) =>
		Layer.shape("path", {
			id: `world-curve-${i}`,
			is3D: true,
			position: "absolute",
			x: CX - 2000,
			y: FLOOR - 4,
			z: PATHS_Z - 900 + i * 260,
			width: 4000,
			height: 2000,
			rotateX: 90,
			d,
			fillType: "none",
			strokeColor: i === 1 ? FG : ACCENT,
			strokeWidth: 16,
			strokeLineCap: "round",
		} as never).animate(
			keys("trimEnd", [
				[0, 0],
				[drawAt + i * 4, 0],
				[drawAt + 34 + i * 4, 1, EASE_OUT],
			]),
		),
	);
}

function risingPlanes(planesAt: number) {
	return [-2, -1, 1, 2].map((k, i) => {
		const at = planesAt + i * (BEAT / 4);
		const y = FLOOR - 230;
		return Layer.box({
			id: `world-plane-${i}`,
			is3D: true,
			position: "absolute",
			x: CX + k * 420 - 160,
			y,
			z: PATHS_Z + Math.abs(k) * 220,
			width: 320,
			height: 420,
			borderRadius: 28,
			background: i % 2 ? ACCENT : BG,
			borderColor: FG,
			borderWidth: 3,
			material: "lit",
			startFrame: at,
		} as never).animate(
			keys(
				"y",
				[
					[0, y + 500],
					[16, y - 160, EASE_OUT],
				],
				keys("rotateY", [
					[0, -90],
					[30, k * 18, SNAP],
					[120, -k * 30, "sine.inOut"],
				]),
			),
		);
	});
}

// ── 4. Depth ─────────────────────────────────────────────────────────────────
const CUBES_Z = 6900;
const RING_Z = 9300;
const DEPTH_Z = 13000;

function depth(probeAt: number, lightAt: number, depthAt: number, len: number) {
	return [
		// What the dolly flies toward and the light comes up on before DEPTH lands: a glossy probe sphere.
		window3D("world-probe-window", probeAt, len - probeAt, [
			Layer3D.obj(meshFile("sphere"), {
				id: "world-probe",
				x: CX + 860,
				y: CY - 220,
				z: DEPTH_Z - 200,
				scale: 0.75,
				color: BG,
				material: "lit",
				shininess: 96,
			} as never),
		]),
		window3D("world-depth-window", depthAt, len - depthAt, [
			Layer3D.extrudedText({
				id: "world-depth",
				text: "DEPTH",
				fontFamily: DISPLAY,
				fontWeight: 900,
				fontSize: 300,
				fill: ACCENT_DEEP,
				depth: 140,
				x: CX,
				y: CY + 40,
				z: DEPTH_Z,
			}),
		]),
		Layer.pointLight({
			id: "world-sweep",
			color: "#FFFFFF",
			intensity: 2.4,
			radius: 2400,
			x: CX - 1400,
			y: CY - 300,
			z: DEPTH_Z - 700,
		} as never).animate(
			keys("x", [
				[0, CX - 1400],
				[lightAt, CX - 1400],
				[len, CX + 1200, EASE_IN_OUT],
			]),
		),
	];
}

const CARDS = [
	"TYPE",
	"3D",
	"VFX",
	"AUDIO",
	"CHARTS",
	"MODELS",
	"MASKS",
	"CODE",
];
const LANDING = "3D";

function carousel(at: number, len: number) {
	const ring = Layer3D.carousel({
		id: "world-carousel",
		radius: 1250,
		x: CX,
		y: CY + 40,
		z: RING_Z,
		// Cards face the centre: from outside, the far side reads through the ring.
		twoSided: false,
		faceInward: true,
		items: CARDS.map((name, i) =>
			Layer.box({
				id: `world-card-${i}`,
				width: 420,
				height: 280,
				borderRadius: 30,
				background: name === LANDING ? ACCENT : SURFACE,
				material: "lit",
				children: [
					Layer.text(name, {
						id: `world-card-text-${i}`,
						position: "absolute",
						x: 0,
						y: 100,
						width: 420,
						fontFamily: DISPLAY,
						fontWeight: 900,
						fontSize: 56,
						fill: name === LANDING ? BG : FG,
						align: "center",
					}),
				],
			}),
		),
	}).animate(
		keys("rotateY", [
			[0, 0],
			[len - at, 90, "sine.inOut"],
		]),
	);
	return window3D("world-carousel-window", at, len - at, [ring]);
}

/** Seeded cubes hanging in the air the flight opens through. */
function cubeField(count: number) {
	let seed = 7;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	return Array.from({ length: count }, (_, i) => {
		const size = 60 + rand() * 140;
		const side = rand() < 0.5 ? -1 : 1;
		const face = i % 3 === 0 ? ACCENT : SURFACE;
		return Layer3D.cube({
			id: `world-cube-${i}`,
			size,
			x: CX + side * (300 + rand() * 900),
			y: CY - 500 + rand() * 1000,
			z: 700 + rand() * 1500,
			rotateX: rand() * 90,
			rotateY: rand() * 90,
			faces: {
				front: face,
				back: face,
				left: ACCENT_DEEP,
				right: ACCENT_DEEP,
				top: BG,
				bottom: SURFACE,
			},
		});
	});
}

/** "cubes in every direction": a tight cluster that bursts outward on "direction". */
function cubeBurst(at: number, burstAt: number) {
	let seed = 11;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	return Array.from({ length: 26 }, (_, i) => {
		const size = 70 + rand() * 90;
		const theta = rand() * Math.PI * 2;
		const phi = Math.acos(2 * rand() - 1);
		const reach = 900 + rand() * 900;
		const home: Vec3 = [
			CX + (rand() - 0.5) * 260,
			CY + (rand() - 0.5) * 260,
			CUBES_Z + (rand() - 0.5) * 260,
		];
		const out: Vec3 = [
			home[0] + Math.cos(theta) * Math.sin(phi) * reach,
			home[1] + Math.cos(phi) * reach * 0.7,
			home[2] + Math.sin(theta) * Math.sin(phi) * reach,
		];
		const face = i % 3 === 0 ? ACCENT : i % 3 === 1 ? BG : SURFACE;
		const pop = at + Math.floor(i / 3);
		return Layer3D.cube({
			id: `world-burst-${i}`,
			size,
			x: home[0],
			y: home[1],
			z: home[2],
			faces: {
				front: face,
				back: face,
				left: ACCENT_DEEP,
				right: ACCENT_DEEP,
				top: BG,
				bottom: SURFACE,
			},
		}).animate(
			keys(
				"scale",
				[
					[0, 0],
					[pop, 0],
					[pop + 8, 1, SNAP],
				],
				keys(
					"x",
					[
						[burstAt, home[0]],
						[burstAt + 40, out[0], EASE_OUT],
					],
					keys(
						"y",
						[
							[burstAt, home[1]],
							[burstAt + 40, out[1], EASE_OUT],
						],
						keys(
							"z",
							[
								[burstAt, home[2]],
								[burstAt + 40, out[2], EASE_OUT],
							],
							keys("rotateY", [
								[burstAt, 0],
								[burstAt + 60, 180 + rand() * 180, EASE_OUT],
							]),
						),
					),
				),
			),
		);
	});
}

/** Waypoints on a circle around the ring: the orbit, sampled so the camera arcs instead of cutting the chord. */
function orbitShots(
	fromF: number,
	toF: number,
	fromDeg: number,
	toDeg: number,
): Shot[] {
	const n = 5;
	return Array.from({ length: n + 1 }, (_, i) => {
		const t = i / n;
		const a = ((fromDeg + (toDeg - fromDeg) * t) * Math.PI) / 180;
		return {
			f: Math.round(fromF + (toF - fromF) * t),
			eye: [
				CX + Math.sin(a) * 2700,
				CY - 420,
				RING_Z - Math.cos(a) * 2700,
			] as Vec3,
			at: [CX, CY + 40, RING_Z] as Vec3,
			roll: 0,
			ease: "none",
		};
	});
}

export function worldScene() {
	const from = bar(CH.world);
	const to = bar(CH.warp);
	const len = to - from;
	const at = (w: SungWord) => w.at - from;

	const fly = sung("fly", from - BEAT);
	const theThird = sung("the", fly.at);
	const third = sung("third", fly.at);
	const dimension = sung("dimension", fly.at);
	const paths = sung("paths", dimension.at);
	const planes = sung("planes", paths.at);
	const motion = sung("motion", paths.at);
	const cubes = sung("cubes", motion.at);
	const direction = sung("direction", cubes.at);
	const orbit = sung("orbit", direction.at);
	const dolly = sung("dolly", orbit.at);
	const through = sung("through", dolly.at);
	const light = sung("light", through.at);
	const depthW = sung("depth", light.at);

	const cam = camera([
		// Already moving: in through the cubes hanging at the threshold.
		{ f: 0, eye: [CX, CY - 40, -900], at: [CX - 100, CY - 40, 2000] },
		{
			f: Math.max(at(fly) + 6, 10),
			eye: [CX, CY - 40, 600],
			at: [CX - 100, CY - 40, 2000],
			ease: "none",
		},
		// The flight: bank past FLY and THE THIRD, level onto DIMENSION.
		{
			f: at(third) + 4,
			eye: [CX + 220, CY - 140, 1700],
			at: [CX + 100, CY, 3100],
			roll: 8,
		},
		{
			f: at(dimension) + 10,
			eye: [CX, CY - 200, 2500],
			at: [CX, CY, 3800],
			roll: 0,
		},
		// Crane up and over: the curves draw beneath, seen from above.
		{
			f: at(paths) + 2,
			eye: [CX, FLOOR - 3000, PATHS_Z - 900],
			at: [CX, FLOOR, PATHS_Z - 200],
			roll: 0,
		},
		// Drop to the planes as they rise and turn.
		{
			f: at(motion) + 8,
			eye: [CX + 300, FLOOR - 420, PATHS_Z - 1200],
			at: [CX, FLOOR - 300, PATHS_Z + 300],
			roll: 3,
		},
		// Into the cluster, then pull back as it bursts.
		{
			f: at(cubes) + 4,
			eye: [CX, CY - 80, CUBES_Z - 1500],
			at: [CX, CY, CUBES_Z],
			roll: 0,
		},
		{
			f: at(direction) + 14,
			eye: [CX - 300, CY - 360, CUBES_Z - 2900],
			at: [CX, CY, CUBES_Z],
			roll: -3,
		},
		// Orbit round the ring, then dolly straight through its middle.
		...orbitShots(at(orbit), at(dolly) - 4, -70, 60),
		{
			f: at(dolly) + 4,
			eye: [CX, CY - 60, RING_Z - 1500],
			at: [CX, CY, RING_Z + 1000],
			roll: 0,
			ease: EASE_IN_OUT,
		},
		{
			f: at(through) + 10,
			eye: [CX, CY - 60, RING_Z + 1700],
			at: [CX, CY, DEPTH_Z],
			roll: 0,
			ease: EASE_IN,
		},
		// The light comes on; DEPTH lands and the lens pushes in.
		{
			f: at(light) + 6,
			eye: [CX - 500, CY - 260, DEPTH_Z - 2300],
			at: [CX, CY + 40, DEPTH_Z],
			roll: 0,
		},
		{
			f: len,
			eye: [CX, CY - 40, DEPTH_Z - 1300],
			at: [CX, CY + 40, DEPTH_Z],
			roll: 0,
			ease: EASE_IN,
		},
	]);

	const flight: Standing[] = [
		{
			id: "world-fly",
			text: "FLY",
			at: at(fly),
			until: at(dimension),
			x: CX - 420,
			y: CY - 40,
			z: 2200,
			size: 170,
			weight: 300,
		},
		{
			id: "world-the",
			text: "THE",
			at: at(theThird),
			until: at(paths) - 30,
			x: CX + 380,
			y: CY - 160,
			z: 3000,
			size: 110,
			weight: 300,
		},
		{
			id: "world-third",
			text: "THIRD",
			at: at(third),
			until: at(paths) - 30,
			x: CX + 620,
			y: CY - 20,
			z: 3000,
			size: 150,
			weight: 300,
		},
		{
			id: "world-dimension",
			text: "DIMENSION",
			at: at(dimension),
			until: at(paths),
			x: CX,
			y: CY,
			z: 3800,
			size: 230,
			color: ACCENT,
		},
	];
	return scene("world", from, to, [
		Layer.camera({
			id: "world-cam",
			x: CX,
			y: CY,
			z: -900,
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			animation: cam,
		} as never),
		Layer.directionalLight({
			id: "world-key",
			color: "#FFFFFF",
			intensity: 0.9,
			direction: [-0.3, 0.6, 1],
		} as never),
		Layer.ambientLight({
			id: "world-fill",
			color: "#FFFFFF",
			intensity: 0.55,
		} as never),
		...cubeField(22),
		...flight.map(standing),
		...floorCurves(at(paths)),
		...risingPlanes(at(planes)),
		standing({
			id: "world-motion",
			text: "MOTION",
			at: at(motion),
			until: at(cubes),
			x: CX,
			y: FLOOR - 640,
			z: PATHS_Z + 400,
			size: 200,
			color: ACCENT,
		}),
		...cubeBurst(at(cubes), at(direction)),
		sungLine({
			id: "world-cubes",
			words: lineWords(cubes.line),
			from,
			x: CX - 1300,
			width: 2600,
			y: CY - 420,
			size: 130,
			outAt: at(orbit) - 4,
			z: CUBES_Z + 400,
		}),
		carousel(at(orbit) - 10, len),
		sungLine({
			id: "world-orbit",
			words: lineWords(orbit.line),
			from,
			x: CX - 1300,
			width: 2600,
			y: CY - 520,
			size: 120,
			weight: 300,
			outAt: at(light) - 4,
			z: RING_Z,
		}),
		sungLine({
			id: "world-light",
			words: lineWords(light.line).filter((w) => w !== depthW),
			from,
			x: CX - 1200,
			width: 2400,
			y: CY - 330,
			size: 110,
			weight: 300,
			z: DEPTH_Z - 150,
		}),
		...depth(at(through), at(light), at(depthW), len),
	]);
}
