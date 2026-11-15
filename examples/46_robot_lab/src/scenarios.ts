/**
 * The gallery's scenes: what stands in front of the arm, the demo that
 * works it, and how far along it is. Meters, z up; the arm stands at the
 * origin facing +x.
 */
import type {
	SteelSceneBuilder,
	SteelSolverOptions,
	SteelWorld,
} from "framefields";
import { rgb } from "./arm.js";

/** Where the hand goes in one step of a demo. */
export interface Goal {
	/** Fingertips' point, m. */
	at: [number, number, number];
	/**
	 * The line through both fingers, rad about the vertical, and how far it
	 * may turn and grip the same (a block: a quarter turn). Default: across
	 * the arm.
	 */
	fingers?: { axis: number; period: number };
	grip: "open" | "closed";
}

/** One step of a demo: its goal (read when the step starts) and how long it takes. */
export interface Step {
	frames: number;
	goal(world: SteelWorld, frame: number): Goal;
}

/** Something on the floor, as the legend shows it. */
export interface Thing {
	label: string;
	color: string;
}

export interface Scenario {
	id: string;
	title: string;
	about: string;
	things: Thing[];
	build(scene: SteelSceneBuilder): void;
	/** Solver settings the scene needs (a gravel bed needs more substeps to hold). */
	solver?: SteelSolverOptions;
	demo(): Step[];
	/** The scene's progress at `frame`, for the panel. */
	metric(world: SteelWorld, frame: number): string;
}

type Vec3 = [number, number, number];

const box = (
	scene: SteelSceneBuilder,
	label: string,
	at: Vec3,
	half: Vec3,
	color: string,
	options: { yaw?: number; mu?: number; still?: boolean } = {},
) => {
	const q = options.yaw ?? 0;
	const xform: [number, number, number, number, number, number, number] = [
		...at,
		0,
		0,
		Math.sin(q / 2),
		Math.cos(q / 2),
	];
	if (options.still) {
		scene.addShapeBox(-1, {
			hx: half[0],
			hy: half[1],
			hz: half[2],
			xform,
			color: rgb(color),
			mu: options.mu ?? 0.8,
		});
		return -1;
	}
	const body = scene.addBody({ xform, label });
	scene.addShapeBox(body, {
		hx: half[0],
		hy: half[1],
		hz: half[2],
		color: rgb(color),
		mu: options.mu ?? 1,
	});
	return body;
};

/** A body's yaw about the vertical from its quaternion (x, y, z, w). */
export const yawOf = ([x, y, z, w]: number[]) =>
	Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));

const where = (world: SteelWorld, name: string, frame: number) =>
	world.body(name, frame);

/**
 * Picks `name` (a cube or upright peg, held `hold` m above its bottom by the
 * fingertips) and sets it down with its bottom at `to` (+ `drop`).
 */
function pickAndPlace(
	name: string,
	height: number,
	hold: number,
	place: Vec3 | ((world: SteelWorld, frame: number) => Vec3),
	carry = 0.22,
): Step[] {
	let to: Vec3 = [0, 0, 0];
	// Where it was when the pick started: the steps after read it again.
	const grasp = (world: SteelWorld, frame: number, dz: number): Goal => {
		const b = where(world, name, frame);
		const [x, y, z] = b.position;
		return {
			at: [x, y, z - height / 2 + hold + dz],
			// Across the block's faces.
			fingers: { axis: yawOf(b.quaternion) + Math.PI / 2, period: Math.PI / 2 },
			grip: "open",
		};
	};
	let fingers: Goal["fingers"];
	return [
		{ frames: 40, goal: (w, f) => grasp(w, f, 0.12) },
		{ frames: 30, goal: (w, f) => grasp(w, f, 0) },
		{
			frames: 18,
			goal: (w, f) => {
				const g = grasp(w, f, 0);
				fingers = g.fingers;
				return { ...g, grip: "closed" };
			},
		},
		{
			frames: 35,
			goal: (w, f) => ({
				...grasp(w, f, carry),
				fingers,
				grip: "closed",
			}),
		},
		{
			frames: 50,
			goal: (w, f) => {
				to = typeof place === "function" ? place(w, f) : place;
				return {
					at: [to[0], to[1], to[2] + hold + carry],
					fingers,
					grip: "closed",
				};
			},
		},
		{
			frames: 35,
			goal: () => ({
				at: [to[0], to[1], to[2] + hold],
				fingers,
				grip: "closed",
			}),
		},
		// Still for a moment, so it rests before the fingers let go.
		{
			frames: 10,
			goal: () => ({
				at: [to[0], to[1], to[2] + hold],
				fingers,
				grip: "closed",
			}),
		},
		{
			frames: 20,
			goal: () => ({
				at: [to[0], to[1], to[2] + hold],
				fingers,
				grip: "open",
			}),
		},
		{
			frames: 30,
			goal: () => ({
				at: [to[0], to[1], to[2] + hold + 0.12],
				fingers,
				grip: "open",
			}),
		},
	];
}

const CUBE = 0.025;

const lift: Scenario = {
	id: "lift",
	title: "Pick and place",
	about: "Lift a block off the floor and set it on the pedestal.",
	things: [
		{ label: "Block", color: "#e5533d" },
		{ label: "Pedestal", color: "#8b909c" },
	],
	build(scene) {
		box(scene, "block", [0.48, -0.16, CUBE], [CUBE, CUBE, CUBE], "#e5533d", {
			yaw: 0.5,
		});
		box(scene, "pedestal", [0.42, 0.2, 0.05], [0.06, 0.06, 0.05], "#8b909c", {
			still: true,
		});
	},
	demo: () => pickAndPlace("block", 2 * CUBE, 0.03, [0.42, 0.2, 0.1]),
	metric(world, frame) {
		const [x, y, z] = where(world, "block", frame).position;
		const on =
			z > 0.11 && Math.abs(x - 0.42) < 0.06 && Math.abs(y - 0.2) < 0.06;
		return `Block on the pedestal: ${on ? "yes" : "no"}`;
	},
};

const TOWER: Vec3 = [0.45, 0.18, 0];
const STACK = [
	{ name: "first", color: "#f2a33a", at: [0.52, -0.12] as const, yaw: 0.3 },
	{ name: "second", color: "#2f9c95", at: [0.36, -0.22] as const, yaw: -0.6 },
	{ name: "third", color: "#ece4d4", at: [0.6, -0.3] as const, yaw: 1.1 },
];

const stack: Scenario = {
	id: "stack",
	title: "Stack",
	about: "Build a tower of three blocks.",
	things: STACK.map((s, i) => ({
		label: ["Bottom", "Middle", "Top"][i],
		color: s.color,
	})),
	build(scene) {
		for (const s of STACK)
			box(
				scene,
				s.name,
				[s.at[0], s.at[1], CUBE],
				[CUBE, CUBE, CUBE],
				s.color,
				{
					yaw: s.yaw,
				},
			);
	},
	demo: () =>
		STACK.flatMap((s, i) =>
			pickAndPlace(s.name, 2 * CUBE, 0.03, [
				TOWER[0],
				TOWER[1],
				i * 2 * CUBE + 0.002,
			]),
		),
	metric(world, frame) {
		const stacked = STACK.filter((s, i) => {
			const [x, y, z] = where(world, s.name, frame).position;
			return (
				Math.hypot(x - TOWER[0], y - TOWER[1]) < 0.03 &&
				Math.abs(z - (2 * i + 1) * CUBE) < 0.01
			);
		}).length;
		return `Tower: ${stacked} of ${STACK.length}`;
	},
};

const CUP: Vec3 = [0.45, 0.2, 0];
const PEG = { radius: 0.018, half: 0.06 };

const cup: Scenario = {
	id: "cup",
	title: "Peg in cup",
	about: "Drop a peg into the cup.",
	things: [
		{ label: "Peg", color: "#3c7be0" },
		{ label: "Cup", color: "#e9e6df" },
	],
	build(scene) {
		const peg = scene.addBody({
			xform: [0.5, -0.18, PEG.half, 0, 0, 0, 1],
			label: "peg",
		});
		scene.addShapeCylinder(peg, {
			radius: PEG.radius,
			halfHeight: PEG.half,
			color: rgb("#3c7be0"),
			mu: 1,
		});
		// A square cup: a floor and four walls on one body.
		const body = scene.addBody({
			xform: [CUP[0], CUP[1], 0, 0, 0, 0, 1],
			label: "cup",
		});
		const color = rgb("#e9e6df");
		const wall = (x: number, y: number, hx: number, hy: number) =>
			scene.addShapeBox(body, {
				hx,
				hy,
				hz: 0.04,
				xform: [x, y, 0.04, 0, 0, 0, 1],
				color,
				density: 400,
			});
		scene.addShapeBox(body, {
			hx: 0.055,
			hy: 0.055,
			hz: 0.006,
			xform: [0, 0, 0.006, 0, 0, 0, 1],
			color,
			density: 400,
		});
		wall(0.05, 0, 0.005, 0.055);
		wall(-0.05, 0, 0.005, 0.055);
		wall(0, 0.05, 0.045, 0.005);
		wall(0, -0.05, 0.045, 0.005);
	},
	demo: () =>
		pickAndPlace("peg", 2 * PEG.half, 0.075, [CUP[0], CUP[1], 0.04], 0.2),
	metric(world, frame) {
		const [x, y, z] = where(world, "peg", frame).position;
		const [cx, cy] = where(world, "cup", frame).position;
		const inside =
			Math.abs(x - cx) < 0.045 && Math.abs(y - cy) < 0.045 && z < 0.09;
		return `Peg in the cup: ${inside ? "yes" : "no"}`;
	},
};

const BED = { center: [0.45, 0.17] as const, half: 0.09, wall: 0.05 };
const PEBBLE_COLORS = ["#8a8f99", "#a39d91", "#6f747d", "#b8b2a6"];
const ROWS = 7;
const LAYERS = 1;

/** The gravel: small balls and chips on a jittered lattice (nothing overlaps), seeded. */
function pebbles(): Array<{
	name: string;
	at: Vec3;
	ball: boolean;
	color: string;
}> {
	let seed = 7;
	const jitter = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed / 2147483647 - 0.5) * 0.006;
	};
	const [cx, cy] = BED.center;
	const pitch = 0.026;
	const first = -((ROWS - 1) / 2) * pitch;
	return Array.from({ length: ROWS * ROWS * LAYERS }, (_, i) => {
		const layer = Math.floor(i / (ROWS * ROWS));
		const row = Math.floor(i / ROWS) % ROWS;
		const col = i % ROWS;
		return {
			name: `pebble${i}`,
			at: [
				cx + first + col * pitch + jitter(),
				cy + first + row * pitch + jitter(),
				0.016 + layer * 0.03,
			],
			ball: (row + col + layer) % 3 === 0,
			color: PEBBLE_COLORS[(i * 7) % PEBBLE_COLORS.length],
		};
	});
}

const PEBBLES = pebbles();
const GRAVEL_BLOCKS = [
	{ name: "lower", color: "#e5533d", at: [0.52, -0.14] as const, yaw: 0.4 },
	{ name: "upper", color: "#3c7be0", at: [0.37, -0.24] as const, yaw: -0.3 },
];

/** The bed's top under its middle: the highest pebble near it, plus its size. */
function bedTop(world: SteelWorld, frame: number): number {
	const [cx, cy] = BED.center;
	let top = 0;
	for (const p of PEBBLES) {
		const [x, y, z] = where(world, p.name, frame).position;
		if (Math.hypot(x - cx, y - cy) < 0.04) top = Math.max(top, z + 0.012);
	}
	return top;
}

const gravel: Scenario = {
	id: "gravel",
	title: "Stack on gravel",
	about: "Stack two blocks on a bed of loose gravel.",
	things: [
		{ label: "Lower block", color: "#e5533d" },
		{ label: "Upper block", color: "#3c7be0" },
		{ label: "Gravel", color: "#8a8f99" },
	],
	build(scene) {
		for (const p of PEBBLES) {
			const body = scene.addBody({
				xform: [...p.at, 0, 0, 0, 1],
				label: p.name,
			});
			// Contacts gathered within 1 cm: Steel's default 10 cm would collect
			// every neighbor in the bed and fill its buffers.
			const style = {
				color: rgb(p.color),
				mu: 0.9,
				// Gravel grips: it neither rolls nor spins freely under a load.
				muRolling: 0.02,
				muTorsional: 0.02,
				gap: 0.01,
			};
			if (p.ball) scene.addShapeSphere(body, { radius: 0.013, ...style });
			else
				scene.addShapeBox(body, { hx: 0.011, hy: 0.011, hz: 0.011, ...style });
		}
		const [cx, cy] = BED.center;
		const { half: h, wall } = BED;
		const rim = (x: number, y: number, hx: number, hy: number) =>
			box(scene, "rim", [x, y, wall / 2], [hx, hy, wall / 2], "#3a3f4a", {
				still: true,
			});
		rim(cx + h + 0.006, cy, 0.006, h + 0.012);
		rim(cx - h - 0.006, cy, 0.006, h + 0.012);
		rim(cx, cy + h + 0.006, h, 0.006);
		rim(cx, cy - h - 0.006, h, 0.006);
		for (const b of GRAVEL_BLOCKS)
			box(
				scene,
				b.name,
				[b.at[0], b.at[1], CUBE],
				[CUBE, CUBE, CUBE],
				b.color,
				{
					yaw: b.yaw,
				},
			);
	},
	demo: () => [
		// Let the gravel settle first.
		{ frames: 30, goal: () => ({ at: [0.38, 0, 0.35], grip: "open" }) },
		...pickAndPlace("lower", 2 * CUBE, 0.03, (w, f) => [
			BED.center[0],
			BED.center[1],
			// Pressed a little into the bed, so it seats level while held.
			bedTop(w, f) - 0.006,
		]),
		...pickAndPlace("upper", 2 * CUBE, 0.03, (w, f) => {
			const [x, y, z] = where(w, "lower", f).position;
			return [x, y, z + CUBE];
		}),
	],
	metric(world, frame) {
		const [cx, cy] = BED.center;
		const lower = where(world, "lower", frame).position;
		const upper = where(world, "upper", frame).position;
		const onBed =
			Math.abs(lower[0] - cx) < BED.half &&
			Math.abs(lower[1] - cy) < BED.half &&
			lower[2] > 0.04;
		const onLower =
			onBed &&
			Math.hypot(upper[0] - lower[0], upper[1] - lower[1]) < 0.025 &&
			Math.abs(upper[2] - lower[2] - 2 * CUBE) < 0.012;
		return `Tower on the gravel: ${onBed ? (onLower ? 2 : 1) : 0} of 2`;
	},
};

export const SCENARIOS: Scenario[] = [lift, stack, cup, gravel];

/** The scenario the page's `?scene=` names, or the first. */
export function scenarioFor(search: string): Scenario {
	const id = new URLSearchParams(search).get("scene");
	return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
