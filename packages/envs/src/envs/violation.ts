/**
 * Find the physics violation: each seed renders the falling scene twice
 * from one camera. `plausible` is the real run; `violated` branches from it
 * one frame before the violation (`state` / `from`), so the two clips are
 * identical until something impossible happens to one object: it teleports,
 * vanishes, falls through the floor, or gravity turns upward.
 */
import type { Env, EnvView } from "framefields/datasets";
import { random } from "framefields/datasets";
import {
	FALLING_CLIP,
	type FallingParams,
	fallingParams,
	fallingView,
} from "./falling.js";

export const VIOLATIONS = [
	"teleport",
	"vanish",
	"passThrough",
	"antigravity",
] as const;
export type ViolationKind = (typeof VIOLATIONS)[number];

export interface ViolationParams extends FallingParams {
	violation: {
		kind: ViolationKind;
		/** Simulation frame it happens at. */
		frame: number;
		/** Index of the object it happens to (`obj<index>`). */
		object: number;
		/** Teleport: where to, px. */
		to?: [number, number, number];
	};
}

function violationParams(seed: number): ViolationParams {
	const base = fallingParams(seed, [0]);
	// Draws after the scene's, so the scene is the same as `falling`'s.
	const r = random(seed ^ 0x5eed);
	const kind = r.pick(VIOLATIONS);
	const object = r.int(0, base.objects.length - 1);
	const from = base.objects[object].position;
	return {
		...base,
		violation: {
			kind,
			frame: r.int(16, 34),
			object,
			...(kind === "teleport" && {
				to: [
					Math.round(from[0] + r.pick([-1, 1]) * r.range(120, 200)),
					Math.round(r.range(150, 300)),
					Math.round(from[2]),
				] as [number, number, number],
			}),
		},
	};
}

export const fallingViolation: Env<ViolationParams> = {
	name: "falling-violation",
	description:
		"The falling scene as a pair: `plausible` (the real run) and `violated` (branched from it one frame before an object teleports, vanishes, falls through the floor, or gravity turns upward). The json's `params.violation` and `physics.interventions` say what and when.",
	...FALLING_CLIP,
	params: violationParams,
	async build(params): Promise<EnvView[]> {
		const { kind, frame, object, to } = params.violation;
		const [camera] = params.cameras;
		const plausible = await fallingView(params, camera, FALLING_CLIP, {
			name: "plausible",
			keepStates: [frame - 1],
		});
		const violated = await fallingView(params, camera, FALLING_CLIP, {
			name: "violated",
			from: plausible.world.state(frame - 1),
			intervene: (world, bodies) => {
				const at = world.at(frame);
				const body = bodies[object];
				if (kind === "teleport" && to) at.teleport(body, to);
				else if (kind === "vanish") at.vanish(body);
				else if (kind === "passThrough") at.passThrough(body);
				else at.gravity([0, -2400, 0]);
			},
		});
		return [plausible, violated];
	},
};
