import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { contextMixin, loggerContext } from "./logger.js";

describe("logger context", () => {
	it("doesn't carry one line's fields into the next", () => {
		const lines: Record<string, unknown>[] = [];
		const sink = new Writable({
			write(chunk, _enc, done) {
				lines.push(JSON.parse(String(chunk)));
				done();
			},
		});
		const log = pino({ mixin: contextMixin }, sink);
		loggerContext.run({ jobId: "j1" }, () => {
			log.info({ removed: 3 }, "first");
			log.info("second");
		});
		expect(lines[0]).toMatchObject({ jobId: "j1", removed: 3 });
		expect(lines[1]).toMatchObject({ jobId: "j1" });
		expect(lines[1]).not.toHaveProperty("removed");
	});
});
