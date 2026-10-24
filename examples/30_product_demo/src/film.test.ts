import { CompositorProgramSchema } from "framefields";
import { describe, expect, it } from "vitest";
import { buildFilm } from "./film.js";

describe("product demo", () => {
	it("builds a valid, lint-clean program", async () => {
		const film = await buildFilm();
		const result = CompositorProgramSchema.safeParse(film.toSpec());
		expect(
			result.success,
			JSON.stringify(result.error?.issues.slice(0, 3)),
		).toBe(true);
		expect(film.lint().filter((d) => d.severity === "error")).toEqual([]);
		expect(film.durationMs).toBeGreaterThan(10_000);
		expect(film.durationMs).toBeLessThan(15_000);
	}, 60_000);
});
