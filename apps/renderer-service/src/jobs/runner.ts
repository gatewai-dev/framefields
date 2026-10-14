import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loggerContext, rendererLogger } from "@framefields/server-utils";
import type { RendererConfig } from "../config/index.js";
import { type JobPhase, RenderError, toRenderError } from "../errors.js";
import { redact, redactValue } from "../redact.js";
import type { CrashJournal } from "./journal.js";
import type { DeliveredFile, Pipeline, StepContext } from "./pipeline.js";
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
		private readonly hooks: {
			afterJob?: (completed: number) => void;
			/** Awaited before checkout, between jobs (e.g. cache eviction). */
			beforeJob?: (job: ValidatedJob) => Promise<void>;
			journal?: CrashJournal;
		} = {},
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

		const record = this.store.update(id, {
			status: "IN_PROGRESS",
			startedAt: new Date().toISOString(),
			progress: { phase: "resolving" },
		});
		this.hooks.journal?.begin({
			jobId: id,
			createdAt: record?.createdAt ?? new Date().toISOString(),
			startedAt: record?.startedAt ?? new Date().toISOString(),
		});
		rendererLogger.info(
			{ jobId: id, repo: job.repo.id, ref: job.ref },
			"Job started",
		);

		let release: (() => Promise<void>) | undefined;
		let succeeded = false;
		let settle: (() => unknown) | undefined;
		try {
			await this.hooks.beforeJob?.(job);
			await fs.mkdir(path.join(jobDir, "out"), { recursive: true });

			const checkout = await timed("checkout", () =>
				this.pipeline.checkout(job, ctx),
			);
			release = checkout.release;
			Object.assign(cache, checkout.cache);
			checkAbort();

			const existing = await this.pipeline.findExisting?.(
				job.input,
				checkout.sha,
				ctx,
			);
			let engine: Record<string, unknown> = {};
			let outputs: DeliveredFile[];
			if (existing) {
				// An earlier attempt of this job already delivered this commit.
				cache.output = "hit";
				outputs = existing;
			} else {
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
				engine = {
					...rendered.engine,
					projectDeclared: install.declaredEngine,
				};
				checkAbort();

				phase = "upload";
				ctx.progress({ phase: "uploading" });
				outputs = await timed("upload", () =>
					this.pipeline.deliver(
						rendered.files,
						{ input: job.input, sha: checkout.sha, ref: job.ref },
						ctx,
					),
				);
				checkAbort();
			}

			timings.totalMs = Date.now() - started;
			settle = () =>
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
						engine,
						outputs,
						timings,
						cache,
						warnings,
					}),
				});
			succeeded = true;
		} catch (err) {
			const reason = controller.signal.aborted ? controller.signal.reason : err;
			settle = () =>
				this.fail(id, toRenderError(reason, phase), { timings, cache });
		} finally {
			clearTimeout(timer);
			this.hooks.journal?.end();
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
			// Decide on recycling before the job is visibly finished, so a client
			// that sees the result also sees /health report "draining".
			this.hooks.afterJob?.(this.completedJobs);
			settle?.();
			if (succeeded)
				rendererLogger.info({ jobId: id, timings }, "Job completed");
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
