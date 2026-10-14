import { createHash, timingSafeEqual } from "node:crypto";
import { rendererLogger } from "@framefields/server-utils";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import type { RendererConfig } from "../config/index.js";
import { RenderError } from "../errors.js";
import type { JobRunner } from "../jobs/runner.js";
import { isTerminal, type JobRecord } from "../jobs/store.js";
import { loggerMiddleware } from "../middlewares.js";
import { redact } from "../redact.js";

export interface HealthSource {
	/** Overall readiness plus per-component detail. */
	health(): { ok: boolean; body: Record<string, unknown> };
	/** True when the worker is recycling and must not take new jobs. */
	draining(): boolean;
}

const STATUS_BY_CODE: Partial<Record<RenderError["code"], number>> = {
	JOB_INVALID: 400,
	PATH_ESCAPE: 400,
	REPO_NOT_ALLOWED: 403,
	BUCKET_NOT_ALLOWED: 403,
	BUSY: 429,
	SHUTDOWN: 503,
};

export function createApp(
	config: RendererConfig,
	runner: JobRunner,
	health: HealthSource,
) {
	const requireKey = bearerAuth(config.http.apiKey);

	return new Hono()
		.onError((err: Error, c: Context) => {
			if (err instanceof RenderError) {
				return c.json(
					{ error: err.toJSON() },
					(STATUS_BY_CODE[err.code] ?? 500) as 500,
				);
			}
			const status = err instanceof HTTPException ? err.status : 500;
			if (status >= 500) {
				rendererLogger.error(
					{ err: redact(err.message), url: c.req.path, status },
					"HTTP error",
				);
			}
			return c.json(
				{
					error:
						err instanceof HTTPException
							? err.message
							: "Internal Server Error",
				},
				status,
			);
		})
		.use(loggerMiddleware)
		.use(async (c, next) => {
			c.header("X-Content-Type-Options", "nosniff");
			c.header("Cache-Control", "no-store");
			await next();
		})
		.get("/ping", (c) =>
			health.health().ok ? c.text("pong", 200) : c.body(null, 204),
		)
		.get("/health", (c) => {
			const { ok, body } = health.health();
			return c.json(body, ok ? 200 : 503);
		})
		.post("/v2/jobs", requireKey, async (c) => {
			if (health.draining() || !health.health().ok) {
				throw new RenderError("SHUTDOWN", "This worker is not accepting jobs.");
			}
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				throw new RenderError("JOB_INVALID", "Request body must be JSON.");
			}
			const record = runner.submit(body);
			return c.json({ id: record.id, status: record.status }, 202);
		})
		.get("/v2/jobs/:id", requireKey, (c) =>
			c.json(findJob(runner, c.req.param("id"))),
		)
		.post("/v2/jobs/:id/cancel", requireKey, (c) => {
			const job = findJob(runner, c.req.param("id"));
			if (isTerminal(job.status)) return c.json(job, 409);
			runner.cancel(job.id);
			return c.json(runner.store.get(job.id) ?? job, 202);
		})
		.get("/v2/jobs/:id/events", requireKey, (c) => {
			const job = findJob(runner, c.req.param("id"));
			return streamSSE(c, async (stream) => {
				const send = (record: JobRecord) =>
					stream.writeSSE({ event: "job", data: JSON.stringify(record) });
				await send(job);
				if (isTerminal(job.status)) return;

				await new Promise<void>((resolve) => {
					const onUpdate = (record: JobRecord) => {
						if (record.id !== job.id) return;
						void send(record);
						if (isTerminal(record.status)) done();
					};
					const keepAlive = setInterval(
						() => void stream.writeSSE({ event: "ping", data: "" }),
						15_000,
					);
					const done = () => {
						clearInterval(keepAlive);
						runner.store.off("update", onUpdate);
						resolve();
					};
					runner.store.on("update", onUpdate);
					stream.onAbort(done);
				});
			});
		});
}

function findJob(runner: JobRunner, id: string): JobRecord {
	const job = runner.store.get(id);
	if (!job) throw new HTTPException(404, { message: "Job not found" });
	return job;
}

function bearerAuth(apiKey: string | undefined): MiddlewareHandler {
	const expected = apiKey ? digest(apiKey) : undefined;
	return async (c, next) => {
		if (expected) {
			const header = c.req.header("authorization") ?? "";
			const token = /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "";
			if (!timingSafeEqual(digest(token), expected)) {
				throw new HTTPException(401, { message: "Unauthorized" });
			}
		}
		await next();
	};
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}
