/**
 * The violation pair: both views share their history up to the violation,
 * then only `violated` breaks physics; answers are scored against it.
 */
import { describe, expect, it } from "vitest";
import { fallingViolation, type ViolationParams } from "./envs/violation.js";
import { scoreViolation } from "./tasks/violation.js";

type Physics = {
	bodies: Array<{ layer: string; position: number[] }>;
	interventions: Array<{ kind: string; frame: number }>;
};

/** A seed whose violation is `kind`. */
function seedOf(kind: string): number {
	for (let seed = 0; seed < 200; seed++) {
		if (fallingViolation.params(seed).violation.kind === kind) return seed;
	}
	throw new Error(`no seed with ${kind}`);
}

describe("falling-violation", () => {
	for (const kind of ["teleport", "vanish", "passThrough", "antigravity"]) {
		it(`shares history until the ${kind}, then diverges`, async () => {
			const params = fallingViolation.params(seedOf(kind));
			const { frame, object } = params.violation;
			const [plausible, violated] = await fallingViolation.build(params);
			expect([plausible.name, violated.name]).toEqual([
				"plausible",
				"violated",
			]);
			const state = (v: typeof plausible, f: number) =>
				v.physics?.(f) as Physics;
			for (let f = 0; f < frame; f++) {
				expect(state(violated, f).bodies).toEqual(state(plausible, f).bodies);
			}
			const moved = (f: number) =>
				JSON.stringify(state(violated, f).bodies[object]) !==
				JSON.stringify(state(plausible, f).bodies[object]);
			// Within a few frames the object (or, for antigravity, the scene) differs.
			const diverged = [frame, frame + 2, frame + 6, 47].some((f) =>
				kind === "antigravity"
					? JSON.stringify(state(violated, f).bodies) !==
						JSON.stringify(state(plausible, f).bodies)
					: moved(f),
			);
			expect(diverged).toBe(true);
			expect(state(violated, 0).interventions.map((i) => i.frame)).toEqual([
				frame,
			]);
			expect(state(plausible, 0).interventions).toEqual([]);
		});
	}

	it("renders the vanished object out of the violated clip", async () => {
		const params = fallingViolation.params(seedOf("vanish"));
		const { frame, object } = params.violation;
		const [plausible, violated] = await fallingViolation.build(params);
		const layers = async (v: typeof plausible) =>
			new Set(
				(await v.composition.renderTruth(frame + 1)).scenes[0].objects
					.filter((o) => o.layer !== undefined)
					.map((o) => o.layer),
			);
		expect((await layers(plausible)).has(`obj${object}`)).toBe(true);
		expect((await layers(violated)).has(`obj${object}`)).toBe(false);
	});
});

describe("find-the-violation scoring", () => {
	const params: ViolationParams = fallingViolation.params(seedOf("teleport"));
	const { frame, object } = params.violation;
	it("scores answers", () => {
		expect(
			scoreViolation(params, "plausible", { violation: false }).score,
		).toBe(1);
		expect(scoreViolation(params, "plausible", { violation: true }).score).toBe(
			0,
		);
		expect(
			scoreViolation(params, "violated", {
				violation: true,
				frame: frame + 1,
				object: `obj${object}`,
			}).score,
		).toBe(1);
		expect(
			scoreViolation(params, "violated", { violation: true, frame: frame + 9 })
				.score,
		).toBe(0.5);
		expect(() =>
			scoreViolation(params, "violated", { violation: "yes" }),
		).toThrow("true or false");
	});
});
