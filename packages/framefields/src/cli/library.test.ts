import { describe, expect, it } from "vitest";
import { formatEntries, libraryQuery } from "./library.js";

describe("framefields library", () => {
	it("turns flags into a query", () => {
		expect(
			libraryQuery(["upbeat", "synth"], {
				kind: ["music,sfx"],
				tag: ["calm"],
				"max-duration": "30",
				bpm: "110-130",
				loop: true,
			}),
		).toEqual({
			text: "upbeat synth",
			kind: ["music", "sfx"],
			tags: ["calm"],
			minDuration: undefined,
			maxDuration: 30,
			minBpm: 110,
			maxBpm: 130,
			loop: true,
			commercial: undefined,
		});
		expect(libraryQuery([], { bpm: "120" })).toMatchObject({
			minBpm: 120,
			maxBpm: 120,
		});
	});

	it("names what's wrong with a flag", () => {
		expect(() => libraryQuery([], { kind: ["songs"] })).toThrow(
			/Unknown kind "songs"/,
		);
		expect(() => libraryQuery([], { "min-duration": "soon" })).toThrow(
			/--min-duration/,
		);
		expect(() => libraryQuery([], { bpm: "fast" })).toThrow(/--bpm/);
	});

	it("prints one aligned line per entry with its facts", () => {
		const lines = formatEntries([
			{
				name: "sfx/pop",
				title: "pop",
				summary: "A pop",
				tags: [],
				example: "",
				registryDependencies: [],
				kind: "sfx",
				facets: { duration: 0.18 },
				license: { id: "CC0-1.0", commercial: true },
			},
			{
				name: "counter",
				title: "Counter",
				summary: "Counts",
				tags: [],
				example: "",
				registryDependencies: [],
			},
		]);
		expect(lines).toEqual([
			"sfx/pop  SFX          A pop (0.2 s, CC0-1.0)",
			"counter  Components   Counts",
		]);
	});
});
