import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "../errors.js";
import type {
	CheckoutResult,
	Pipeline,
	RenderedFile,
	StepContext,
} from "../jobs/pipeline.js";
import type { JobInput, RenderSettings } from "../jobs/schema.js";
import { workerHealth } from "../worker/health.js";
import { type BoundEngine, bindEngine, markDepsLoaded } from "./engine.js";
import { clearWorkspaceRequireCache } from "./engine-alias.js";
import { buildPlan, importEntry, type PlanOutput } from "./load.js";
import { openSandbox } from "./sandbox.js";

const PROGRESS_INTERVAL_MS = 500;

/**
 * Pipeline step: imports the repo's entry into this process and renders every
 * output of its plan on the worker's warm GPU device (PLAN.md §8).
 */
export const render: Pipeline["render"] = async (checkout, input, ctx) => {
	// The project's own framefields, bound once per worker (§7).
	const engine = await bindEngine(checkout.workdir, checkout.root);
	markDepsLoaded(checkout.root);
	if (engine.workerHooks) {
		// Path-keyed caches from the previous job may hold stale bytes (§8.2).
		engine.mod.resetRenderCaches?.();
		engine.mod.FontManager?.clear();
	} else {
		// No cache reset, progress or abort in this version: render it, then
		// start fresh rather than risk stale caches in the next job.
		workerHealth.requestRecycle(
			`framefields ${engine.version} lacks worker hooks`,
		);
		ctx.warn(
			"ENGINE_NO_WORKER_HOOKS",
			`framefields ${engine.version} predates worker support (progress, cancel, cache reset); the worker restarts after this job.`,
		);
	}

	const outDir = path.join(ctx.jobDir, "out");
	await fs.mkdir(outDir, { recursive: true });

	// The render may be aborted by the job (cancel/timeout) or by the stall
	// detector; both go through this controller.
	const controller = new AbortController();
	const forward = () => controller.abort(ctx.signal.reason);
	if (ctx.signal.aborted) forward();
	ctx.signal.addEventListener("abort", forward, { once: true });

	const sandbox = openSandbox({
		cwd: checkout.workdir,
		argv1: path.join(checkout.workdir, input.target.entry),
		env: input.env,
	});
	const warnings: string[] = [];
	let dispose: (() => Promise<void>) | undefined;
	try {
		const work = (async () => {
			const files: RenderedFile[] = [];
			const plan = await withTimeout(
				loadPlan(checkout, input, ctx.jobId, (d) => {
					dispose = d;
				}),
				ctx.config.limits.timeouts.load,
				"load",
			);
			for (const output of plan) {
				const { Composition, Media } = engine.mod;
				const known =
					(Composition && output.target instanceof Composition) ||
					(Media && output.target instanceof Media);
				if (!known) {
					warnings.push(output.name);
				}
			}
			if (warnings.length) {
				ctx.warn(
					"ENGINE_FOREIGN_INSTANCE",
					`Outputs ${warnings.join(", ")} were built by a different copy of framefields than the project's; rendering them with the project's engine.`,
				);
			}
			for (const [index, output] of plan.entries()) {
				controller.signal.throwIfAborted();
				files.push(
					...(await renderOutput(
						output,
						index,
						plan.length,
						input.render,
						outDir,
						ctx,
						controller,
						engine,
					)),
				);
			}
			return files;
		})();

		const files = await raceWithGrace(
			work,
			sandbox.failed,
			controller.signal,
			ctx.config.limits.killGraceSec,
		);
		return {
			files,
			engine: {
				framefields: engine.version,
				source: "project",
				workerHooks: engine.workerHooks,
			},
		};
	} catch (err) {
		throw classifyRenderError(
			controller.signal.aborted ? controller.signal.reason : err,
			checkout.root,
		);
	} finally {
		ctx.signal.removeEventListener("abort", forward);
		sandbox.restore();
		clearWorkspaceRequireCache();
		await dispose?.().catch(() => {});
	}
};

async function loadPlan(
	checkout: CheckoutResult,
	input: JobInput,
	jobId: string,
	onLoaded: (dispose: () => Promise<void>) => void,
): Promise<PlanOutput[]> {
	const { mod, dispose } = await importEntry(
		checkout.workdir,
		input.target.entry,
		jobId,
	);
	onLoaded(dispose);
	return buildPlan(
		mod,
		input.target.export,
		input.target.args,
		input.target.select,
	);
}

/** Renders one plan output into one or more files. */
async function renderOutput(
	output: PlanOutput,
	index: number,
	count: number,
	defaults: RenderSettings,
	outDir: string,
	ctx: StepContext,
	controller: AbortController,
	engine: BoundEngine,
): Promise<RenderedFile[]> {
	const settings = { ...defaults, ...output.render } as RenderSettings;
	const renderer = new engine.mod.HeadlessMediaRenderer();
	// Without progress events there is nothing to measure stalls by.
	const stall = stallWatch(
		engine.workerHooks ? ctx.config.limits.stallTimeoutSec : 0,
		controller,
	);
	const base = path.join(outDir, `${index}-${output.name}`);

	try {
		switch (settings.kind) {
			case "video":
			case "audio": {
				const codec =
					settings.codec ?? (settings.kind === "audio" ? "aac" : "h264");
				const { ext, contentType } = containerFor(codec);
				const started = Date.now();
				let lastEmit = 0;
				let expectedFrames: number | undefined;
				const result = await output.target.renderVideo({
					outputPath: `${base}.${ext}`,
					codec,
					audioCodec: settings.audioCodec,
					quality: settings.quality,
					qa: settings.qa,
					renderer,
					signal: controller.signal,
					onProgress: (p: {
						phase: string;
						frame: number;
						totalFrames: number;
					}) => {
						stall.touch();
						expectedFrames = p.totalFrames;
						const now = Date.now();
						if (
							now - lastEmit < PROGRESS_INTERVAL_MS &&
							p.frame < p.totalFrames
						)
							return;
						lastEmit = now;
						const fps = p.frame / Math.max(0.001, (now - started) / 1000);
						ctx.progress({
							phase: p.phase === "audio" ? "encoding" : "rendering",
							output: count > 1 ? index : undefined,
							frame: p.frame,
							total: p.totalFrames,
							fps: Math.round(fps * 10) / 10,
							etaSec: Math.round(
								(p.totalFrames - p.frame) / Math.max(fps, 0.001),
							),
						});
					},
				});
				return [
					{
						name: output.name,
						path: result.filePath,
						ext,
						contentType,
						expectedFrames,
						...(result.qa !== undefined && { qa: result.qa }),
					},
				];
			}
			case "frames": {
				const files: RenderedFile[] = [];
				const frames = settings.frames ?? [0];
				for (const [i, frame] of frames.entries()) {
					controller.signal.throwIfAborted();
					const png = await output.target.renderFrame({ frame, renderer });
					stall.touch();
					const file = `${base}-f${String(frame).padStart(5, "0")}.png`;
					await fs.writeFile(file, png);
					files.push({
						name: `${output.name}-f${frame}`,
						path: file,
						ext: "png",
						contentType: "image/png",
					});
					ctx.progress({
						phase: "rendering",
						output: count > 1 ? index : undefined,
						frame: i + 1,
						total: frames.length,
					});
				}
				return files;
			}
			case "frameGrid": {
				if (!output.target.renderFrameGrid) {
					throw new RenderError(
						"EXPORT_INVALID",
						`Output ${output.name} can't render a frame grid.`,
						{ phase: "render" },
					);
				}
				const grid = settings.grid ?? {};
				const png = await output.target.renderFrameGrid({
					startFrame: grid.from,
					endFrame: grid.to,
					stepFrames: grid.step,
					...(grid.columns && { columns: grid.columns }),
					renderer,
				});
				const file = `${base}-grid.png`;
				await fs.writeFile(file, png);
				return [
					{
						name: output.name,
						path: file,
						ext: "png",
						contentType: "image/png",
					},
				];
			}
			case "lut": {
				const vm =
					output.target.toVirtualMedia?.() ?? output.target.virtualMedia;
				if (!vm) {
					throw new RenderError(
						"EXPORT_INVALID",
						`Output ${output.name} has no virtual media to bake a LUT from.`,
						{
							phase: "render",
						},
					);
				}
				const cube = await renderer.renderLut(
					vm as never,
					settings.frames?.[0] ?? 0,
				);
				const file = `${base}.cube`;
				await fs.writeFile(file, cube);
				return [
					{
						name: output.name,
						path: file,
						ext: "cube",
						contentType: "text/plain",
					},
				];
			}
		}
	} finally {
		stall.stop();
	}
}

export function containerFor(codec: string): {
	ext: string;
	contentType: string;
} {
	switch (codec) {
		case "vp8":
		case "vp9":
			return { ext: "webm", contentType: "video/webm" };
		case "gif":
			return { ext: "gif", contentType: "image/gif" };
		case "mp3":
			return { ext: "mp3", contentType: "audio/mpeg" };
		case "aac":
			return { ext: "m4a", contentType: "audio/mp4" };
		case "opus":
			return { ext: "webm", contentType: "audio/webm" };
		default:
			return { ext: "mp4", contentType: "video/mp4" };
	}
}

/** Aborts with RENDER_STALLED when no progress arrives for `seconds`. */
function stallWatch(seconds: number, controller: AbortController) {
	let last = Date.now();
	const timer =
		seconds > 0
			? setInterval(() => {
					if (
						Date.now() - last > seconds * 1000 &&
						!controller.signal.aborted
					) {
						controller.abort(
							new RenderError(
								"RENDER_STALLED",
								`No render progress for ${seconds}s.`,
								{ phase: "render" },
							),
						);
					}
				}, 1000)
			: undefined;
	timer?.unref();
	return {
		touch: () => {
			last = Date.now();
		},
		stop: () => clearInterval(timer),
	};
}

function withTimeout<T>(
	promise: Promise<T>,
	seconds: number,
	what: string,
): Promise<T> {
	if (seconds <= 0) return promise;
	let timer: NodeJS.Timeout | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new RenderError(
							"COMPOSITION_BUILD_FAILED",
							`Loading the entry took longer than ${seconds}s (${what}).`,
							{
								phase: "load",
								hint: "Is the export waiting on something that never resolves? Raise FF_TIMEOUT_LOAD_SEC if it's just slow.",
							},
						),
					),
				seconds * 1000,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * Waits for the render, a stray error from repo code, or an abort. Code that
 * ignores the abort gets `graceSec`; after that the job is reported anyway and
 * the worker recycles, since it can't stop that code in-process (§8.3).
 */
async function raceWithGrace<T>(
	work: Promise<T>,
	failed: Promise<never>,
	signal: AbortSignal,
	graceSec: number,
): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const abandoned = new Promise<never>((_, reject) => {
		const arm = () => {
			timer = setTimeout(() => {
				workerHealth.requestRecycle("render ignored abort");
				reject(signal.reason);
			}, graceSec * 1000);
		};
		if (signal.aborted) arm();
		else signal.addEventListener("abort", arm, { once: true });
	});
	work.catch(() => {}); // may settle after we've given up on it
	try {
		return await Promise.race([work, failed, abandoned]);
	} finally {
		clearTimeout(timer);
	}
}

export function classifyRenderError(
	err: unknown,
	repoRoot: string,
): RenderError {
	const scrub = (s: string) => s.replaceAll(repoRoot, "<repo>");
	if (err instanceof RenderError) {
		if (err.code === "GPU_DEVICE_LOST" || err.code === "RENDER_OOM")
			workerHealth.requestRecycle(err.code);
		return err;
	}
	const message = err instanceof Error ? err.message : String(err);
	const stack =
		err instanceof Error ? projectFrames(err.stack ?? "", repoRoot) : undefined;
	const details = stack ? { stack } : undefined;

	if (
		/device (was )?lost|GPUDevice.*lost|DeviceLost|VK_ERROR_DEVICE_LOST/i.test(
			message,
		)
	) {
		workerHealth.requestRecycle("GPU device lost");
		return new RenderError("GPU_DEVICE_LOST", scrub(message), {
			phase: "render",
			details,
			cause: err,
		});
	}
	if (
		/out of memory|OutOfMemory|Failed to allocate|allocation failed|ERR_OUT_OF_MEMORY/i.test(
			message,
		)
	) {
		workerHealth.requestRecycle("out of memory");
		return new RenderError("RENDER_OOM", scrub(message), {
			phase: "render",
			details,
			cause: err,
		});
	}
	if (/Cannot open local media file|ENOENT|no such file/i.test(message)) {
		return new RenderError("ASSET_NOT_FOUND", scrub(message), {
			phase: "render",
			details,
			hint: "If the file is tracked with LFS, make sure source.lfs.include covers it.",
			cause: err,
		});
	}
	if (
		/UnsupportedInputFormat|Unsupported.*format|Invalid data found/i.test(
			message,
		)
	) {
		return new RenderError("ASSET_NOT_FOUND", scrub(message), {
			phase: "render",
			details,
			hint: "The file isn't decodable media. An undownloaded LFS pointer looks like this too.",
			cause: err,
		});
	}
	return new RenderError("RENDER_FAILED", scrub(message), {
		phase: "render",
		details,
		cause: err,
	});
}

/** Keeps stack frames from the project, with paths made repo-relative. */
function projectFrames(stack: string, repoRoot: string): string | undefined {
	const frames = stack
		.split("\n")
		.filter((line) => line.includes(repoRoot) && !line.includes("node_modules"))
		.slice(0, 15)
		.map((line) => line.replaceAll(repoRoot, "<repo>").trim());
	return frames.length ? frames.join("\n") : undefined;
}
