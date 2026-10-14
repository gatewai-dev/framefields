import { mkdirSync, realpathSync } from "node:fs";
import { Server as HttpServer } from "node:http";
import path from "node:path";
import { HeadlessMediaRenderer } from "@framefields/renderer";
import "@framefields/renderer/offscreen-gl-polyfill";
import { rendererLogger } from "@framefields/server-utils";
import { serve } from "@hono/node-server";
import { describeConfig, loadConfig, scrubSecretEnv } from "./config/index.js";
import { RenderError } from "./errors.js";
import { checkout } from "./git/checkout.js";
import { createApp } from "./http/app.js";
import { install } from "./install/installer.js";
import { CrashJournal } from "./jobs/journal.js";
import type { Pipeline } from "./jobs/pipeline.js";
import { JobRunner } from "./jobs/runner.js";
import { ReadinessTracker } from "./readiness.js";
import { redact } from "./redact.js";
import { installEngineAlias } from "./render/engine-alias.js";
import { render } from "./render/render-step.js";
import { installProcessGuards, strayErrorCount } from "./render/sandbox.js";
import { workerHealth } from "./worker/health.js";
import { currentStats, recycleReason } from "./worker/recycle.js";
import { startWatchdog } from "./worker/watchdog.js";

// The job sandbox swaps process.exit while repo code runs; the worker itself
// always exits through the real one.
const exit = process.exit.bind(process);

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
let draining = false;

const notYet = (step: string): never => {
	throw new RenderError(
		"INTERNAL",
		`The ${step} step is not implemented in this build yet.`,
	);
};
// Steps land phase by phase (PLAN.md §13).
const pipeline: Pipeline = {
	checkout,
	install,
	render,
	deliver: async () => notYet("deliver"),
};

const journal = new CrashJournal(
	path.join(config.paths.workDir, "inflight.json"),
);
let baselineHandles = 0;

const runner = new JobRunner(config, pipeline, {
	journal,
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
		if (reason) void recycle(reason);
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

const app = createApp(config, runner, {
	health: () => {
		const status = readiness.status;
		return {
			ok: readiness.isReady && !draining,
			body: {
				status: draining
					? "draining"
					: readiness.isReady
						? "ok"
						: status.error
							? "failed"
							: "initializing",
				timestamp: new Date().toISOString(),
				mode: config.mode,
				components: status.components,
				queue: {
					active: runner.queue.activeId ?? null,
					waiting: runner.queue.depth,
				},
				...(status.error && { error: status.error }),
				...(workerHealth.recycleReason && {
					recycle: workerHealth.recycleReason,
				}),
			},
		};
	},
	draining: () => draining,
});

const server = serve(
	{ fetch: app.fetch, port: config.http.port, hostname: config.http.host },
	(info) => {
		rendererLogger.info(
			`Server is running on ${config.http.host}:${info.port}`,
		);
	},
);

// Long SSE streams and slow clients; renders themselves never block a request.
if (server instanceof HttpServer) {
	server.requestTimeout = 0;
	server.headersTimeout = 60_000;
	server.keepAliveTimeout = 65_000;
}

async function bootstrap() {
	try {
		rendererLogger.info("Initializing renderer (GPU, node discovery)...");
		await HeadlessMediaRenderer.initialize();
		readiness.setRendererReady(true);
		readiness.setGpuReady(true);
		baselineHandles = process.getActiveResourcesInfo().length;
		rendererLogger.info("Renderer initialized.");
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		rendererLogger.fatal(
			{ err: error },
			"❌ GPU / Renderer initialization failed",
		);
		readiness.setFailure(`GPU_UNAVAILABLE: ${errMsg}`);
		// RunPod should replace a worker without a usable GPU.
		if (config.mode === "runpod-serverless") exit(1);
	}
}

void bootstrap();

/**
 * Stops taking jobs and restarts the process once the queue is empty. On
 * RunPod serverless the shim asks for a fresh worker (refresh_worker) when
 * it sees /health report "draining", so the process just stays drained.
 */
async function recycle(reason: string) {
	if (draining) return;
	draining = true;
	rendererLogger.warn({ reason }, "Recycling worker");
	runner.queue.close(
		new RenderError("SHUTDOWN", `Worker is recycling (${reason}).`),
		false,
	);
	await runner.queue.idle();
	if (config.mode !== "runpod-serverless") {
		stopWatchdog();
		server.close();
		exit(0);
	}
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────────

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	draining = true;
	rendererLogger.info(
		{ signal, active: runner.queue.activeId },
		"Shutting down...",
	);

	// The platform is stopping us: abort the running job so it's reported as
	// SHUTDOWN (retryable) instead of vanishing mid-render.
	runner.queue.close(
		new RenderError("SHUTDOWN", `Worker received ${signal}.`),
		true,
	);

	const graceMs = (config.limits.killGraceSec + 5) * 1000;
	const forceExit = setTimeout(() => {
		rendererLogger.error("Shutdown timed out, forcing exit.");
		exit(1);
	}, graceMs);

	await runner.queue.idle();
	stopWatchdog();
	server.close();
	clearTimeout(forceExit);
	rendererLogger.info("Shutdown complete.");
	exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

export { app };
export type AppType = typeof app;
