import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Command } from "commander";
import { isFileReference, loadProject } from "framefields/project";
import type { Wrap } from "../cli.js";
import type { RenderJob } from "../cloud/client.js";
import { loadComposition, outputDir, resolveTarget } from "../compositions.js";
import type { Context } from "../context.js";
import { CliError, usageError } from "../errors.js";
import * as git from "../git/index.js";
import { parseRange } from "../timecode.js";

interface RenderOptions {
	local?: boolean;
	quality?: string;
	fps?: string;
	range?: string;
	ref?: string;
	type: string;
	wait?: boolean;
	download?: boolean;
	remote: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 2000;

export function register(program: Command, wrap: Wrap) {
	const render = program
		.command("render")
		.description(
			"Render a composition: on Framefields Cloud, or locally with --local (verification ladder, step 5)",
		)
		.argument("[composition]", "composition id or file#export")
		.option(
			"--local",
			"render here with the project's engine, to <output>/<id>.mp4",
		)
		.option("--quality <quality>", "encoder quality: low, medium, high")
		.option("--fps <fps>", "frames per second (default: the composition's)")
		.option(
			"--range <from..to>",
			"local only: render up to a frame or timecode, e.g. 0..120 or ..5s",
		)
		.option(
			"--ref <ref>",
			"cloud: the commit, branch or tag to render (default HEAD; must be pushed)",
		)
		.option("--type <type>", "cloud: video, frame or sheet", "video")
		.option("--wait", "cloud: wait until the render finishes")
		.option("--download", "cloud: wait, then save the deliverable to <output>/")
		.option(
			"--remote <name>",
			"cloud: the git remote HEAD must be pushed to",
			"origin",
		)
		.action(
			wrap(async (ctx, ref: string | undefined, opts: RenderOptions) => {
				if (opts.local) return renderLocal(ctx, ref, opts);
				return renderCloud(ctx, ref, opts);
			}),
		);

	render
		.command("status")
		.description("Show a render's status, progress and deliverable URL")
		.argument("<job>", "render job id")
		.option("--watch", "keep watching until it finishes")
		.action(
			wrap(async (ctx, jobId: string, opts: { watch?: boolean }) => {
				const job = opts.watch
					? await waitFor(ctx, jobId)
					: await (await ctx.client()).getRender(jobId);
				ctx.out.result(job, () => printJob(ctx, job));
				if (opts.watch && job.status !== "completed")
					throw new CliError(
						`render ${job.status}${job.errorMessage ? `: ${job.errorMessage}` : ""}`,
					);
			}),
		);

	render
		.command("list")
		.description("List render jobs for the linked repository")
		.option(
			"--status <status>",
			"queued, running, completed, failed or cancelled",
		)
		.option("--composition <id>", "only this composition")
		.action(
			wrap(async (ctx, opts: { status?: string; composition?: string }) => {
				const repo = await ctx.repo();
				let jobs = await (await ctx.client()).listRenders(repo.id);
				if (opts.status) jobs = jobs.filter((j) => j.status === opts.status);
				if (opts.composition)
					jobs = jobs.filter((j) => j.composition === opts.composition);
				jobs.sort((a, b) =>
					String(b.createdAt).localeCompare(String(a.createdAt)),
				);
				ctx.out.result(jobs, () => {
					if (jobs.length === 0) ctx.out.info("no render jobs");
					ctx.out.table(
						jobs.map((j) => ({
							id: j.id,
							status: j.status,
							composition: j.composition ?? `${j.entryPath}#${j.exportName}`,
							type: j.jobType,
							commit: j.commitSha.slice(0, 7),
							created: j.createdAt,
						})),
						["id", "status", "composition", "type", "commit", "created"].map(
							(key) => ({ key, label: key }),
						),
					);
				});
			}),
		);

	render
		.command("download")
		.description("Save a render's deliverable")
		.argument("<job>", "render job id")
		.option(
			"-o, --output <file>",
			"where to save it (default <output>/<composition>-<job>.<ext>)",
		)
		.action(
			wrap(async (ctx, jobId: string, opts: { output?: string }) => {
				const job = await (await ctx.client()).getRender(jobId);
				const file = await download(ctx, job, opts.output);
				ctx.out.result({ files: [file] }, () => ctx.out.line(file));
			}),
		);

	render
		.command("cancel")
		.description("Cancel a queued or running render")
		.argument("<job>", "render job id")
		.action(
			wrap(async (ctx, jobId: string) => {
				const client = await ctx.client();
				try {
					await client.cancelRender(jobId);
				} catch (err) {
					if (err instanceof CliError && /HTTP (404|405)/.test(err.message)) {
						throw new CliError(
							`${client.host} does not support cancelling renders yet`,
							{
								hint: "this needs POST /v1/renders/:id/cancel on the server",
							},
						);
					}
					throw err;
				}
				const job = await client.getRender(jobId);
				ctx.out.result(job, () => ctx.out.line(`${job.id} ${job.status}`));
			}),
		);
}

async function renderLocal(
	ctx: Context,
	ref: string | undefined,
	opts: RenderOptions,
) {
	const { project, target, composition, frameCount } = await loadComposition(
		ctx,
		ref,
	);
	if (opts.fps !== undefined) {
		const fps = Number(opts.fps);
		if (!(fps > 0 && fps <= 240))
			throw usageError(`--fps ${opts.fps} must be between 1 and 240`);
		composition.fps = fps;
	}
	if (opts.range) {
		const { from, to } = parseRange(opts.range, composition.fps);
		if (from) {
			throw usageError(
				"local renders start at frame 0",
				`use --range ..${opts.range.split(/\.\.|-/)[1] ?? ""} or ff frames for single frames`,
			);
		}
		if (to !== undefined) {
			const end = Math.min(to, frameCount - 1);
			composition.durationMs = ((end + 1) / composition.fps) * 1000;
		}
	}
	const file = path.join(await outputDir(project), `${target.id}.mp4`);
	const started = Date.now();
	ctx.out.info(`rendering ${target.id} to ${ctx.relative(project, file)}`);
	const result = await composition.renderVideo({
		outputPath: file,
		quality: opts.quality ?? "high",
	});
	await result.cleanup?.().catch(() => {});
	const rel = ctx.relative(project, result.filePath);
	ctx.out.info(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
	ctx.out.result({ files: [rel] }, () => ctx.out.line(rel));
}

async function renderCloud(
	ctx: Context,
	ref: string | undefined,
	opts: RenderOptions,
) {
	if (opts.range) throw usageError("--range is only supported with --local");
	if (!["video", "frame", "sheet"].includes(opts.type))
		throw usageError(`--type must be video, frame or sheet`);
	const client = await ctx.client();
	client.requireToken();
	const repo = await ctx.repo();
	const root = await ctx.gitRoot();
	const rev = opts.ref ?? "HEAD";
	const commitSha = await git.gitMaybe(
		["rev-parse", "--verify", `${rev}^{commit}`],
		root,
	);
	if (!commitSha)
		throw usageError(`'${rev}' is not a commit in this repository`);
	const pushed = await git.gitMaybe(
		[
			"for-each-ref",
			"--contains",
			commitSha,
			"--format=%(refname)",
			`refs/remotes/${opts.remote}`,
		],
		root,
	);
	if (!pushed) {
		throw new CliError(
			`${rev === "HEAD" ? "HEAD" : rev} (${commitSha.slice(0, 7)}) is not pushed to ${opts.remote}`,
			{
				hint: "ff push",
			},
		);
	}
	if (rev === "HEAD" && (await git.dirtyFiles(root)).length > 0) {
		ctx.out.warn("uncommitted changes are not part of the render");
	}

	const body: Parameters<typeof client.createRender>[0] = {
		repositoryId: repo.id,
		commitSha,
		jobType: opts.type as "video" | "frame" | "sheet",
		options: {
			...(opts.fps !== undefined && { fps: Number(opts.fps) }),
			...(opts.quality !== undefined && { quality: opts.quality }),
		},
	};
	if (ref && isFileReference(ref)) {
		// The cloud renders manifest ids or an explicit entry/export (no `#` parsing server-side).
		const project = await loadProject(ctx.cwd).catch(() => undefined);
		const target = project ? resolveTarget(project, ref) : undefined;
		const [entry, exportName = "default"] = ref.split("#");
		body.entryPath = target?.entry ?? entry;
		body.exportName = target?.export ?? exportName;
	} else if (ref) {
		body.composition = ref;
		const project = await loadProject(ctx.cwd).catch(() => undefined);
		if (project?.source === "manifest") resolveTarget(project, ref);
	}

	const created = await client.createRender(body);
	const url = `${client.host}/renders`;
	if (!opts.wait && !opts.download) {
		ctx.out.result({ ...created, url }, () => {
			ctx.out.line(created.jobId);
			ctx.out.info(
				`queued ${created.composition ?? body.entryPath} at ${commitSha.slice(0, 7)} · ${url}`,
			);
			ctx.out.info(`follow it: ff render status ${created.jobId} --watch`);
		});
		return;
	}
	ctx.out.info(
		`queued ${created.jobId} (${created.composition ?? body.entryPath} at ${commitSha.slice(0, 7)})`,
	);
	const job = await waitFor(ctx, created.jobId);
	if (job.status !== "completed") {
		ctx.out.result(job, () => printJob(ctx, job));
		throw new CliError(
			`render ${job.status}${job.errorMessage ? `: ${job.errorMessage}` : ""}`,
			{
				hint: `ff render status ${job.id}`,
			},
		);
	}
	const files = opts.download ? [await download(ctx, job)] : [];
	ctx.out.result({ ...job, files }, () => {
		if (files.length) for (const f of files) ctx.out.line(f);
		else printJob(ctx, job);
	});
}

/** Polls until the job finishes (`GET /v1/renders/:id/events` would replace this). */
async function waitFor(ctx: Context, jobId: string): Promise<RenderJob> {
	const client = await ctx.client();
	let last = "";
	for (;;) {
		const job = await client.getRender(jobId);
		const line = `${job.status}${typeof job.progress === "number" ? ` ${Math.round(job.progress * 100)}%` : ""}`;
		if (line !== last) ctx.out.info(`${jobId}: ${line}`);
		last = line;
		if (TERMINAL.has(job.status)) return job;
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
}

function printJob(ctx: Context, job: RenderJob) {
	ctx.out.view([
		["id", job.id],
		["status", job.status],
		["composition", job.composition ?? `${job.entryPath}#${job.exportName}`],
		["type", job.jobType],
		["commit", job.commitSha],
		[
			"progress",
			typeof job.progress === "number"
				? `${Math.round(job.progress * 100)}%`
				: undefined,
		],
		["created", job.createdAt],
		["completed", job.completedAt],
		["error", job.errorMessage ?? undefined],
		["download", job.downloadUrl],
	]);
}

const EXTENSIONS: Record<string, string> = {
	video: "mp4",
	frame: "png",
	sheet: "png",
};

async function download(
	ctx: Context,
	job: RenderJob,
	output?: string,
): Promise<string> {
	if (job.status !== "completed" || !job.downloadUrl) {
		throw new CliError(
			`render ${job.id} has no deliverable (status: ${job.status})`,
			{
				hint:
					job.status === "completed"
						? undefined
						: `ff render status ${job.id} --watch`,
			},
		);
	}
	const client = await ctx.client();
	const sameHost =
		!/^https?:\/\//.test(job.downloadUrl) ||
		job.downloadUrl.startsWith(client.host);
	const res = await client.raw("GET", job.downloadUrl, {
		anonymous: !sameHost,
	});
	if (!res.ok || !res.body)
		throw new CliError(`could not download ${job.id}: HTTP ${res.status}`);
	let file: string;
	if (output) file = path.resolve(ctx.cwd, output);
	else {
		const project = await ctx.project().catch(() => undefined);
		const dir = project ? await outputDir(project) : ctx.cwd;
		file = path.join(
			dir,
			`${job.composition ?? "render"}-${job.id}.${EXTENSIONS[job.jobType] ?? "bin"}`,
		);
	}
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.part`;
	await pipeline(
		Readable.fromWeb(res.body as never),
		fs.createWriteStream(tmp),
	);
	await fs.promises.rename(tmp, file);
	return path.relative(ctx.cwd, file) || file;
}
