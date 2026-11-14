/**
 * Fan-out parts: slices cover the seeds once, in order; merging finds a
 * missing part, a seed in two parts, and a part of another run.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	manifestName,
	mergeParts,
	type PartManifest,
	parsePart,
	partSeeds,
	partTag,
} from "./parts.js";

describe("parts", () => {
	it("slices seeds into contiguous parts that cover them once", () => {
		const seeds = Array.from({ length: 10 }, (_, i) => i + 100);
		const parts = [0, 1, 2].map((index) =>
			partSeeds(seeds, { index, count: 3 }),
		);
		expect(parts.flat()).toEqual(seeds);
		expect(parts.map((p) => p.length)).toEqual([3, 3, 4]);
		expect(partSeeds([1, 2], { index: 3, count: 4 })).toEqual([2]);
		expect(partTag({ index: 2, count: 8 })).toBe("p002of008");
		expect(parsePart("2/8")).toEqual({ index: 2, count: 8 });
		expect(() => parsePart("8/8")).toThrow("index < count");
	});

	let dir = "";
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const write = (m: PartManifest) =>
		writeFileSync(path.join(dir, manifestName(m.part)), JSON.stringify(m));
	const manifest = (index: number, seeds: number[]): PartManifest => ({
		env: "falling",
		part: { index, count: 2 },
		seeds,
		samples: seeds.length * 3,
		shards: [`shard-${partTag({ index, count: 2 })}-000000.tar`],
	});

	it("merges complete parts and names what is wrong", () => {
		dir = mkdtempSync(path.join(os.tmpdir(), "envs-parts-"));
		write(manifest(1, [2, 3]));
		expect(() => mergeParts(dir)).toThrow("missing parts 0/2");
		write(manifest(0, [0, 1]));
		expect(mergeParts(dir)).toEqual({
			env: "falling",
			seeds: [0, 1, 2, 3],
			samples: 12,
			shards: ["shard-p000of002-000000.tar", "shard-p001of002-000000.tar"],
			parts: 2,
		});
		write(manifest(0, [0, 2]));
		expect(() => mergeParts(dir)).toThrow("seed 2 is in two parts");
		write({ ...manifest(0, [0, 1]), env: "scenes" });
		expect(() => mergeParts(dir)).toThrow("env scenes");
	});
});
