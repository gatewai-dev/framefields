/**
 * The framefields world benchmark:
 *
 *   pnpm --filter @framefields/envs bench build --out <data> [--tasks violation,spatial] [--limit 10]
 *   pnpm --filter @framefields/envs bench run --data <data> --out <run> [--model claude-haiku-5-5] [--effort medium]
 *   pnpm --filter @framefields/envs bench baseline --data <data> --out <run>
 *   pnpm --filter @framefields/envs bench score --data <data> --run <run>
 *
 * `build` renders the test split: `<data>/<task>/items.jsonl` (id, prompt,
 * image files, inputs, truth) and `<data>/<task>/images/`, plus
 * `manifest.json`. `run` asks a Claude model every item (ANTHROPIC_API_KEY,
 * from the environment or the repository's `.env`; the model from
 * `--model`, else ANTHROPIC_MODEL) into `<run>/replies.jsonl`, resuming.
 * `baseline` writes a run of answers that look at nothing (the floor every
 * model should clear). `score` scores a run's replies into
 * `<run>/scores.jsonl` and `<run>/summary.json`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { staticAnswer } from "./baselines.js";
import { runClaude } from "./claude.js";
import {
	BENCH_NAME,
	BENCH_VERSION,
	parseTasks,
	readItems,
	type TaskName,
} from "./data.js";

/**
 * `build` and `score` render, so they load the engine; `run` must not (the
 * renderer's browser-like globals make API clients refuse to start), so the
 * engine is imported only for the commands that need it.
 */
const engine = () => import("./engine.js");

/** ANTHROPIC_* from the repository's `.env` when the environment lacks them. */
function loadEnv() {
	const file = path.resolve(import.meta.dirname, "../../../../.env");
	if (!process.env.ANTHROPIC_API_KEY && existsSync(file))
		process.loadEnvFile(file);
	if (!process.env.ANTHROPIC_API_KEY)
		throw new Error("ANTHROPIC_API_KEY is not set (environment or .env).");
}

async function run(
	data: string,
	out: string,
	tasks: TaskName[],
	model: string,
	effort: string | undefined,
	concurrency: number,
) {
	mkdirSync(out, { recursive: true });
	const items = readItems(data, tasks);
	const meta = path.join(out, "run.json");
	if (!existsSync(meta))
		writeFileSync(
			meta,
			`${JSON.stringify({ model, effort: effort ?? "default", bench: BENCH_NAME, version: BENCH_VERSION }, null, 2)}\n`,
		);
	let tokensIn = 0;
	let tokensOut = 0;
	let failed = 0;
	const replies = await runClaude(items, {
		dir: (item) => path.join(data, item.task),
		model,
		...(effort && { effort: effort as "low" }),
		out: path.join(out, "replies.jsonl"),
		concurrency,
		onReply: (r, done, total) => {
			tokensIn += r.inputTokens;
			tokensOut += r.outputTokens;
			if (r.error) {
				failed++;
				console.log(`${r.id}: ${r.error}`);
			}
			if (done % 25 === 0 || done === total)
				console.log(
					`${done}/${total} replies (${tokensIn} in, ${tokensOut} out tokens, ${failed} failed)`,
				);
		},
	});
	console.log(`${replies.length} new replies: ${out}`);
}

/** Writes the static baseline's replies as a run. */
function baseline(data: string, out: string, tasks: TaskName[]) {
	mkdirSync(out, { recursive: true });
	writeFileSync(
		path.join(out, "run.json"),
		`${JSON.stringify({ model: "baseline:static", bench: BENCH_NAME, version: BENCH_VERSION }, null, 2)}\n`,
	);
	const lines = readItems(data, tasks).map((item) =>
		JSON.stringify({
			id: item.id,
			model: "baseline:static",
			answer: staticAnswer(item),
			text: "",
			stopReason: null,
			inputTokens: 0,
			outputTokens: 0,
		}),
	);
	writeFileSync(path.join(out, "replies.jsonl"), `${lines.join("\n")}\n`);
	console.log(`${lines.length} static replies: ${out}`);
}

async function main() {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			out: { type: "string" },
			data: { type: "string" },
			run: { type: "string" },
			tasks: { type: "string" },
			limit: { type: "string" },
			model: { type: "string" },
			effort: { type: "string" },
			concurrency: { type: "string", default: "8" },
		},
	});
	const [command] = positionals;
	const tasks = parseTasks(values.tasks);
	const limit = values.limit === undefined ? undefined : Number(values.limit);
	if (command === "build" && values.out)
		return (await engine()).build(values.out, tasks, limit);
	if (command === "run" && values.data && values.out) {
		loadEnv();
		return run(
			values.data,
			values.out,
			tasks,
			values.model ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
			values.effort,
			Number(values.concurrency),
		);
	}
	if (command === "baseline" && values.data && values.out)
		return baseline(values.data, values.out, tasks);
	if (command === "score" && values.data && values.run)
		return (await engine()).score(values.data, values.run, tasks);
	throw new Error(`usage:
  bench build --out <data> [--tasks t1,t2] [--limit n]
  bench run --data <data> --out <run> [--model id] [--effort level] [--tasks …] [--concurrency 8]
  bench baseline --data <data> --out <run> [--tasks …]
  bench score --data <data> --run <run> [--tasks …]`);
}

main().then(
	() => process.exit(0),
	(error: unknown) => {
		console.error(error instanceof Error ? error.stack : error);
		process.exit(1);
	},
);
