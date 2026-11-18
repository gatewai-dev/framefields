import { CompositorProgramSchema } from "framefields";
import { describe, expect, it } from "vitest";
import { buildFilm, DURATION } from "./film.js";

describe("Gemini 4 Neon 20s showcase film", () => {
	it("validates schema, passes lint cleanly, and runs exactly 600 frames (20.0s)", async () => {
		const comp = await buildFilm();
		expect(DURATION).toBe(600);
		const spec = comp.toSpec();
		const parsed = CompositorProgramSchema.safeParse(spec);
		expect(parsed.success).toBe(true);
		const diagnostics = comp.lint();
		const blocking = diagnostics.filter(
			(d) => d.severity === "error" || d.severity === "warning",
		);
		expect(blocking).toEqual([]);
	});
});
