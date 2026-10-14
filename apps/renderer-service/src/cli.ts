import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { RenderError } from "./errors.js";
import { isTerminal, type JobRecord } from "./jobs/store.js";
import { bootWorker, exit } from "./worker/boot.js";

/**
 * One-shot render (FF_MODE=cli, PLAN.md §5):
 *   node dist/src/cli.js --job-file job.json [--result-file result.json]
 *   cat job.json | node dist/src/cli.js --job -
 * Logs go to stdout as JSON lines; the job record is written to
 * --result-file, or printed last on stdout as `{"ffResult": …}`.
 * Exit codes: 0 completed, 1 failed/cancelled, 2 bad invocation or job.
 */
const USAGE =
	"usage: cli.js (--job-file <path> | --job -) [--result-file <path>]";

function readJob(): unknown {
	const { values } = parseArgs({
		options: {
			"job-file": { type: "string" },
			job: { type: "string" },
			"result-file": { type: "string" },
		},
	});
	const source =
		values["job-file"] ?? (values.job === "-" ? "/dev/stdin" : undefined);
	if (!source) {
		console.error(USAGE);
		exit(2);
	}
	try {
		return JSON.parse(readFileSync(source as string, "utf8"));
	} catch (err) {
		console.error(
			`Could not read the job from ${source}: ${err instanceof Error ? err.message : err}`,
		);
		return exit(2);
	}
}

function report(record: JobRecord | { status: "FAILED"; error: unknown }) {
	const { values } = parseArgs({
		options: { "result-file": { type: "string" } },
		strict: false,
	});
	const file = values["result-file"];
	if (typeof file === "string")
		writeFileSync(file, JSON.stringify(record, null, 2));
	else process.stdout.write(`${JSON.stringify({ ffResult: record })}\n`);
}

process.env.FF_MODE ??= "cli";
const raw = readJob();
const worker = bootWorker();

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		if (interrupted) exit(130);
		interrupted = true;
		void worker.drain(
			new RenderError("CANCELLED", `Received ${signal}.`),
			true,
		);
	});
}

try {
	await worker.initGpu();
	const record = worker.runner.submit(raw);
	const done = await new Promise<JobRecord>((resolve) => {
		const check = (r: JobRecord) => {
			if (r.id === record.id && isTerminal(r.status)) resolve(r);
		};
		worker.runner.store.on("update", check);
		check(worker.runner.store.get(record.id) ?? record);
	});
	report(done);
	worker.stop();
	exit(done.status === "COMPLETED" ? 0 : 1);
} catch (err) {
	const error =
		err instanceof RenderError
			? err.toJSON()
			: { code: "INTERNAL", message: String(err) };
	report({ status: "FAILED", error });
	worker.stop();
	exit(err instanceof RenderError && err.code === "JOB_INVALID" ? 2 : 1);
}
