/**
 * The recreate task scores answers by how they render, and the SO-101
 * environment builds (when its model files are present).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { falling } from "./envs/falling.js";
import { so101 } from "./envs/so101.js";
import { parseRecreateAnswer, scoreRecreate } from "./tasks/recreate.js";

const FRAMES = [0, 24, 47];

describe("recreate task", () => {
	it("scores the exact answer perfect and a wrong one lower", async () => {
		const target = falling.params(11);
		const { cameras: _, ...exact } = target;
		const perfect = await scoreRecreate(target, exact, FRAMES);
		expect(perfect.iou).toBe(1);
		expect(perfect.depthError).toBe(0);
		expect(perfect.psnr).toBe(99);
		expect(perfect.ssim).toBe(1);

		const moved = structuredClone(exact);
		moved.objects[0].position[0] += 60;
		const near = await scoreRecreate(target, moved, FRAMES);
		expect(near.iou).toBeLessThan(1);
		expect(near.iou).toBeGreaterThan(0.2);

		const wrong = {
			objects: [{ ...exact.objects[0], position: [100, -100, 0] }],
		};
		const far = await scoreRecreate(target, wrong, FRAMES);
		expect(far.iou).toBeLessThan(near.iou);
	});

	it("names what is wrong with an answer", () => {
		expect(() => parseRecreateAnswer({ objects: [] })).toThrow(
			"1 to 12 objects",
		);
		expect(() =>
			parseRecreateAnswer({
				objects: [
					{ shape: "cone", size: 20, color: "#ffffff", position: [0, 0, 0] },
				],
			}),
		).toThrow("objects[0].shape");
		expect(() =>
			parseRecreateAnswer({
				objects: [
					{ shape: "box", size: 20, color: "red", position: [0, 0, 0] },
				],
			}),
		).toThrow("objects[0].color");
	});
});

const SO101 =
	process.env.FRAMEFIELDS_SO101 ??
	path.resolve(import.meta.dirname, "../../../scratch/so101");

describe.skipIf(!existsSync(path.join(SO101, "so101_new_calib.xml")))(
	"so101 env",
	() => {
		it("follows its waypoints and renders the arm and cubes", async () => {
			const env = so101(SO101);
			const params = env.params(5);
			const [view] = await env.build(params);
			const state = view.physics?.(47) as { qpos: number[]; ctrl: number[] };
			// The joint drives track their targets (the arm's 6 joints come first).
			for (let j = 0; j < 4; j++) {
				expect(Math.abs(state.qpos[j] - state.ctrl[j])).toBeLessThan(0.15);
			}
			const truth = await view.composition.renderTruth(47);
			const labels = new Set(truth.scenes[0].objects.map((o) => o.label));
			expect(labels.has("cube0")).toBe(true);
			expect(truth.scenes[0].objects.length).toBeGreaterThan(15);
		});
	},
);
