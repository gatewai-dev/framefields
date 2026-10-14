import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { HeadlessMediaRenderer } from "@framefields/renderer";
import "@framefields/renderer/offscreen-gl-polyfill";
import { rendererLogger } from "@framefields/server-utils";
import {
	describeConfig,
	loadConfig,
	type RendererConfig,
	scrubSecretEnv,
} from "../config/index.js";
import { RenderError } from "../errors.js";
import { checkout } from "../git/checkout.js";
import { repoHash, workerId } from "../git/mirror.js";
import { install } from "../install/installer.js";
import { CrashJournal } from "../jobs/journal.js";
import type { Pipeline } from "../jobs/pipeline.js";
import { JobRunner } from "../jobs/runner.js";
import { deliver, findExisting } from "../output/deliver.js";
import { ReadinessTracker } from "../readiness.js";
import { redact } from "../redact.js";
import { installEngineAlias } from "../render/engine-alias.js";
import { render } from "../render/render-step.js";
import { installProcessGuards, strayErrorCount } from "../render/sandbox.js";
import { workerHealth } from "./health.js";
import { CacheJanitor } from "./janitor.js";
import { currentStats, recycleReason } from "./recycle.js";
import { startWatchdog } from "./watchdog.js";

/** The job sandbox swaps process.exit while repo code runs; the worker exits through the real one. */
export const exit = process.exit.bind(process);

export interface Worker {
	config: RendererConfig;
	runner: JobRunner;
	readiness: ReadinessTracker;
	/** True once the worker stopped taking jobs (recycling or shutting down). */
	isDraining(): boolean;
	/** Stops taking jobs and waits for the current one. */
	drain(reason: RenderError, abortActive: boolean): Promise<void>;
	/** Initialises the GPU; rejects when no usable device is found. */
	initGpu(): Promise<void>;
	stop(): void;
}

/**
 * Everything the HTTP server and the CLI share (PLAN.md §5): config, engine
 * alias, process guards, crash journal, watchdog, cache janitor, recycling.
 */
export function bootWorker(
	options: { onRecycle?: (reason: string) => void } = {},
): Worker {
	const config = loadConfig();
	scrubSecretEnv();
	rendererLogger.info(
		{ config: describeConfig(config) },
		"Renderer config loaded",
	);

	// Workspaces live here; repo code under it gets the engine alias (§7).
	const workspaces = path.join(config.paths.workDir, "ws");
	mkdirSync(workspaces, { recursive: true });
	mkdirSync(config.paths.cacheDir, { recursive: true });
	installEngineAlias([realpathSync(workspaces)]);

	installProcessGuards((msg, err) =>
		rendererLogger.error(
			{
				err: redact(
					err instanceof Error ? (err.stack ?? err.message) : String(err),
				),
			},
			msg,
		),
	);

	const readiness = new ReadinessTracker();
	const janitor = new CacheJanitor(config, workerId());
	const journal = new CrashJournal(
		path.join(config.paths.workDir, "inflight.json"),
	);
	const pipeline: Pipeline = {
		checkout,
		install,
		render,
		findExisting,
		deliver,
	};
	let baselineHandles = 0;
	let draining = false;

	const runner = new JobRunner(config, pipeline, {
		journal,
		beforeJob: (job) => janitor.maybeRun([repoHash(job.repo)]),
		afterJob: (completed) => {
			const reason = recycleReason(
				currentStats(
					completed,
					baselineHandles,
					strayErrorCount(),
					workerHealth.recycleReason,
				),
				config,
			);
			if (reason && !draining) {
				draining = true;
				rendererLogger.warn({ reason }, "Recycling worker");
				runner.queue.close(
					new RenderError("SHUTDOWN", `Worker is recycling (${reason}).`),
					false,
				);
				options.onRecycle?.(reason);
			}
		},
	});

	const crashed = journal.recover();
	if (crashed) {
		runner.store.restore(crashed);
		rendererLogger.error(
			{ jobId: crashed.id, error: crashed.error },
			"Previous process died during a job",
		);
	}
	const stopWatchdog = startWatchdog({
		blockSec: config.recycle.eventLoopBlockSec,
		journalPath: journal.path,
	});

	return {
		config,
		runner,
		readiness,
		isDraining: () => draining,
		async drain(reason, abortActive) {
			draining = true;
			runner.queue.close(reason, abortActive);
			await runner.queue.idle();
		},
		async initGpu() {
			try {
				rendererLogger.info("Initializing renderer (GPU, node discovery)...");
				await HeadlessMediaRenderer.initialize();
				readiness.setRendererReady(true);
				readiness.setGpuReady(true);
				baselineHandles = process.getActiveResourcesInfo().length;
				rendererLogger.info("Renderer initialized.");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				rendererLogger.fatal(
					{ err: error },
					"❌ GPU / Renderer initialization failed",
				);
				readiness.setFailure(`GPU_UNAVAILABLE: ${message}`);
				throw new RenderError("GPU_UNAVAILABLE", message, { cause: error });
			}
		},
		stop: stopWatchdog,
	};
}
