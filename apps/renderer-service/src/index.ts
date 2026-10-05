// Keep this at top. (Force reload 1)
import "reflect-metadata";
import { Server as HttpServer } from "node:http";
import { configureAssetUrls } from "@framefields/client-utils";
import {
	HeadlessMediaRenderer,
	renderSemaphore,
} from "@framefields/renderer";
import "@framefields/renderer/offscreen-gl-polyfill";
import { rendererLogger } from "@framefields/server-utils";
import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { registerBackendServices } from "./di-setup.js";
import { RENDERER_ENV_CONFIG } from "./env-config.js";
import {
	executeRenderJob,
	hasActiveJobs,
	jobs,
	type RenderJob,
	type RenderJobInput,
} from "./job-processor.js";
import { loggerMiddleware } from "./middlewares.js";
import { ReadinessTracker } from "./readiness.js";

const readiness = new ReadinessTracker();
let podState: "initializing" | "idle" | "processing" = "initializing";

// RenderJob types and Map are imported from job-processor.js

const app = new Hono()
	.onError((err: Error, c: Context) => {
		const isHTTPException = err instanceof HTTPException;
		const status = isHTTPException ? (err as HTTPException).status : 500;

		rendererLogger.error(
			{
				err: err.message,
				stack:
					RENDERER_ENV_CONFIG.NODE_ENV === "production" ? undefined : err.stack,
				url: c.req.url,
				status,
			},
			isHTTPException ? "HTTP Exception" : "Unhandled Exception",
		);

		return c.json(
			{
				error: isHTTPException ? err.message : "Internal Server Error",
			},
			status,
		);
	})
	.use(async (c, next) => {
		return loggerMiddleware(c, next);
	})
	.use(async (c, next) => {
		c.header("X-Frame-Options", "SAMEORIGIN");
		c.header("X-Content-Type-Options", "nosniff");
		c.header("Referrer-Policy", "strict-origin-when-cross-origin");
		c.header(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);
		await next();
	})
	.get("/ping", (c) => {
		if (!readiness.isReady) {
			return c.body(null, 204);
		}
		return c.text("pong", 200);
	})
	.get("/health", async (c) => {
		const status = readiness.status;
		const health: Record<string, unknown> = {
			status: readiness.isReady
				? "ok"
				: status.error
					? "failed"
					: "initializing",
			timestamp: new Date().toISOString(),
			components: status.components,
			renderQueue: renderSemaphore.stats,
		};
		if (status.error) {
			health.error = status.error;
		}

		return c.json(health, readiness.isReady ? 200 : 503);
	})
	.post("/run", async (c) => {
		const body = await c.req.json<{ input: RenderJobInput }>();
		const jobData = body.input;
		const jobId = `local-job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

		const job: RenderJob = {
			id: jobId,
			status: "IN_QUEUE",
		};
		jobs.set(jobId, job);

		// Execute rendering in the background asynchronously
		executeRenderJob(jobId, jobData, (state) => {
			podState = state;
		});

		return c.json({ id: jobId, status: "IN_QUEUE" }, 200);
	})
	.get("/status/:id", (c) => {
		const jobId = c.req.param("id");
		const job = jobs.get(jobId);
		if (!job) {
			return c.json({ error: "Job not found" }, 404);
		}
		return c.json(job, 200);
	});

const server = serve(
	{
		fetch: app.fetch,
		port: RENDERER_ENV_CONFIG.RENDERER_PORT,
		hostname: "0.0.0.0",
	},
	(info) => {
		rendererLogger.info(`Server is running on port ${info.port} (0.0.0.0)`);
	},
);

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
if (server instanceof HttpServer) {
	server.timeout = TWO_HOURS_MS;
	server.requestTimeout = TWO_HOURS_MS;
	server.headersTimeout = TWO_HOURS_MS;
	server.keepAliveTimeout = TWO_HOURS_MS;
}

let shutdownRequested = false;

const sleep = (time: number) =>
	new Promise((resolve) => setTimeout(resolve, time));

async function bootstrap() {
	try {
		// Configure asset and font URLs for headless rendering
		configureAssetUrls({
			baseUrl: RENDERER_ENV_CONFIG.BASE_URL,
			r2CustomDomain: RENDERER_ENV_CONFIG.R2_CUSTOM_DOMAIN,
		});

		// Initialize Dependency Injection Container
		await registerBackendServices();

		// Sleep for 2 seconds to allow HMR for node builds on dev.
		if (RENDERER_ENV_CONFIG.NODE_ENV !== "production") {
			await sleep(2000);
		}
	} catch (err) {
		rendererLogger.fatal(
			{ err },
			"❌ Failed to start Gatewai Backend services",
		);
		readiness.setFailure(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	if (shutdownRequested) {
		rendererLogger.info(
			"Shutdown was requested during container boot. Aborting startup.",
		);
		return;
	}

	// Initialize renderer (GPU, node discovery)
	try {
		rendererLogger.info(
			"Eagerly initializing renderer (GPU, node discovery)...",
		);
		await HeadlessMediaRenderer.initialize();
		readiness.setRendererReady(true);
		readiness.setGpuReady(true);
		podState = "idle";
		rendererLogger.info(
			"Eager renderer initialization completed successfully.",
		);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		rendererLogger.fatal(
			{ err: error },
			"❌ GPU / Renderer initialization failed",
		);
		readiness.setFailure(errMsg);
	}
}

bootstrap();

// ─── Graceful Shutdown ──────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string) {
	rendererLogger.info({ signal, podState }, "Starting graceful shutdown...");
	shutdownRequested = true;

	const IDLE_TIMEOUT_MS = 30_000;
	const INIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
	const MAX_RENDER_TIMEOUT_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours

	const shutdownTimeoutMs =
		podState === "processing"
			? MAX_RENDER_TIMEOUT_MS
			: podState === "initializing"
				? INIT_TIMEOUT_MS
				: IDLE_TIMEOUT_MS;

	const timeout = setTimeout(() => {
		rendererLogger.error("Shutdown timed out, forcing exit.");
		process.exit(1);
	}, shutdownTimeoutMs);

	try {
		// Stop HTTP server
		server.close();
		rendererLogger.info(
			"HTTP server closed, waiting for active jobs to complete...",
		);

		while (hasActiveJobs()) {
			rendererLogger.info("Active jobs still running, waiting...");
			await sleep(1000);
		}

		rendererLogger.info("Graceful shutdown complete. Bye!");
		clearTimeout(timeout);
		process.exit(0);
	} catch (err) {
		rendererLogger.error({ err }, "Error during graceful shutdown");
		process.exit(1);
	}
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { app };
export type AppType = typeof app;
