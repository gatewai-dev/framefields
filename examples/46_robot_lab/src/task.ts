/**
 * What stands in front of the arm, the demo that works it, and how far
 * along it is: a cube picked off the floor and set on a pad. Meters, z up;
 * the arm stands at the origin facing +x.
 */
import type {
	SteelSceneBuilder,
	SteelSolverOptions,
	SteelWorld,
} from "framefields";
import { rgb } from "./so101.js";

/** Where the jaws go in one step of a demo. */
export interface Goal {
	/** The point between the jaws, m. */
	at: [number, number, number];
	/**
	 * The line the jaws close along, rad about the vertical, and how far it
	 * may turn and grip the same (a cube: a quarter turn).
	 */
	jaws: { axis: number; period: number };
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

type Vec3 = [number, number, number];

/** The cube's half size: a 3 cm cube, as the SO-101 picks in LeRobot's demos. */
const CUBE = 0.015;
const START: Vec3 = [0.22, -0.09, CUBE];
const START_YAW = 0.5;
/** The pad's center and half sizes; the cube goes on its top. */
const PAD = { at: [0.21, 0.11] as const, half: [0.035, 0.035, 0.012] as Vec3 };
const PAD_TOP = 2 * PAD.half[2];

export const TITLE = "SO-101 pick and place";
export const ABOUT =
	"The SO-101 arm lifts a cube off the floor and sets it on the pad.";
export const THINGS: Thing[] = [
	{ label: "Cube", color: "#e5533d" },
	{ label: "Pad", color: "#8b909c" },
];

/**
 * The solver settings: Steel's defaults (4 substeps, 12 iterations). The
 * 20 g cube between the jaw and the gripper is the case Gauss-Seidel
 * converges slowest on (skild-ai/steel-webgpu#8); our fork of Steel solves a
 * light body's contacts with links exactly (`NOTICE.md` in packages/steel).
 */
export const SOLVER: SteelSolverOptions = {};

export function build(scene: SteelSceneBuilder): void {
	const cube = scene.addBody({
		xform: [...START, 0, 0, Math.sin(START_YAW / 2), Math.cos(START_YAW / 2)],
		label: "cube",
	});
	scene.addJointFree(cube, { label: "cube" });
	scene.addShapeBox(cube, {
		hx: CUBE,
		hy: CUBE,
		hz: CUBE,
		color: rgb("#e5533d"),
		mu: 1,
		// 20 g, a printed cube's weight.
		density: 0.02 / (2 * CUBE) ** 3,
		gap: 0.01,
	});
	scene.addShapeBox(-1, {
		hx: PAD.half[0],
		hy: PAD.half[1],
		hz: PAD.half[2],
		xform: [PAD.at[0], PAD.at[1], PAD.half[2], 0, 0, 0, 1],
		color: rgb("#8b909c"),
		mu: 0.8,
		gap: 0.01,
	});
}

/** A body's yaw about the vertical from its quaternion (x, y, z, w). */
const yawOf = ([x, y, z, w]: number[]) =>
	Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));

/** Picks the cube where it is and sets it on the pad. */
export function demo(): Step[] {
	const above = 0.07;
	let jaws: Goal["jaws"] = { axis: 0, period: Math.PI / 2 };
	// The cube's center when the pick starts; the steps after read it again.
	const grasp = (world: SteelWorld, frame: number, dz: number): Goal => {
		const b = world.body("cube", frame);
		const [x, y, z] = b.position;
		return {
			at: [x, y, z + dz],
			// Across two of its faces.
			jaws: { axis: yawOf(b.quaternion), period: Math.PI / 2 },
			grip: "open",
		};
	};
	const to: Vec3 = [PAD.at[0], PAD.at[1], PAD_TOP + CUBE];
	const over = (dz: number, grip: Goal["grip"]): Goal => ({
		at: [to[0], to[1], to[2] + dz],
		jaws,
		grip,
	});
	return [
		{ frames: 40, goal: (w, f) => grasp(w, f, above) },
		{ frames: 30, goal: (w, f) => grasp(w, f, 0) },
		{
			frames: 18,
			goal: (w, f) => {
				const g = grasp(w, f, 0);
				jaws = g.jaws;
				return { ...g, grip: "closed" };
			},
		},
		{
			frames: 35,
			goal: (w, f) => ({ ...grasp(w, f, above), jaws, grip: "closed" }),
		},
		{ frames: 50, goal: () => over(above, "closed") },
		{ frames: 35, goal: () => over(0.002, "closed") },
		// Still for a moment, so it rests before the jaw lets go.
		{ frames: 10, goal: () => over(0.002, "closed") },
		{ frames: 20, goal: () => over(0.002, "open") },
		{ frames: 30, goal: () => over(above, "open") },
	];
}

/** The task's progress at `frame`, for the panel. */
export function metric(world: SteelWorld, frame: number): string {
	const [x, y, z] = world.body("cube", frame).position;
	const on =
		z > PAD_TOP + CUBE * 0.5 &&
		Math.abs(x - PAD.at[0]) < PAD.half[0] &&
		Math.abs(y - PAD.at[1]) < PAD.half[1];
	return `Cube on the pad: ${on ? "yes" : "no"}`;
}
