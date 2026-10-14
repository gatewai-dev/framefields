import { Server as HttpServer } from "node:http";
import { HeadlessMediaRenderer } from "@framefields/renderer";
import "@framefields/renderer/offscreen-gl-polyfill";
import { rendererLogger } from "@framefields/server-utils";
import { serve } from "@hono/node-server";
import { describeConfig, loadConfig, scrubSecretEnv } from "./config/index.js";
import { RenderError } from "./errors.js";
import { checkout } from "./git/checkout.js";
import { createApp } from "./http/app.js";
import type { Pipeline } from "./jobs/pipeline.js";
import { JobRunner } from "./jobs/runner.js";
import { ReadinessTracker } from "./readiness.js";

const config = loadConfig();
scrubSecretEnv();
rendererLogger.info(
	{ config: describeConfig(config) },
	"Renderer config loaded",
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
	install: async () => notYet("install"),
	render: async () => notYet("render"),
	deliver: async () => notYet("deliver"),
};

const runner = new JobRunner(config, pipeline);

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
		rendererLogger.info("Renderer initialized.");
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		rendererLogger.fatal(
			{ err: error },
			"❌ GPU / Renderer initialization failed",
		);
		readiness.setFailure(`GPU_UNAVAILABLE: ${errMsg}`);
		// RunPod should replace a worker without a usable GPU.
		if (config.mode === "runpod-serverless") process.exit(1);
	}
}

void bootstrap();

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
		process.exit(1);
	}, graceMs);

	await runner.queue.idle();
	server.close();
	clearTimeout(forceExit);
	rendererLogger.info("Shutdown complete.");
	process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

export { app };
export type AppType = typeof app;
