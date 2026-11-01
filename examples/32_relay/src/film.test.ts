import { CompositorProgramSchema } from "framefields";
import { describe, expect, it } from "vitest";
import { buildRelay } from "./film.js";
import { cardLands, checklistItemAt } from "./ui/timeline.js";

describe("relay", () => {
	it("builds a valid, lint-clean 25-second program", async () => {
		const { film } = await buildRelay();
		const result = CompositorProgramSchema.safeParse(film.toSpec());
		expect(
			result.success,
			JSON.stringify(result.error?.issues.slice(0, 3)),
		).toBe(true);
		expect(film.lint().filter((d) => d.severity === "error")).toEqual([]);
		expect(film.durationMs).toBe(25_000);
	}, 60_000);

	it("holds the camera still through every click", async () => {
		const { camera, clicks } = await buildRelay();
		expect(clicks).toHaveLength(8);
		for (const frame of clicks) {
			// From just before the press until the button is back up.
			const before = camera.cameraAt(frame - 7);
			const after = camera.cameraAt(frame + 7);
			expect(after.zoom, `zoom at click ${frame}`).toBeCloseTo(before.zoom, 3);
			expect(
				Math.hypot(
					after.center[0] - before.center[0],
					after.center[1] - before.center[1],
				),
				`pan at click ${frame}`,
			).toBeLessThan(0.5);
		}
	}, 60_000);

	it("speaks each line on its beat, one at a time, inside the film", async () => {
		const { lines, timeline: t, film } = await buildRelay();
		const end = Math.round(((film.durationMs ?? 0) / 1000) * 30);
		lines.forEach((line, i) => {
			const next = lines[i + 1];
			if (next)
				expect(
					next.start - line.end,
					`${line.id} → ${next.id}`,
				).toBeGreaterThanOrEqual(6);
			else expect(line.end, line.id).toBeLessThanOrEqual(end - 15);
		});
		const at = Object.fromEntries(lines.map((l) => [l.id, l]));
		// The three promises are said as the modal delivers them…
		expect(at.owner?.start).toBe(t.maya.at + 2);
		expect(at.deadline?.start).toBe(t.friday.at + 2);
		expect(at.step?.start).toBe(checklistItemAt(t, 0));
		// …and the board line once the card has landed, done before it leaves.
		expect(at.board?.start).toBeGreaterThan(cardLands(t));
		expect(at.board?.end).toBeLessThanOrEqual(t.sceneOut);
	}, 60_000);
});
