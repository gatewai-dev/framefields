import { generateId } from "@framefields/core";
import { apiLogger, loggerContext } from "@framefields/server-utils";
import type { Context, Next } from "hono";

// 1. Request/Response Middleware
export const loggerMiddleware = async (c: Context, next: Next) => {
	const requestId = c.req.header("x-request-id") || generateId();
	c.set("requestId", requestId);
	c.header("x-request-id", requestId);

	const { method, url } = c.req;
	const start = Date.now();

	await loggerContext.run({ component: "api", requestId }, async () => {
		await next();

		const status = c.res.status;
		const duration = `${Date.now() - start}ms`;

		const logPayload = { method, url, status, duration, requestId };

		if (status < 400) {
			apiLogger.trace(logPayload, "✅ Request Success");
		} else if (status < 500) {
			apiLogger.warn(logPayload, "⚠️ Client Error");
		}
		// Note: 500+ errors are handled by app.onError in index.ts
	});
};
