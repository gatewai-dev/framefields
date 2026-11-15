/**
 * The benchmark's data on disk, without the engine: task names, the test
 * split's seeds, items and reading them back. The model runner imports only
 * this, so its process never loads the renderer (whose browser-like globals
 * API clients take for a browser).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const BENCH_NAME = "framefields-world-bench";
export const BENCH_VERSION = "1.0.0";

export const TASKS = ["violation", "predict", "recreate", "spatial"] as const;
export type TaskName = (typeof TASKS)[number];

/** One question: its images (in order), its prompt, and what scores it. */
export interface BenchItem {
	id: string;
	task: TaskName;
	seed: number;
	prompt: string;
	/** Image files, relative to the task's folder. */
	images: string[];
	/**
	 * What the prompt tells, as data (frame numbers, objects, camera,
	 * options), for models that do not read text.
	 */
	inputs: Record<string, unknown>;
	truth: unknown;
}

/** The seeds of each task's test split: far from the envs' usual 0-999. */
export const SPLITS: Record<TaskName, { first: number; count: number }> = {
	violation: { first: 900_000, count: 100 },
	predict: { first: 910_000, count: 100 },
	recreate: { first: 920_000, count: 100 },
	spatial: { first: 930_000, count: 100 },
};

/** The test split's seeds of a task (or its first `limit`). */
export function splitSeeds(task: TaskName, limit?: number): number[] {
	const { first, count } = SPLITS[task];
	return Array.from(
		{ length: Math.min(count, limit ?? count) },
		(_, i) => first + i,
	);
}

export function parseTasks(spec: string | undefined): TaskName[] {
	if (!spec) return [...TASKS];
	return spec.split(",").map((t) => {
		if (!(TASKS as readonly string[]).includes(t))
			throw new Error(`unknown task "${t}" (${TASKS.join(", ")})`);
		return t as TaskName;
	});
}

/** The items of `tasks` in a built benchmark folder. */
export function readItems(data: string, tasks: TaskName[]): BenchItem[] {
	return tasks.flatMap((task) => {
		const file = path.join(data, task, "items.jsonl");
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as BenchItem);
	});
}
