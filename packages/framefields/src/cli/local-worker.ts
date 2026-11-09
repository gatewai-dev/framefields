/**
 * Runs a render or a preview of the user's module in its own Node process
 * (with the project's TypeScript loader), for `framefields render` and
 * `framefields preview`. Its options arrive over IPC; it reports back over
 * IPC and exits, since GPU and encoder threads keep Node alive otherwise.
 *
 * It uses the project's own framefields, as the cloud worker does: a second
 * copy of the engine next to the one the film imports would not share its
 * decoders.
 */
import { pathToFileURL } from "node:url";
import type { formatQaReport } from "../index.js";
import type { startPreview } from "../preview/index.js";
import type { buildWebBundle } from "../web/build.js";
import { pickComposition } from "./pick-composition.js";

export interface LocalJob {
	mode: "render" | "preview" | "bundle";
	/** Absolute module path. */
	entry: string;
	export: string;
	/** File URL of the project's framefields entry (for the preview). */
	engine: string;
	args?: unknown;
	select?: string;
	/** render: where the video goes. */
	outputPath?: string;
	codec?: string;
	quality?: string;
	/** preview and bundle: the page's title. */
	title?: string;
	/** bundle: extra files to ship. */
	include?: string[];
}

export type LocalResult =
	| { ok: true; filePath?: string; qaPassed?: boolean }
	| { ok: false; message: string };

async function run(job: LocalJob): Promise<LocalResult> {
	if (job.mode === "preview") {
		// The project's framefields: known only at runtime.
		const engine = (await import(job.engine)) as {
			startPreview: typeof startPreview;
		};
		const session = await engine.startPreview(
			{ entry: job.entry, export: job.export },
			{ title: job.title },
		);
		process.stdout.write(`Preview at ${session.url}\n`);
		await session.closed;
		return { ok: true };
	}
	if (job.mode === "bundle") {
		const engine = (await import(job.engine)) as {
			buildWebBundle: typeof buildWebBundle;
		};
		const result = await engine.buildWebBundle({
			entry: job.entry,
			export: job.export,
			outDir: job.outputPath as string,
			include: job.include,
			title: job.title,
		});
		const files = Object.keys(result.manifest.files).length;
		process.stdout.write(
			`${files} files, ${(result.bytes / 1e6).toFixed(1)} MB with the engine. Open its index.html over http(s) (WebGPU needs a secure context), or load the folder in a WKWebView.\n`,
		);
		for (const warning of result.warnings)
			process.stdout.write(`warning: ${warning}\n`);
		return { ok: true, filePath: result.outDir };
	}
	const mod: Record<string, unknown> = await import(
		pathToFileURL(job.entry).href
	);
	const comp = await pickComposition(mod, job);
	const result = await comp.renderVideo({
		outputPath: job.outputPath,
		...(job.codec && { codec: job.codec }),
		...(job.quality && { quality: job.quality }),
		// Dropped, black or frozen frames, loudness, clipping, truncated animations.
		qa: true,
	});
	await result.cleanup?.();
	if (result.qa) {
		const engine = (await import(job.engine)) as {
			formatQaReport: typeof formatQaReport;
		};
		process.stdout.write(`${engine.formatQaReport(result.qa)}\n`);
	}
	return {
		ok: true,
		filePath: result.filePath,
		...(result.qa && { qaPassed: result.qa.passed }),
	};
}

process.once("message", (job: LocalJob) => {
	process.channel?.ref();
	run(job).then(
		(result) => process.send?.(result, () => process.exit(0)),
		(error: unknown) =>
			process.send?.(
				{
					ok: false,
					message: error instanceof Error ? error.message : String(error),
				} satisfies LocalResult,
				() => process.exit(1),
			),
	);
});
