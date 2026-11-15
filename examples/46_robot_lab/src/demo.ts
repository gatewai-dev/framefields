/**
 * Runs a scenario's demo: each step's goal (fingertips' point, fingers'
 * heading, grip) is read when the step starts, turned into joint targets,
 * and eased toward over the step's frames.
 */
import type { SteelWorld } from "framefields";
import { CLOSED, OPEN, reachDown } from "./arm.js";
import type { Goal, Step } from "./scenarios.js";

/** Wraps `a` into [-period/2, period/2). */
const wrap = (a: number, period: number) =>
	a - period * Math.floor(a / period + 0.5);

/**
 * Joint targets (yaw, shoulder, elbow, wrist, roll, grip) for a goal. With
 * the hand pointing down the fingers' line lies at yaw + π/2 - roll.
 */
export function jointsFor(goal: Goal): number[] {
	const [x, y, z] = goal.at;
	const yaw = Math.atan2(y, x);
	const roll = goal.fingers
		? wrap(yaw + Math.PI / 2 - goal.fingers.axis, goal.fingers.period)
		: 0;
	return [
		yaw,
		...reachDown(Math.hypot(x, y), z),
		roll,
		goal.grip === "open" ? OPEN : CLOSED,
	];
}

export class Demo {
	private index = -1;
	private left = 0;
	private frames = 1;
	private from: number[];
	private to: number[];

	constructor(
		private readonly steps: Step[],
		start: readonly number[],
	) {
		this.from = [...start];
		this.to = [...start];
	}

	get done(): boolean {
		return this.index >= this.steps.length;
	}

	/** The targets for the frame about to be stepped. */
	targets(world: SteelWorld, frame: number): number[] {
		if (this.left <= 0) {
			this.index++;
			if (this.done) return this.to;
			const step = this.steps[this.index];
			this.from = this.to;
			this.to = jointsFor(step.goal(world, frame));
			this.frames = this.left = step.frames;
		}
		this.left--;
		const t =
			0.5 - 0.5 * Math.cos((Math.PI * (this.frames - this.left)) / this.frames);
		return this.from.map((v, i) => v + (this.to[i] - v) * t);
	}
}
