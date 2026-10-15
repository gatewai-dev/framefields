import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
	describeConfig,
	loadConfig,
	type RendererConfig,
	scrubSecretEnv,
} from "../config/index.js";
import { RenderError } from "../errors.js";
import { checkout } from "../git/checkout.js";
import { exec } from "../git/exec.js";
import { repoHash, workerId } from "../git/mirror.js";
import { install } from "../install/installer.js";
import { CrashJournal } from "../jobs/journal.js";
import type { Pipeline } from "../jobs/pipeline.js";
import { JobRunner } from "../jobs/runner.js";
import { rendererLogger } from "../logger.js";
import { deliver, findExisting } from "../output/deliver.js";
import { ReadinessTracker } from "../readiness.js";
import { redact } from "../redact.js";
import { boundEngine } from "../render/engine.js";
import { installEngineAlias } from "../render/engine-alias.js";
import { render } from "../render/render-step.js";
import { installProcessGuards, strayErrorCount } from "../render/sandbox.js";
import { applyGpuPlan, gpuStatus, planGpu, probeGpu } from "./gpu.js";
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
	/** Checks git, git-lfs, ffprobe and the GPU; rejects with TOOL_MISSING or GPU_UNAVAILABLE. */
	checkTools(): Promise<void>;
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

	// Before any engine loads: Vulkan reads its driver list once (§8.7).
	const gpu = planGpu(config.gpu, probeGpu());
	applyGpuPlan(gpu);
	rendererLogger[gpu.problem ? "error" : "info"](
		{ gpu: { ...gpuStatus(), icds: gpu.icds }, problem: gpu.problem },
		gpu.expect === "software"
			? "No GPU in use: rendering on the CPU"
			: "Rendering on the GPU",
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
	// The bound engine is loaded from a workspace: never evict that one.
	const engineRepo = () => {
		const engine = boundEngine();
		return engine ? [path.basename(path.dirname(engine.workspace))] : [];
	};
	const janitor = new CacheJanitor(
		config,
		workerId(),
		undefined,
		undefined,
		engineRepo,
	);
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
	let boundVersion: string | undefined;
	let draining = false;

	const runner = new JobRunner(config, pipeline, {
		journal,
		beforeJob: (job) => janitor.maybeRun([repoHash(job.repo)]),
		afterJob: (completed) => {
			const engine = boundEngine();
			if (engine && boundVersion !== engine.version) {
				// The engine's own timers and GPU handles aren't leaks.
				boundVersion = engine.version;
				readiness.setEngine(engine.version);
				baselineHandles = process.getActiveResourcesInfo().length;
			}
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
		async checkTools() {
			const missing: string[] = [];
			for (const [tool, args] of [
				["git", ["--version"]],
				["git", ["lfs", "version"]],
				["ffprobe", ["-version"]],
			] as const) {
				await exec(tool, [...args], { timeoutMs: 10_000 }).catch(() =>
					missing.push(
						`${tool} ${args[0]}`
							.replace(" --version", "")
							.replace(" -version", ""),
					),
				);
			}
			// ffprobe only sharpens output checks; git and git-lfs are required.
			const required = missing.filter((m) => m.startsWith("git"));
			if (missing.length) rendererLogger.warn({ missing }, "Tools missing");
			if (required.length) {
				readiness.setFailure(`TOOL_MISSING: ${required.join(", ")}`);
				throw new RenderError(
					"TOOL_MISSING",
					`Missing: ${required.join(", ")}`,
				);
			}
			if (gpu.problem) {
				readiness.setFailure(`GPU_UNAVAILABLE: ${gpu.problem}`);
				throw new RenderError("GPU_UNAVAILABLE", gpu.problem, {
					hint: gpu.hint,
				});
			}
			readiness.setToolsReady(true);
			baselineHandles = process.getActiveResourcesInfo().length;
		},
		stop: stopWatchdog,
	};
}
