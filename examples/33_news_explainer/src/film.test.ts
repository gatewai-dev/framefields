import { CompositorProgramSchema } from "framefields";
import { describe, expect, it } from "vitest";
import { LINE_IDS, LINES, readManifest } from "./audio.js";
import { buildExplainer } from "./film.js";
import { numberWords, spokenWords } from "./spoken.js";
import { BREATH, SCENES } from "./timeline.js";

describe("explainer", () => {
	it("builds a valid, lint-clean program of 80 to 120 seconds", async () => {
		const { film, timeline } = await buildExplainer();
		const result = CompositorProgramSchema.safeParse(film.toSpec());
		expect(
			result.success,
			JSON.stringify(result.error?.issues.slice(0, 3)),
		).toBe(true);
		expect(film.lint().filter((d) => d.severity === "error")).toEqual([]);
		const seconds = timeline.total / 30;
		expect(seconds).toBeGreaterThanOrEqual(80);
		expect(seconds).toBeLessThanOrEqual(120);
	}, 60_000);

	it("reads every line once, in order, one at a time", async () => {
		const { timeline } = await buildExplainer();
		expect(timeline.lines.map((l) => l.id)).toEqual(
			SCENES.flatMap((s) => s.lines),
		);
		expect([...timeline.lines.map((l) => l.id)].sort()).toEqual(
			[...LINE_IDS].sort(),
		);
		timeline.lines.forEach((line, i) => {
			const next = timeline.lines[i + 1];
			if (next)
				expect(
					next.start - line.end,
					`${line.id} → ${next.id}`,
				).toBeGreaterThanOrEqual(BREATH);
		});
	}, 60_000);

	it("finishes each scene's narration before the next scene arrives", async () => {
		const { timeline } = await buildExplainer();
		timeline.scenes.forEach((scene, i) => {
			const next = timeline.scenes[i + 1];
			const end = next ? next.start : timeline.total;
			for (const [id, line] of Object.entries(scene.lines)) {
				expect(scene.start + line.start, `${id} starts`).toBeGreaterThanOrEqual(
					scene.start,
				);
				expect(
					scene.start + line.end,
					`${id} ends before ${next?.id ?? "the end"}`,
				).toBeLessThanOrEqual(end);
			}
		});
	}, 60_000);

	it("has a take of every line that was heard as written", () => {
		const { voice } = readManifest();
		for (const id of LINE_IDS) {
			const take = voice[id];
			expect(take.text, id).toBe(LINES[id]);
			expect(spokenWords(take.heard), id).toBe(spokenWords(take.text));
			expect(take.words.length, id).toBeGreaterThan(0);
		}
	});
});

describe("spoken words", () => {
	it("spells out numbers as they are said", () => {
		expect(numberWords(2004)).toBe("two thousand four");
		expect(numberWords(35000)).toBe("thirty five thousand");
		expect(numberWords(340)).toBe("three hundred forty");
		expect(numberWords(0)).toBe("zero");
	});

	it("compares a script with a transcript that writes numerals", () => {
		expect(spokenWords("at thirty-five thousand feet.")).toBe(
			spokenWords("at 35,000 feet"),
		);
		expect(spokenWords("three hundred and forty miles")).toBe(
			spokenWords("340 miles"),
		);
		expect(spokenWords("a Learjet 60 built in 2004")).toBe(
			"a learjet sixty built in two thousand four",
		);
	});
});
