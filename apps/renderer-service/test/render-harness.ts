/**
 * Runs the in-process render step for several jobs back to back in one real
 * Node process, the way a worker does. Usage:
 *   tsx test/render-harness.ts <workDir>
 * Prints one JSON line with each scenario's outcome. Needs a GPU.
 */
import { writeSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Composition } from "framefields";
import { buildConfig } from "../src/config/schema.js";
import { RenderError } from "../src/errors.js";
import type { CheckoutResult, StepContext } from "../src/jobs/pipeline.js";
import { jobSchema } from "../src/jobs/schema.js";
import { installEngineAlias } from "../src/render/engine-alias.js";
import { render } from "../src/render/render-step.js";
import { installProcessGuards } from "../src/render/sandbox.js";

const workDir = path.resolve(process.argv[2]);
const ws = path.join(workDir, "ws", "repo", "0");
await fs.mkdir(path.join(ws, "src"), { recursive: true });
await fs.mkdir(path.join(ws, "assets"), { recursive: true });
// The project's own framefields install (here: the one this package tests against).
await fs.mkdir(path.join(ws, "node_modules"), { recursive: true });
await fs.symlink(
	path.resolve(import.meta.dirname, "../node_modules/framefields"),
	path.join(ws, "node_modules/framefields"),
);
// Another repo pinned to a different framefields version.
const other = path.join(workDir, "ws", "other", "0");
await fs.mkdir(path.join(other, "node_modules/framefields"), {
	recursive: true,
});
await fs.writeFile(
	path.join(other, "package.json"),
	'{ "name": "other", "type": "module" }',
);
await fs.writeFile(
	path.join(other, "node_modules/framefields/package.json"),
	'{ "name": "framefields", "version": "9.9.9", "type": "module", "exports": "./index.js" }',
);
await fs.writeFile(
	path.join(other, "node_modules/framefields/index.js"),
	"export {};",
);
await fs.writeFile(
	path.join(other, "film.ts"),
	"export const buildFilm = () => null;",
);
installEngineAlias([await fs.realpath(path.join(workDir, "ws"))]);
// Surface stray errors instead of swallowing them (the worker logs them).
installProcessGuards((msg, err) => writeSync(2, `[harness] ${msg}: ${err}\n`));

const built = buildConfig(
	{
		FF_MODE: "cli",
		FF_REPO_ALLOWLIST: "github.com/acme/*",
		FF_WORK_DIR: workDir,
		FF_CACHE_DIR: path.join(workDir, "cache"),
		FF_KILL_GRACE_SEC: "2",
		FF_STALL_TIMEOUT_SEC: "30",
	},
	{ exists: () => false, tmpdir: () => workDir, homedir: () => workDir },
);
if (!built.ok) throw new Error(JSON.stringify(built.problems));
const config = built.config;
const root = await fs.realpath(ws);
const checkout: CheckoutResult = {
	root,
	workdir: root,
	sha: "x",
	cache: {},
	release: async () => {},
};
const otherRoot = await fs.realpath(other);
const otherCheckout: CheckoutResult = {
	root: otherRoot,
	workdir: otherRoot,
	sha: "y",
	cache: {},
	release: async () => {},
};

async function clip(color: string) {
	const comp = new Composition({
		width: 64,
		height: 64,
		fps: 24,
		durationFrames: 24,
		backgroundColor: color,
	});
	const out = await comp.renderVideo({});
	await fs.copyFile(out.filePath, path.join(ws, "assets/clip.mp4"));
	await out.cleanup();
}

async function job(
	name: string,
	target: Record<string, unknown>,
	render_: Record<string, unknown> = {},
	abortAfterMs?: number,
	on: CheckoutResult = checkout,
) {
	const input = jobSchema.parse({
		version: 2,
		source: { repo: "https://github.com/acme/films" },
		target,
		render: render_,
		output: { type: "inline" },
	});
	const controller = new AbortController();
	const warnings: string[] = [];
	const ctx: StepContext = {
		jobId: name,
		config,
		signal: controller.signal,
		jobDir: path.join(workDir, "jobs", name),
		progress: () => {},
		warn: (code) => warnings.push(code),
	};
	if (abortAfterMs !== undefined) {
		setTimeout(
			() => controller.abort(new RenderError("CANCELLED", "test cancel")),
			abortAfterMs,
		);
	}
	writeSync(
		2,
		`[harness] ${new Date().toISOString().slice(11, 19)} ${name} start\n`,
	);
	try {
		const result = await render(on, input, ctx);
		const files = await Promise.all(
			result.files.map(async (f) => ({
				name: f.name,
				ext: f.ext,
				bytes: (await fs.stat(f.path)).size,
				path: f.path,
			})),
		);
		writeSync(
			2,
			`[harness] ${new Date().toISOString().slice(11, 19)} ${name} ok\n`,
		);
		return { ok: true, files, warnings, cwdRestored: process.cwd() !== root };
	} catch (err) {
		writeSync(
			2,
			`[harness] ${new Date().toISOString().slice(11, 19)} ${name} failed: ${err instanceof Error ? err.message : err}\n`,
		);
		return {
			ok: false,
			code: err instanceof RenderError ? err.code : String(err),
			warnings,
			cwdRestored: process.cwd() !== root,
		};
	}
}

await fs.writeFile(
	path.join(ws, "package.json"),
	'{ "name": "film", "type": "module" }',
);
await fs.writeFile(
	path.join(ws, "src/film.ts"),
	`import { Composition, Layer } from "framefields";
	 export function buildFilm(args?: { color?: string }) {
		const comp = new Composition({ width: 64, height: 64, fps: 24, durationFrames: 24, backgroundColor: args?.color ?? "#000000" });
		comp.add(Layer.video("assets/clip.mp4", { width: 32, height: 32, muted: true }));
		return comp;
	 }
	 export const cuts = () => ({ main: buildFilm(), teaser: buildFilm({ color: "#ff0000" }) });
	 export const slow = () => new Composition({ width: 640, height: 360, fps: 30, durationFrames: 3000, backgroundColor: "#123456" });`,
);
await fs.writeFile(path.join(ws, "src/exits.ts"), "process.exit(3);");

const results: Record<string, unknown> = {};
await clip("#00ff00");
results.video1 = await job("video1", {
	entry: "src/film.ts",
	export: "buildFilm",
});
// Same asset path, different bytes: the next job must decode the new file.
await clip("#0000ff");
results.video2 = await job("video2", {
	entry: "src/film.ts",
	export: "buildFilm",
});
results.frames = await job(
	"frames",
	{ entry: "src/film.ts", export: "cuts", select: ["teaser"] },
	{ kind: "frames", frames: [0, 12] },
);
results.exits = await job("exits", { entry: "src/exits.ts" });
results.cancel = await job(
	"cancel",
	{ entry: "src/film.ts", export: "slow" },
	{},
	1500,
);
results.after = await job("after", {
	entry: "src/film.ts",
	export: "buildFilm",
});
// Last: a repo pinned to another framefields version can't share this process.
results.switch = await job(
	"switch",
	{ entry: "film.ts", export: "buildFilm" },
	{},
	undefined,
	otherCheckout,
);

const bytes = async (r: unknown) => {
	const f = (r as { files?: { path: string }[] }).files?.[0];
	return f ? fs.readFile(f.path) : undefined;
};
const [a, b] = await Promise.all([
	bytes(results.video1),
	bytes(results.video2),
]);
results.videosDiffer = Boolean(a && b && Buffer.compare(a, b) !== 0);

process.stdout.write(`${JSON.stringify(results)}\n`);
process.exit(0);
