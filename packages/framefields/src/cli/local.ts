/**
 * `framefields render [name|entry]` and `framefields preview [name|entry]`
 * on this machine. They read the same named renders in framefields.json as
 * `--cloud`, so a render goes to the same file wherever it runs.
 *
 * A local render first downloads pinned assets that are missing here; a
 * preview doesn't need to: the page streams them from their bucket.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AssetsError, megabytes, pullAssets } from "./assets.js";
import { pickRender, renderOutput } from "./cloud.js";
import { findRender, readConfig } from "./config.js";
import type { LocalJob, LocalResult } from "./local-worker.js";
import { projectNodeArgs } from "./project-node.js";

export interface LocalCliOptions {
	/** A render named in framefields.json, or a module path. */
	entry?: string;
	export?: string;
	select?: string;
	codec?: string;
	quality?: string;
	output?: string;
	/** Project folder. Default `process.cwd()`. */
	cwd?: string;
}

export async function runLocal(
	mode: LocalJob["mode"],
	o: LocalCliOptions,
	log: (line: string) => void,
): Promise<number> {
	const cwd = o.cwd ?? process.cwd();
	const target = pickRender(o.entry, cwd);
	if ("error" in target) {
		log(target.error);
		return 2;
	}
	const spec = target.name ? findRender(cwd, target.name) : undefined;
	const entry = path.resolve(cwd, spec?.entry ?? (target.entry as string));
	const codec = o.codec ?? spec?.codec ?? "h264";
	if (codec !== "h264" && codec !== "vp9") {
		log(`--codec must be h264 or vp9, not "${codec}".`);
		return 2;
	}
	const engine = projectEngine(entry);
	if (!engine) {
		log("framefields isn't installed in this project: `npm i framefields`.");
		return 2;
	}
	const job: LocalJob = {
		mode,
		entry,
		engine,
		export: o.export ?? spec?.export ?? "buildFilm",
		args: spec?.args,
		select: o.select ?? spec?.select,
		codec,
		quality: o.quality ?? spec?.quality,
		outputPath: path.resolve(cwd, renderOutput(target, spec, codec, o.output)),
		title: spec?.title ?? target.name,
	};
	if (mode === "preview" && (job.args !== undefined || job.select))
		log(
			"The preview calls the export without args or select; it shows what the export returns by default.",
		);
	if (mode === "render" && !(await ensureAssets(cwd, log))) return 1;
	const result = await runWorker(job, cwd);
	if (!result.ok) {
		log(result.message);
		return 1;
	}
	if (result.filePath)
		log(`Rendered ${path.relative(cwd, result.filePath) || result.filePath}`);
	return 0;
}

/** The framefields the film imports, resolved from its module. */
function projectEngine(entry: string): string | undefined {
	try {
		return pathToFileURL(createRequire(entry).resolve("framefields")).href;
	} catch {
		return undefined;
	}
}

/** Downloads pinned assets missing here; false (after saying why) when it can't. */
async function ensureAssets(
	cwd: string,
	log: (line: string) => void,
): Promise<boolean> {
	const assets = readConfig(cwd).config.assets ?? {};
	if (Object.keys(assets).length === 0) return true;
	try {
		const { downloaded, changed } = await pullAssets({ cwd, log });
		if (downloaded.length) {
			const bytes = downloaded.reduce((n, p) => n + (assets[p]?.size ?? 0), 0);
			log(
				`Downloaded ${downloaded.length} pinned assets (${megabytes(bytes)}).`,
			);
		}
		if (changed.length)
			log(
				`Rendering local edits of pinned assets: ${changed.join(", ")}. \`framefields assets add\` pins them for the cloud.`,
			);
		return true;
	} catch (err) {
		if (!(err instanceof AssetsError)) throw err;
		log(err.message);
		return false;
	}
}

function runWorker(job: LocalJob, cwd: string): Promise<LocalResult> {
	const args = projectNodeArgs(job.entry, "local-worker");
	if ("error" in args)
		return Promise.resolve({ ok: false, message: args.error });
	return new Promise((done) => {
		const child = spawn(process.execPath, args, {
			cwd,
			stdio: ["inherit", "inherit", "inherit", "ipc"],
		});
		let result: LocalResult | undefined;
		child.on("message", (message: LocalResult) => {
			result = message;
		});
		child.on("error", (error) => done({ ok: false, message: error.message }));
		child.on("close", (code, signal) =>
			done(
				result ??
					(signal === "SIGINT" || code === 130
						? { ok: false, message: "Stopped." }
						: {
								ok: false,
								message: `The ${job.mode} exited without a result (code ${code}, signal ${signal}).`,
							}),
			),
		);
		child.send(job);
	});
}
