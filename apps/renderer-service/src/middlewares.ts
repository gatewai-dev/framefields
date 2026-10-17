import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import { apiLogger, loggerContext } from "./logger.js";

/** Tags each request with an id (x-request-id) and logs client errors. */
export const loggerMiddleware = async (c: Context, next: Next) => {
	const requestId = c.req.header("x-request-id") || randomUUID();
	c.header("x-request-id", requestId);
	const { method, path } = c.req;
	const start = Date.now();

	await loggerContext.run({ requestId }, async () => {
		await next();
		const status = c.res.status;
		const payload = {
			method,
			path,
			status,
			duration: `${Date.now() - start}ms`,
		};
		if (status < 400) apiLogger.trace(payload, "request");
		else if (status < 500) apiLogger.warn(payload, "client error");
		// 5xx are logged by app.onError.
	});
};
