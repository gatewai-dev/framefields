/**
 * Runs dataset jobs in a real Node process with the project's engine bound
 * (as a worker would): two part jobs, then a finish job given their
 * manifests inline. Usage:
 *   tsx test/dataset-harness.ts <workspacesRoot> <workdir> <entry> <export> <outDir>
 * Prints one JSON line: each job's files (name, ext, bytes).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "../src/errors.js";
import type { StepContext } from "../src/jobs/pipeline.js";
import { jobSchema } from "../src/jobs/schema.js";
import { datasetOutput } from "../src/render/dataset.js";
import { locateEngine } from "../src/render/engine.js";
import {
	installEngineAlias,
	setEngineEntry,
} from "../src/render/engine-alias.js";
import { testConfig } from "../src/test-helpers.js";

const [root, workdir, entry, exportName, outDir] = process.argv.slice(2);
installEngineAlias([root]);
const found = locateEngine(path.join(root, workdir));
setEngineEntry(found.entryUrl);
const mod = (await import(found.entryUrl)) as {
	HeadlessMediaRenderer: { initialize(): Promise<void> };
};
await mod.HeadlessMediaRenderer.initialize();
const engine = {
	version: found.version,
	dir: found.dir,
	entryUrl: found.entryUrl,
	workspace: root,
	mod: mod as never,
	workerHooks: true,
};

const job = (dataset: unknown, id: string) => {
	const input = jobSchema.parse({
		version: 2,
		target: { entry, export: exportName },
		render: { kind: "dataset", dataset },
		output: { type: "inline" },
	});
	const ctx = {
		jobId: id,
		config: testConfig(),
		signal: new AbortController().signal,
		progress: () => {},
		warn: () => {},
		jobDir: path.join(outDir, id),
	} as StepContext;
	return { input, ctx };
};

const run = async (dataset: unknown, id: string) => {
	const { input, ctx } = job(dataset, id);
	const out = path.join(outDir, id);
	await fs.mkdir(out, { recursive: true });
	const disposers: Array<() => Promise<void>> = [];
	const files = await datasetOutput(
		path.join(root, workdir),
		input,
		out,
		ctx,
		new AbortController(),
		engine,
		(d) => disposers.push(d),
	);
	for (const d of disposers) await d();
	return files;
};

try {
	const seeds = { from: 0, to: 3 };
	const parts = [];
	for (const index of [0, 1])
		parts.push(
			await run(
				{ seeds, part: { index, count: 2 }, amodal: false, shard: 100000 },
				`part${index}`,
			),
		);
	const manifests = await Promise.all(
		parts.map(async (files) =>
			JSON.parse(
				await fs.readFile(
					files.find((f) => f.ext === "json")?.path ?? "",
					"utf8",
				),
			),
		),
	);
	const card = await run({ seeds, finish: { manifests } }, "finish");
	const describe = async (
		files: { name: string; ext: string; path: string }[],
	) =>
		Promise.all(
			files.map(async (f) => ({
				name: f.name,
				ext: f.ext,
				bytes: (await fs.stat(f.path)).size,
			})),
		);
	const readme = await fs.readFile(card[0].path, "utf8");
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			parts: await Promise.all(parts.map(describe)),
			card: await describe(card),
			samples: manifests.map((m) => m.samples),
			readme: readme.includes("samples,\n3 seeds"),
		})}\n`,
	);
} catch (err) {
	process.stdout.write(
		`${JSON.stringify({
			ok: false,
			code: err instanceof RenderError ? err.code : undefined,
			message: err instanceof Error ? err.message : String(err),
		})}\n`,
	);
}
process.exit(0);
