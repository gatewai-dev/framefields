/**
 * Runs the task's demo: each step's goal (the point between the jaws, the
 * line they close along, grip) is read when the step starts, turned into
 * joint targets, and eased toward over the step's frames.
 */
import type { SteelWorld } from "framefields";
import { CLOSED, OPEN, reachDown } from "./so101.js";
import type { Goal, Step } from "./task.js";

/** Joint targets (`JOINTS` order) for a goal. */
export function jointsFor(goal: Goal): number[] {
	return [
		...reachDown(goal.at, goal.jaws.axis, goal.jaws.period),
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
