import { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { RenderError } from "./errors.js";
import { createApp } from "./http/app.js";
import { rendererLogger } from "./logger.js";
import { bootWorker, exit } from "./worker/boot.js";
import { workerHealth } from "./worker/health.js";

/**
 * HTTP worker (FF_MODE=http or runpod-serverless). On RunPod the Python shim
 * in front of it asks for a fresh worker (refresh_worker) when /health says
 * "draining", so a recycling serverless worker just stays drained.
 */
const worker = bootWorker({
	onRecycle: () => {
		void worker.runner.queue.idle().then(() => {
			if (config.mode !== "runpod-serverless") shutdown(0);
		});
	},
});
const { config, runner, readiness } = worker;

const app = createApp(config, runner, {
	health: () => {
		const status = readiness.status;
		const draining = worker.isDraining();
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
				disks: worker.disks() ?? null,
				...(status.error && { error: status.error }),
				...(workerHealth.recycleReason && {
					recycle: workerHealth.recycleReason,
				}),
			},
		};
	},
	draining: () => worker.isDraining(),
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

worker.checkTools().catch(() => {
	// RunPod should replace a broken worker; /health reports it otherwise.
	if (config.mode === "runpod-serverless") exit(1);
});

function shutdown(code: number) {
	worker.stop();
	server.close();
	exit(code);
}

let shuttingDown = false;

async function gracefulShutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	rendererLogger.info(
		{ signal, active: runner.queue.activeId },
		"Shutting down...",
	);
	const forceExit = setTimeout(
		() => {
			rendererLogger.error("Shutdown timed out, forcing exit.");
			exit(1);
		},
		(config.limits.killGraceSec + 5) * 1000,
	);
	// The platform is stopping us: abort the running job so it's reported as
	// SHUTDOWN (retryable) instead of vanishing mid-render.
	await worker.drain(
		new RenderError("SHUTDOWN", `Worker received ${signal}.`),
		true,
	);
	clearTimeout(forceExit);
	rendererLogger.info("Shutdown complete.");
	shutdown(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

export { app };
export type AppType = typeof app;
