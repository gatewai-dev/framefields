import { describe, expect, it } from "vitest";
import type { RegistryEntry } from "./registry.js";
import { countByKind, searchLibrary } from "./search.js";

const entry = (
	name: string,
	extra: Partial<RegistryEntry> = {},
): RegistryEntry => ({
	name,
	title: name,
	summary: "",
	tags: [],
	example: "",
	registryDependencies: [],
	...extra,
});

const index: RegistryEntry[] = [
	entry("counter", { summary: "A number that counts up", tags: ["number"] }),
	entry("music/neon-drive", {
		kind: "music",
		summary: "Driving synthwave with a big drop",
		tags: ["upbeat", "synth"],
		facets: { duration: 92, bpm: 118 },
		license: { id: "framefields", commercial: true },
	}),
	entry("music/slow-tide", {
		kind: "music",
		summary: "Ambient pads, slow and wide",
		tags: ["calm", "synth"],
		facets: { duration: 180, bpm: 70, loop: true },
		license: { id: "CC-BY-NC-4.0", commercial: false },
	}),
	entry("sfx/whoosh-short", {
		kind: "sfx",
		summary: "A short air whoosh for transitions",
		tags: ["transition"],
		facets: { duration: 0.8 },
		license: { id: "CC0-1.0", commercial: true },
	}),
];

const names = (entries: RegistryEntry[]) => entries.map((e) => e.name);

describe("searchLibrary", () => {
	it("needs every word, and ranks tag and name matches over summary ones", () => {
		expect(names(searchLibrary(index, { text: "synth" }))).toEqual([
			"music/neon-drive",
			"music/slow-tide",
		]);
		expect(names(searchLibrary(index, { text: "synth drop" }))).toEqual([
			"music/neon-drive",
		]);
		expect(names(searchLibrary(index, { text: "whoo" }))).toEqual([
			"sfx/whoosh-short",
		]);
	});

	it("filters on kind, tags and facets", () => {
		expect(names(searchLibrary(index, { kind: "music", minBpm: 100 }))).toEqual(
			["music/neon-drive"],
		);
		expect(names(searchLibrary(index, { maxDuration: 1 }))).toEqual([
			"sfx/whoosh-short",
		]);
		expect(names(searchLibrary(index, { loop: true }))).toEqual([
			"music/slow-tide",
		]);
		expect(
			names(searchLibrary(index, { tags: ["SYNTH"], commercial: true })),
		).toEqual(["music/neon-drive"]);
		expect(names(searchLibrary(index, { kind: ["component", "sfx"] }))).toEqual(
			["counter", "sfx/whoosh-short"],
		);
	});

	it("counts results per kind with the kind filter lifted", () => {
		expect(countByKind(index, { text: "synth", kind: "sfx" })).toEqual({
			music: 2,
		});
	});
});
