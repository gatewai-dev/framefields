/**
 * The benchmark commands that need the engine: rendering the items
 * (`build`) and scoring replies (`score`, which renders `recreate` answers).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	BENCH_NAME,
	BENCH_VERSION,
	readItems,
	SPLITS,
	splitSeeds,
	type TaskName,
} from "./data.js";
import { buildItems } from "./items.js";
import { type ItemScore, scoreItem, summarize } from "./score.js";

/** Renders the test split of `tasks` (or each one's first `limit` seeds) into `out`. */
export async function build(out: string, tasks: TaskName[], limit?: number) {
	// Tasks built earlier into the same folder stay listed.
	const manifestFile = path.join(out, "manifest.json");
	const earlier = existsSync(manifestFile)
		? (JSON.parse(readFileSync(manifestFile, "utf8")) as {
				tasks?: Record<string, unknown>;
			})
		: {};
	const manifest = {
		name: BENCH_NAME,
		version: BENCH_VERSION,
		tasks: { ...earlier.tasks } as Record<string, unknown>,
	};
	for (const task of tasks) {
		const dir = path.join(out, task);
		mkdirSync(path.join(dir, "images"), { recursive: true });
		const lines: string[] = [];
		const started = performance.now();
		const seeds = splitSeeds(task, limit);
		for (const seed of seeds) {
			const built = await buildItems(task, seed);
			for (const [file, png] of built.images)
				writeFileSync(path.join(dir, file), png);
			for (const item of built.items) lines.push(JSON.stringify(item));
		}
		writeFileSync(path.join(dir, "items.jsonl"), `${lines.join("\n")}\n`);
		manifest.tasks[task] = {
			items: lines.length,
			seeds: { first: SPLITS[task].first, count: seeds.length },
		};
		console.log(
			`${task}: ${lines.length} items from ${seeds.length} seeds, ${((performance.now() - started) / 1000).toFixed(1)} s`,
		);
	}
	writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

interface ReplyLine {
	id: string;
	answer: unknown;
	error?: string;
	inputTokens?: number;
	outputTokens?: number;
}

/** A run's replies by item id: a good reply wins over a failed request. */
function readReplies(runDir: string): Map<string, ReplyLine> {
	const replies = new Map<string, ReplyLine>();
	const lines = readFileSync(path.join(runDir, "replies.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean);
	for (const line of lines) {
		const r = JSON.parse(line) as ReplyLine;
		if (!r.error || !replies.has(r.id)) replies.set(r.id, r);
	}
	return replies;
}

/** Scores a run's replies: `scores.jsonl` and `summary.json` in the run's folder. */
export async function score(data: string, runDir: string, tasks: TaskName[]) {
	const replies = readReplies(runDir);
	const scores: ItemScore[] = [];
	for (const item of readItems(data, tasks)) {
		const reply = replies.get(item.id);
		scores.push(
			!reply || reply.error
				? {
						id: item.id,
						task: item.task,
						score: 0,
						error: reply?.error ?? "not answered",
					}
				: await scoreItem(item, reply.answer),
		);
	}
	writeFileSync(
		path.join(runDir, "scores.jsonl"),
		`${scores.map((s) => JSON.stringify(s)).join("\n")}\n`,
	);
	const summary = summarize(scores);
	let inputTokens = 0;
	let outputTokens = 0;
	for (const r of replies.values()) {
		inputTokens += r.inputTokens ?? 0;
		outputTokens += r.outputTokens ?? 0;
	}
	const metaFile = path.join(runDir, "run.json");
	const meta = existsSync(metaFile)
		? JSON.parse(readFileSync(metaFile, "utf8"))
		: {};
	writeFileSync(
		path.join(runDir, "summary.json"),
		`${JSON.stringify({ ...meta, usage: { inputTokens, outputTokens }, tasks: summary }, null, 2)}\n`,
	);
	for (const [task, s] of Object.entries(summary))
		console.log(
			`${task}: ${s.score.toFixed(3)} over ${s.items} items (${s.invalid} invalid) ${JSON.stringify(s.measures)}`,
		);
}
