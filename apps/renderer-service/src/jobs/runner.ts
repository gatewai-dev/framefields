import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loggerContext, rendererLogger } from "@framefields/server-utils";
import type { RendererConfig } from "../config/index.js";
import { type JobPhase, RenderError, toRenderError } from "../errors.js";
import { redact, redactValue } from "../redact.js";
import type { Pipeline, StepContext } from "./pipeline.js";
import { JobQueue } from "./queue.js";
import { type JobRecord, JobStore } from "./store.js";
import { type ValidatedJob, validateJob } from "./validate.js";

/**
 * Accepts jobs, queues them one at a time, and drives each through the
 * pipeline: checkout → install → render → deliver (PLAN.md §3).
 */
export class JobRunner {
	readonly store: JobStore;
	readonly queue: JobQueue;
	private completedJobs = 0;

	constructor(
		private readonly config: RendererConfig,
		private readonly pipeline: Pipeline,
		private readonly hooks: { afterJob?: (completed: number) => void } = {},
	) {
		this.store = new JobStore(
			config.limits.jobTtlSec * 1000,
			config.limits.jobHistoryMax,
		);
		this.queue = new JobQueue(config.limits.queueMax);
	}

	/** Validates and queues a job. Throws RenderError (JOB_INVALID, BUSY, …). */
	submit(raw: unknown): JobRecord {
		const job = validateJob(raw, this.config);
		const id = randomUUID();
		const record = this.store.create(id);
		try {
			this.queue.enqueue({
				id,
				// Job logs carry the jobId, not the submitting request's context.
				run: (signal) =>
					loggerContext.run({ component: "job", jobId: id }, () =>
						this.execute(id, job, signal),
					),
				onCancelledWhileQueued: (reason) => this.fail(id, reason),
			});
		} catch (err) {
			this.fail(id, toRenderError(err, "validate"));
			throw err;
		}
		return record;
	}

	cancel(id: string): boolean {
		return this.queue.cancel(
			id,
			new RenderError("CANCELLED", "Cancelled by request."),
		);
	}

	private async execute(
		id: string,
		job: ValidatedJob,
		signal: AbortSignal,
	): Promise<void> {
		const started = Date.now();
		const timings: Record<string, number> = {};
		const cache: Record<string, string> = {};
		const warnings: string[] = [];
		const jobDir = path.join(this.config.paths.workDir, "jobs", id);
		let phase: JobPhase = "resolve";

		// Total timeout: abort with RENDER_TIMEOUT unless something else aborts first.
		const controller = new AbortController();
		const onAbort = () => controller.abort(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(
			() =>
				controller.abort(
					new RenderError(
						"RENDER_TIMEOUT",
						`Job exceeded its ${job.timeoutSec}s timeout.`,
						{
							phase,
						},
					),
				),
			job.timeoutSec * 1000,
		);

		const ctx: StepContext = {
			jobId: id,
			config: this.config,
			signal: controller.signal,
			jobDir,
			progress: (p) => this.store.update(id, { progress: p }),
			warn: (code, message) => {
				warnings.push(`${code}: ${redact(message)}`);
				this.store.update(id, { warnings: [...warnings] });
			},
		};
		const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
			const t0 = Date.now();
			try {
				return await fn();
			} finally {
				timings[`${name}Ms`] = Date.now() - t0;
			}
		};
		const checkAbort = () => {
			if (controller.signal.aborted)
				throw toRenderError(controller.signal.reason, phase);
		};

		this.store.update(id, {
			status: "IN_PROGRESS",
			startedAt: new Date().toISOString(),
			progress: { phase: "resolving" },
		});
		rendererLogger.info(
			{ jobId: id, repo: job.repo.id, ref: job.ref },
			"Job started",
		);

		let release: (() => Promise<void>) | undefined;
		let succeeded = false;
		try {
			await fs.mkdir(path.join(jobDir, "out"), { recursive: true });

			const checkout = await timed("checkout", () =>
				this.pipeline.checkout(job, ctx),
			);
			release = checkout.release;
			Object.assign(cache, checkout.cache);
			checkAbort();

			phase = "install";
			ctx.progress({ phase: "installing" });
			const install = await timed("install", () =>
				this.pipeline.install(checkout, ctx),
			);
			Object.assign(cache, install.cache);
			checkAbort();

			phase = "render";
			ctx.progress({ phase: "loading" });
			const rendered = await timed("render", () =>
				this.pipeline.render(checkout, job.input, ctx),
			);
			checkAbort();

			phase = "upload";
			ctx.progress({ phase: "uploading" });
			const outputs = await timed("upload", () =>
				this.pipeline.deliver(
					rendered.files,
					{ input: job.input, sha: checkout.sha, ref: job.ref },
					ctx,
				),
			);
			checkAbort();

			timings.totalMs = Date.now() - started;
			this.store.update(id, {
				status: "COMPLETED",
				progress: { phase: "done" },
				result: redactValue({
					jobId: id,
					source: {
						repo: job.repo.id,
						ref: job.ref,
						sha: checkout.sha,
						workdir: job.input.source.workdir,
					},
					engine: {
						...rendered.engine,
						projectDeclared: install.declaredEngine,
					},
					outputs,
					timings,
					cache,
					warnings,
				}),
			});
			succeeded = true;
			rendererLogger.info({ jobId: id, timings }, "Job completed");
		} catch (err) {
			const reason = controller.signal.aborted ? controller.signal.reason : err;
			this.fail(id, toRenderError(reason, phase), { timings, cache });
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			await release?.().catch((err) =>
				rendererLogger.warn(
					{ jobId: id, err: String(err) },
					"Workspace release failed",
				),
			);
			if (succeeded || !this.config.keepFailedJobs) {
				await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
			}
			this.completedJobs++;
			this.hooks.afterJob?.(this.completedJobs);
		}
	}

	private fail(
		id: string,
		error: RenderError,
		extra: Record<string, unknown> = {},
	): void {
		const json = redactValue(error.toJSON());
		rendererLogger.warn({ jobId: id, error: json }, "Job failed");
		this.store.update(id, {
			status: error.code === "CANCELLED" ? "CANCELLED" : "FAILED",
			error: json,
			...(Object.keys(extra).length > 0 && { result: redactValue(extra) }),
		});
	}
}
