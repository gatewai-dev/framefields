import { describe, expect, it } from "vitest";
import { Composition } from "../index.js";
import { pickComposition } from "./pick-composition.js";

const comp = (width: number) =>
	new Composition({ width, height: 36, fps: 10, durationFrames: 10 });

describe("pickComposition", () => {
	it("takes a Composition, or calls a builder with the render's args", async () => {
		const film = comp(64);
		expect(
			await pickComposition({ buildFilm: film }, { export: "buildFilm" }),
		).toBe(film);
		const built = await pickComposition(
			{ build: (args: { width: number }) => comp(args.width) },
			{ export: "build", args: { width: 128 } },
		);
		expect(built.toSpec().width).toBe(128);
	});

	it("picks one of several by select, as the cloud worker does", async () => {
		const a = comp(64);
		const b = comp(96);
		expect(
			await pickComposition(
				{ cuts: () => ({ wide: a, tall: b }) },
				{ export: "cuts", select: "tall" },
			),
		).toBe(b);
		expect(
			await pickComposition(
				{ plan: { outputs: [{ name: "teaser", composition: a }] } },
				{ export: "plan" },
			),
		).toBe(a);
		await expect(
			pickComposition({ cuts: { wide: a, tall: b } }, { export: "cuts" }),
		).rejects.toThrow(
			'returns several compositions (wide, tall): name one with "select"',
		);
	});

	it("names a missing or wrong export", async () => {
		await expect(
			pickComposition({ other: 1 }, { export: "buildFilm" }),
		).rejects.toThrow('no export named "buildFilm". Exports: other');
		await expect(
			pickComposition({ buildFilm: 42 }, { export: "buildFilm" }),
		).rejects.toThrow("must be a Composition");
	});
});
