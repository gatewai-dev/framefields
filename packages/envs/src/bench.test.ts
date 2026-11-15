/**
 * The world bench: items are built the same every time with the images and
 * truth their prompts promise, right answers score 1, and replies are read
 * as models write them.
 */
import { describe, expect, it } from "vitest";
import { staticAnswer } from "./bench/baselines.js";
import { extractJson } from "./bench/claude.js";
import { splitSeeds, TASKS } from "./bench/data.js";
import {
	type BuiltItems,
	buildItems,
	type PredictTruth,
} from "./bench/items.js";
import { scoreItem } from "./bench/score.js";
import { scenes } from "./envs/scenes.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];

/**
 * The answer the truth gives. Recreate: the scene itself as program nodes,
 * without its pattern textures (shaders, which a program cannot hold;
 * object masks do not depend on them).
 */
async function rightAnswer(built: BuiltItems, k: number): Promise<unknown> {
	const item = built.items[k];
	const truth = item.truth as Record<string, unknown>;
	if (item.task === "violation") return truth;
	if (item.task === "predict")
		return { frames: (truth as unknown as PredictTruth).poses };
	if (item.task === "spatial") return { answer: truth.answer };
	const params = scenes.params(item.seed);
	const plain = {
		...params,
		objects: params.objects.map(({ pattern: _, ...o }) => o),
		floor: { color: params.floor.color },
	};
	const [view] = await scenes.build(plain);
	return {
		layout: view.composition
			.toProgram()
			.layout.filter((n) => n.kind !== "camera"),
	};
}

describe("world bench", () => {
	it.each(TASKS)("builds %s items the same every time", async (task) => {
		const [seed] = splitSeeds(task);
		const a = await buildItems(task, seed);
		const b = await buildItems(task, seed);
		expect(JSON.stringify(a.items)).toBe(JSON.stringify(b.items));
		expect([...a.images.keys()]).toEqual([...b.images.keys()]);
		for (const [file, png] of a.images) {
			expect(Array.from(png.subarray(0, 4))).toEqual(PNG);
			expect(Buffer.compare(png, b.images.get(file) ?? new Uint8Array())).toBe(
				0,
			);
		}
		for (const item of a.items) {
			expect(item.id.startsWith(`${task}-${seed}`)).toBe(true);
			expect(item.images.every((f) => a.images.has(f))).toBe(true);
			expect(item.images).toHaveLength(
				{ violation: 16, predict: 7, recreate: 1, spatial: 1 }[task],
			);
		}
	});

	it.each(TASKS)("scores the right %s answer 1", async (task) => {
		const [seed] = splitSeeds(task);
		const built = await buildItems(task, seed);
		for (let k = 0; k < built.items.length; k++) {
			const s = await scoreItem(built.items[k], await rightAnswer(built, k));
			expect(s.error).toBeUndefined();
			expect(s.score).toBeCloseTo(1, 6);
		}
	});

	it("scores the static baseline as chance", async () => {
		const built = await buildItems("violation", splitSeeds("violation")[0]);
		const scores = await Promise.all(
			built.items.map((i) => scoreItem(i, staticAnswer(i))),
		);
		expect(scores.map((s) => s.score)).toEqual([1, 0]);
	});

	it("reads the JSON in a reply", () => {
		expect(extractJson('{"answer": 3}')).toEqual({ answer: 3 });
		expect(extractJson('Sure:\n```json\n{"answer": "B"}\n```')).toEqual({
			answer: "B",
		});
		expect(extractJson('I think {"violation": false} fits.')).toEqual({
			violation: false,
		});
		expect(extractJson("no idea")).toBeNull();
		expect(extractJson('{"frames": {"29": {}}')).toBeNull();
	});
});
