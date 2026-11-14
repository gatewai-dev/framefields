/**
 * kind=dataset: the job's entry exports an `Env` (framefields/datasets), or
 * a function returning one. A part job renders its share of the seeds with
 * the project's own `generateDataset` into WebDataset shards and the part's
 * manifest; a finish job downloads every part's manifest, checks them with
 * `finishDataset` and writes the dataset card. Files come back in a fixed
 * order (shards, then the manifest, then the card), so a caller that knows
 * how many shards a part writes can presign each upload.
 */

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RenderError } from "../errors.js";
import type { RenderedFile, StepContext } from "../jobs/pipeline.js";
import type { DatasetSettings, JobInput } from "../jobs/schema.js";
import { isUrl } from "../jobs/validate.js";
import { downloadS3, downloadUrl } from "../output/sinks.js";
import type { BoundEngine } from "./engine.js";
import { importEntry } from "./load.js";

/** The slice of an env the worker checks before rendering it. */
interface EnvShape {
	name: string;
	fps: number;
	frames: number;
	width: number;
	height: number;
	description: string;
	params(seed: number): unknown;
	build(params: unknown): Promise<unknown[]>;
}

/** The parts of `framefields/datasets` the worker calls. */
interface DatasetsModule {
	generateDataset(
		env: EnvShape,
		options: {
			out: string;
			seeds: number[];
			part?: { index: number; count: number };
			frames?: number[];
			shard?: number;
			amodal?: boolean;
			onSample?: (key: string) => void;
		},
	): Promise<{ seeds: number[]; samples: number; shards: string[] }>;
	finishDataset(
		out: string,
		env: EnvShape,
	): { env: string; seeds: number[]; samples: number; parts: number };
	manifestName(part: { index: number; count: number }): string;
}

/** The project's `framefields/datasets`, from the bound engine's package. */
async function loadDatasets(engine: BoundEngine): Promise<DatasetsModule> {
	let file: string;
	try {
		file = createRequire(path.join(engine.dir, "package.json")).resolve(
			"framefields/datasets",
		);
	} catch {
		throw new RenderError(
			"ENGINE_UNSUPPORTED",
			`framefields ${engine.version} can't render datasets: it has no framefields/datasets.`,
			{
				phase: "render",
				hint: "Update framefields in the project to a version with datasets.",
			},
		);
	}
	return (await import(
		/* @vite-ignore */ pathToFileURL(file).href
	)) as DatasetsModule;
}

function isEnv(value: unknown): value is EnvShape {
	const v = value as Partial<EnvShape> | null;
	return (
		typeof v === "object" &&
		v !== null &&
		typeof v.name === "string" &&
		typeof v.params === "function" &&
		typeof v.build === "function" &&
		typeof v.fps === "number" &&
		typeof v.frames === "number"
	);
}

/** The entry's export as an env: the object, or what its function returns. */
async function loadEnv(
	workdir: string,
	input: JobInput,
	jobId: string,
	onLoaded: (dispose: () => Promise<void>) => void,
): Promise<EnvShape> {
	const { mod, dispose } = await importEntry(
		workdir,
		input.target.entry,
		jobId,
	);
	onLoaded(dispose);
	const name = input.target.export;
	let value = mod[name];
	if (typeof value === "function" && !isEnv(value))
		value = await (value as (args: unknown) => unknown)(input.target.args);
	if (!isEnv(value))
		throw new RenderError(
			"EXPORT_INVALID",
			`Export ${name} of ${input.target.entry} is not a dataset env (name, fps, frames, params, build).`,
			{ phase: "load" },
		);
	return value;
}

/** Seeds as a list. */
export function seedList(seeds: DatasetSettings["seeds"]): number[] {
	return Array.isArray(seeds)
		? seeds
		: Array.from({ length: seeds.to - seeds.from }, (_, i) => seeds.from + i);
}

const CONTENT_TYPES: Record<string, string> = {
	tar: "application/x-tar",
	json: "application/json",
	md: "text/markdown",
};

/** The files in `dir` in delivery order: shards, then the manifest, then the card. */
async function collect(dir: string): Promise<RenderedFile[]> {
	const names = (await fs.readdir(dir)).sort();
	const rank = (f: string) =>
		f.endsWith(".tar") ? 0 : f.endsWith(".json") ? 1 : 2;
	return names
		.filter((f) => /\.(tar|json|md)$/.test(f))
		.sort((a, b) => rank(a) - rank(b))
		.map((f) => {
			const ext = path.extname(f).slice(1);
			return {
				name: path.basename(f, `.${ext}`),
				path: path.join(dir, f),
				ext,
				contentType: CONTENT_TYPES[ext],
			};
		});
}

/** Renders a dataset part, or finishes a dataset from its parts' manifests. */
export async function datasetOutput(
	workdir: string,
	input: JobInput,
	outDir: string,
	ctx: StepContext,
	controller: AbortController,
	engine: BoundEngine,
	onLoaded: (dispose: () => Promise<void>) => void,
): Promise<RenderedFile[]> {
	const settings = input.render.dataset;
	if (!settings)
		throw new RenderError("JOB_INVALID", "render.dataset is missing.");
	const datasets = await loadDatasets(engine);
	const env = await loadEnv(workdir, input, ctx.jobId, onLoaded);
	const dir = path.join(outDir, "dataset");
	await fs.mkdir(dir, { recursive: true });
	const seeds = seedList(settings.seeds);

	if (settings.finish) {
		const { finish } = settings;
		const bucket = finish.bucket ?? ctx.config.storage.bucket;
		for (const [i, manifest] of finish.manifests.entries()) {
			controller.signal.throwIfAborted();
			if (typeof manifest !== "string") {
				// Given inline: written under the name a part job gives it.
				await fs.writeFile(
					path.join(dir, datasets.manifestName(manifest.part)),
					JSON.stringify(manifest),
				);
				continue;
			}
			// mergeParts reads `part-*.json`; the name in the key or URL is kept.
			const name = path.basename(
				isUrl(manifest) ? new URL(manifest).pathname : manifest,
			);
			if (!/^part-p\d+of\d+\.json$/.test(name))
				throw new RenderError(
					"JOB_INVALID",
					`Manifest ${i} is not a part manifest (part-p<i>of<n>.json).`,
				);
			const file = path.join(dir, name);
			if (isUrl(manifest)) await downloadUrl(manifest, file, controller.signal);
			else if (bucket)
				await downloadS3(ctx.config, bucket, manifest, file, controller.signal);
			else
				throw new RenderError(
					"JOB_INVALID",
					"Manifests given as keys need STORAGE_BUCKET or finish.bucket.",
				);
		}
		let merged: ReturnType<DatasetsModule["finishDataset"]>;
		try {
			merged = datasets.finishDataset(dir, env);
		} catch (err) {
			throw new RenderError(
				"JOB_INVALID",
				`The parts do not make one dataset: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (merged.seeds.length !== seeds.length)
			throw new RenderError(
				"JOB_INVALID",
				`The parts hold ${merged.seeds.length} seeds; the job names ${seeds.length}.`,
			);
		ctx.progress({
			phase: "rendering",
			message: `${merged.samples} samples from ${merged.parts} parts`,
		});
		return (await collect(dir)).filter((f) => f.ext === "md");
	}

	let samples = 0;
	await datasets.generateDataset(env, {
		out: dir,
		seeds,
		...(settings.part && { part: settings.part }),
		...(settings.frames && { frames: settings.frames }),
		...(settings.shard && { shard: settings.shard }),
		...(settings.amodal !== undefined && { amodal: settings.amodal }),
		onSample: (key) => {
			controller.signal.throwIfAborted();
			ctx.progress({ phase: "rendering", frame: ++samples, message: key });
		},
	});
	return collect(dir);
}
