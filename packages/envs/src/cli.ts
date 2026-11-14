/**
 * Generates a dataset:
 *
 *   pnpm --filter @framefields/envs generate <env> --seeds 0-99 --out <dir>
 *     [--frames all|0,12,24] [--shard 500] [--no-amodal] [--so101 <dir>]
 *     [--part <i>/<n> | --jobs <n>]
 *   pnpm --filter @framefields/envs generate card --out <dir>
 *   pnpm --filter @framefields/envs generate <env> --seeds 0-999 --cloud --parts 8 --out <dir>
 *
 * `--part` renders one worker's slice of the seeds (its own shards and a
 * manifest); `card` merges the manifests once every part is in. `--jobs`
 * does both with local processes; `--cloud` does both on framefields cloud
 * GPUs (`renderCloud`: the commit must be pushed, FRAMEFIELDS_API_KEY set),
 * then downloads the dataset into `--out`.
 *
 * Envs: falling, falling-multiview, falling-violation, scenes,
 * scenes-multiview, so101. Writes WebDataset shards and a
 * dataset card (README.md) Hugging Face shows and loads with.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderCloud } from "framefields/cloud";
import {
	type Env,
	finishDataset,
	generateDataset,
	parsePart,
} from "framefields/datasets";
import { falling, fallingMultiView } from "./envs/falling.js";
import { scenes, scenesMultiView } from "./envs/scenes.js";
import { so101 } from "./envs/so101.js";
import { fallingViolation } from "./envs/violation.js";

/** "0-9" or "1,5,9" (or both, comma-separated). */
function parseList(spec: string): number[] {
	return spec.split(",").flatMap((part) => {
		const [a, b] = part.split("-").map(Number);
		if (!Number.isInteger(a) || (b !== undefined && !Number.isInteger(b)))
			throw new Error(`not a number list: ${spec}`);
		return b === undefined
			? [a]
			: Array.from({ length: b - a + 1 }, (_, i) => a + i);
	});
}

function pickEnv(name: string, so101Dir: string | undefined): Env<unknown> {
	if (name === "falling") return falling as Env<unknown>;
	if (name === "falling-multiview") return fallingMultiView as Env<unknown>;
	if (name === "falling-violation") return fallingViolation as Env<unknown>;
	if (name === "scenes") return scenes as Env<unknown>;
	if (name === "scenes-multiview") return scenesMultiView as Env<unknown>;
	if (name === "so101") {
		if (!so101Dir)
			throw new Error(
				"so101 needs --so101 <SO-ARM100/Simulation/SO101 folder>",
			);
		return so101(path.resolve(so101Dir)) as Env<unknown>;
	}
	throw new Error(
		`unknown env "${name}" (falling, falling-multiview, falling-violation, scenes, scenes-multiview, so101)`,
	);
}

const USAGE = `usage:
  generate <env> --out <dir> [--seeds 0-99] [--frames all|0,12] [--shard 500] [--no-amodal]
  generate <env> --out <dir> --part <i>/<n>   one slice of the seeds (a worker's share)
  generate <env> --out <dir> --jobs <n>       n local worker processes, then the card
  generate card --out <dir> [--so101 <dir>]   merge part manifests and write the card`;

/** Runs `jobs` copies of this command, each with its own `--part`. */
async function runJobs(jobs: number): Promise<void> {
	const args = process.argv.slice(2);
	const at = args.indexOf("--jobs");
	args.splice(at, 2);
	const children = Array.from(
		{ length: jobs },
		(_, i) =>
			new Promise<void>((resolve, reject) => {
				const child = spawn(
					process.execPath,
					[
						...process.execArgv,
						process.argv[1],
						...args,
						"--part",
						`${i}/${jobs}`,
					],
					{ stdio: "inherit" },
				);
				child.on("error", reject);
				child.on("exit", (code) =>
					code === 0
						? resolve()
						: reject(new Error(`part ${i}/${jobs} exited with ${code}`)),
				);
			}),
	);
	await Promise.all(children);
}

async function main() {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			seeds: { type: "string", default: "0-9" },
			frames: { type: "string", default: "all" },
			out: { type: "string" },
			shard: { type: "string", default: "500" },
			so101: { type: "string" },
			amodal: { type: "boolean", default: true },
			part: { type: "string" },
			jobs: { type: "string" },
			cloud: { type: "boolean", default: false },
			parts: { type: "string", default: "1" },
		},
		allowNegative: true,
	});
	const [name] = positionals;
	const out = values.out;
	if (!name || !out) throw new Error(USAGE);
	if (name === "card") {
		const merged = finishDataset(out, pickEnvOfParts(out, values.so101));
		console.log(
			`${merged.samples} samples from ${merged.parts} parts (${merged.shards.length} shards): ${path.join(out, "README.md")}`,
		);
		return;
	}
	const env = pickEnv(name, values.so101);
	const seeds = parseList(values.seeds);
	if (values.cloud) {
		const result = await renderCloud({
			cwd: path.resolve(import.meta.dirname, ".."),
			entry: "src/index.ts",
			export: cloudExport(name),
			dataset: {
				seeds,
				parts: Number(values.parts),
				...(values.frames !== "all" && { frames: parseList(values.frames) }),
				amodal: values.amodal,
			},
			outputPath: out,
			onProgress: (s) =>
				console.log(
					`${s.status}${s.dataset ? `: ${s.dataset.partsDone}/${s.dataset.parts} parts, ${s.dataset.samples} samples` : ""}, $${s.costUsd.toFixed(2)}`,
				),
		});
		console.log(
			`${result.gpuSeconds.toFixed(0)} GPU s, $${result.costUsd.toFixed(2)}: ${out}`,
		);
		return;
	}
	if (values.jobs !== undefined) {
		const jobs = Number(values.jobs);
		if (!Number.isInteger(jobs) || jobs < 1)
			throw new Error("--jobs: a whole number of workers");
		await runJobs(jobs);
		const merged = finishDataset(out, env);
		console.log(`${merged.samples} samples from ${jobs} workers: ${out}`);
		return;
	}
	const part = values.part === undefined ? undefined : parsePart(values.part);
	const started = performance.now();
	let n = 0;
	const result = await generateDataset(env, {
		out,
		seeds,
		...(part && { part }),
		frames: values.frames === "all" ? undefined : parseList(values.frames),
		shard: Number(values.shard),
		amodal: values.amodal,
		onSample: (key) => {
			n++;
			if (n % 50 === 0) console.log(`${n} samples (${key})`);
		},
	});
	const seconds = (performance.now() - started) / 1000;
	console.log(
		`${part ? `part ${part.index}/${part.count}: ` : ""}${result.samples} samples in ${result.shards.length} shard(s), ${seconds.toFixed(1)} s (${(result.samples / seconds).toFixed(1)}/s): ${out}`,
	);
}

/** The export of `src/index.ts` a cloud job renders for an env. */
function cloudExport(name: string): string {
	const exports: Record<string, string> = {
		falling: "falling",
		"falling-multiview": "fallingMultiView",
		"falling-violation": "fallingViolation",
		scenes: "scenes",
		"scenes-multiview": "scenesMultiView",
	};
	const exported = exports[name];
	if (!exported)
		throw new Error(
			`${name} does not run on the cloud (its model files are not in the repo)`,
		);
	return exported;
}

/** The env the part manifests in `dir` were rendered from. */
function pickEnvOfParts(
	dir: string,
	so101Dir: string | undefined,
): Env<unknown> {
	const manifest = readdirSync(dir).find((f) =>
		/^part-p\d+of\d+\.json$/.test(f),
	);
	if (!manifest) throw new Error(`no part manifests in ${dir}`);
	const { env } = JSON.parse(
		readFileSync(path.join(dir, manifest), "utf8"),
	) as {
		env: string;
	};
	return pickEnv(env, so101Dir);
}

main().then(
	() => process.exit(0),
	(error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	},
);
