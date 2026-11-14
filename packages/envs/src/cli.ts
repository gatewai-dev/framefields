/**
 * Generates a dataset:
 *
 *   pnpm --filter @framefields/envs generate <env> --seeds 0-99 --out <dir>
 *     [--frames all|0,12,24] [--shard 500] [--no-amodal] [--so101 <dir>]
 *     [--part <i>/<n> | --jobs <n>]
 *   pnpm --filter @framefields/envs generate card --out <dir>
 *
 * `--part` renders one worker's slice of the seeds (its own shards and a
 * manifest); `card` merges the manifests once every part is in. `--jobs`
 * does both with local processes.
 *
 * Envs: falling, falling-multiview, falling-violation, scenes,
 * scenes-multiview, so101. Writes WebDataset shards and a
 * dataset card (README.md) Hugging Face shows and loads with.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DatasetWriter } from "./dataset.js";
import { type Env, generate } from "./env.js";
import { falling, fallingMultiView } from "./envs/falling.js";
import { scenes, scenesMultiView } from "./envs/scenes.js";
import { so101 } from "./envs/so101.js";
import { fallingViolation } from "./envs/violation.js";
import {
	manifestName,
	mergeParts,
	type Part,
	type PartManifest,
	parsePart,
	partSeeds,
	partTag,
} from "./parts.js";

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

function datasetCard(
	env: Env<unknown>,
	seeds: number[],
	samples: number,
): string {
	return `---
license: apache-2.0
task_categories:
  - image-to-3d
  - depth-estimation
  - object-detection
tags:
  - synthetic
  - physics
  - world-models
  - framefields
---

# ${env.name}

${env.description}

Rendered with [framefields](https://framefields.dev): ${samples} samples,
${seeds.length} seeds, ${env.width}×${env.height}, ${env.fps} fps, ${env.frames}
frames per scene. The same seed renders the same bytes.

## Sample files (WebDataset: \`key.ext\`)

| Member | Contents |
|---|---|
| \`png\` | The rendered frame (RGBA). |
| \`depth.npy\` | float32 H×W: distance along the camera's forward axis, scene px; \`inf\` where empty. |
| \`normal.npy\` | float32 H×W×3: unit world normal (y down). |
| \`motion.npy\` | float32 H×W×2: px moved since the previous frame (x right, y down). |
| \`object.npy\` | uint32 H×W: object id at each pixel (0 none); see \`objects\` in the json. |
| \`instance.npy\` | uint32 H×W: instance of an instanced object. |
| \`json\` | \`env\`, \`seed\`, \`view\`, \`frame\`, \`params\` (what builds the scene), \`physics\` (simulation state and contacts at the frame), \`camera\` (intrinsics, view and projection matrices), \`objects\` (per object: layer id, \`label\` (what it is), pixels, visible 2D box, oriented 3D box, projected 2D box, and \`visibleFraction\` / \`amodalPixels\` / \`amodalBox2d\`: how much of it shows and its whole extent). |

Keys: \`<env>_s<seed>_<view>_f<frame>\`. Scene px: 100 px is a meter.

\`\`\`python
from datasets import load_dataset
ds = load_dataset("webdataset", data_files={"train": "shard-*.tar"}, split="train")
\`\`\`
`;
}

const USAGE = `usage:
  generate <env> --out <dir> [--seeds 0-99] [--frames all|0,12] [--shard 500] [--no-amodal]
  generate <env> --out <dir> --part <i>/<n>   one slice of the seeds (a worker's share)
  generate <env> --out <dir> --jobs <n>       n local worker processes, then the card
  generate card --out <dir> [--so101 <dir>]   merge part manifests and write the card`;

/** Renders the seeds (or a part of them) into `out`. */
async function renderPart(
	env: Env<unknown>,
	out: string,
	seeds: number[],
	options: { frames?: number[]; shard: number; amodal: boolean; part?: Part },
): Promise<{ shards: string[]; samples: number }> {
	const writer = new DatasetWriter({
		dir: out,
		samplesPerShard: options.shard,
		...(options.part && { prefix: `shard-${partTag(options.part)}` }),
	});
	const started = performance.now();
	let n = 0;
	await generate(env, {
		seeds,
		frames: options.frames,
		writer,
		amodal: options.amodal,
		onSample: (key) => {
			n++;
			if (n % 50 === 0) console.log(`${n} samples (${key})`);
		},
	});
	const result = writer.close();
	const shards = result.shards.map((f) => path.basename(f));
	if (options.part) {
		const manifest: PartManifest = {
			env: env.name,
			part: options.part,
			seeds,
			samples: result.samples,
			shards,
		};
		writeFileSync(
			path.join(out, manifestName(options.part)),
			`${JSON.stringify(manifest, null, "\t")}\n`,
		);
	}
	const seconds = (performance.now() - started) / 1000;
	console.log(
		`${options.part ? `part ${options.part.index}/${options.part.count}: ` : ""}${result.samples} samples in ${shards.length} shard(s), ${seconds.toFixed(1)} s (${(result.samples / seconds).toFixed(1)}/s): ${out}`,
	);
	return { shards, samples: result.samples };
}

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

function writeCard(
	env: Env<unknown>,
	out: string,
	seeds: number[],
	samples: number,
) {
	writeFileSync(path.join(out, "README.md"), datasetCard(env, seeds, samples));
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
		},
		allowNegative: true,
	});
	const [name] = positionals;
	const out = values.out;
	if (!name || !out) throw new Error(USAGE);
	if (name === "card") {
		const merged = mergeParts(out);
		const env = pickEnv(merged.env, values.so101);
		writeCard(env, out, merged.seeds, merged.samples);
		console.log(
			`${merged.samples} samples from ${merged.parts} parts (${merged.shards.length} shards): ${path.join(out, "README.md")}`,
		);
		return;
	}
	const env = pickEnv(name, values.so101);
	const seeds = parseList(values.seeds);
	if (values.jobs !== undefined) {
		const jobs = Number(values.jobs);
		if (!Number.isInteger(jobs) || jobs < 1)
			throw new Error("--jobs: a whole number of workers");
		await runJobs(jobs);
		const merged = mergeParts(out);
		writeCard(env, out, merged.seeds, merged.samples);
		console.log(`${merged.samples} samples from ${jobs} workers: ${out}`);
		return;
	}
	const part = values.part === undefined ? undefined : parsePart(values.part);
	const options = {
		frames: values.frames === "all" ? undefined : parseList(values.frames),
		shard: Number(values.shard),
		amodal: values.amodal,
		...(part && { part }),
	};
	const mine = part ? partSeeds(seeds, part) : seeds;
	const { samples } = await renderPart(env, out, mine, options);
	// A part leaves the card to `generate card` (or `--jobs`), once all are in.
	if (!part) writeCard(env, out, seeds, samples);
}

main().then(
	() => process.exit(0),
	(error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	},
);
