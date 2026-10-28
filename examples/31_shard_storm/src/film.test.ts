import { CompositorProgramSchema } from "framefields";
import { describe, expect, it } from "vitest";
import { buildFilm, DURATION } from "./film.js";

describe("shard storm example film", () => {
	it("builds a valid, lint-clean program matching schema", async () => {
		const film = await buildFilm();
		const spec = film.toSpec();
		const result = CompositorProgramSchema.safeParse(spec);
		expect(
			result.success,
			JSON.stringify(result.error?.issues.slice(0, 3)),
		).toBe(true);

		const lintErrors = film.lint().filter((d) => d.severity === "error");
		expect(lintErrors).toEqual([]);
		expect(Math.round(((film.durationMs ?? 0) / 1000) * film.fps)).toBe(
			DURATION,
		);
	}, 60_000);
});
