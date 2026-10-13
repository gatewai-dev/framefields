import pino from "pino";

export const rendererLogger = pino({
	level: (typeof process !== "undefined" && process.env?.LOG_LEVEL) || "info",
	timestamp: pino.stdTimeFunctions.isoTime,
	base: {
		component: "renderer",
	},
});
