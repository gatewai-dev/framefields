import pino from "pino";
import { describe, expect, it } from "vitest";
import { resolveLogFormat, textLogStream } from "../logger.js";

describe("resolveLogFormat", () => {
	it("is text by default, JSON in production, and follows the override", () => {
		expect(resolveLogFormat({})).toBe("text");
		expect(resolveLogFormat({ NODE_ENV: "production" })).toBe("json");
		expect(
			resolveLogFormat({
				NODE_ENV: "production",
				FRAMEFIELDS_LOG_FORMAT: "text",
			}),
		).toBe("text");
		expect(resolveLogFormat({ FRAMEFIELDS_LOG_FORMAT: "JSON" })).toBe("json");
	});
});

describe("textLogStream", () => {
	it("prints one short line per entry", () => {
		const lines: string[] = [];
		const log = pino(
			{ base: { component: "renderer" } },
			textLogStream((line) => lines.push(line)),
		);
		log.info(
			{ renderId: "vid-1", frame: 720, totalFrames: 1800 },
			"[HeadlessWebGPURenderer] Rendered 40% (720/1800 frames)",
		);
		log.warn({}, "[HeadlessWebGPURenderer] Aborted while muxing after 2.0s");
		log.error(
			{ err: new Error("decoder closed") },
			"[HeadlessWebGPURenderer] Failed while mixing audio after 1.2s",
		);
		log.debug({}, "hidden below the level");
		expect(lines).toEqual([
			"[framefields] Rendered 40% (720/1800 frames)\n",
			"[framefields] warn: Aborted while muxing after 2.0s\n",
			"[framefields] error: Failed while mixing audio after 1.2s: decoder closed\n",
		]);
	});
});
