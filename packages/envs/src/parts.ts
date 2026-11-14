/**
 * Fan-out: a seed range split into parts, one per worker (a local process,
 * a GPU, a cloud job). A part renders a contiguous slice of the seeds into
 * shards of its own (`shard-p002of008-000000.tar`) and a manifest
 * (`part-p002of008.json`); `mergeParts` checks every part arrived exactly
 * once before the dataset card is written. Seeds alone decide the bytes, so
 * a part can be re-run anywhere and come out the same.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Part {
	/** 0-based. */
	index: number;
	count: number;
}

/** `"2/8"` (0-based index / count). */
export function parsePart(spec: string): Part {
	const m = /^(\d+)\/(\d+)$/.exec(spec);
	const index = Number(m?.[1]);
	const count = Number(m?.[2]);
	if (!m || count < 1 || index >= count)
		throw new Error(
			`--part: <index>/<count> with index < count, got "${spec}"`,
		);
	return { index, count };
}

/** The part's contiguous slice of `seeds` (sizes differ by at most one). */
export function partSeeds(seeds: number[], part: Part): number[] {
	const start = Math.floor((seeds.length * part.index) / part.count);
	const end = Math.floor((seeds.length * (part.index + 1)) / part.count);
	return seeds.slice(start, end);
}

/** `p002of008`: in shard and manifest names, sorting in part order. */
export function partTag(part: Part): string {
	const w = Math.max(3, String(part.count).length);
	return `p${String(part.index).padStart(w, "0")}of${String(part.count).padStart(w, "0")}`;
}

/** What a part writes beside its shards. */
export interface PartManifest {
	env: string;
	part: Part;
	seeds: number[];
	samples: number;
	shards: string[];
}

export function manifestName(part: Part): string {
	return `part-${partTag(part)}.json`;
}

/**
 * Every part manifest in `dir`, checked: one env, one part count, each part
 * exactly once, no seed in two parts. Returns the totals.
 */
export function mergeParts(dir: string): {
	env: string;
	seeds: number[];
	samples: number;
	shards: string[];
	parts: number;
} {
	const manifests = readdirSync(dir)
		.filter((f) => /^part-p\d+of\d+\.json$/.test(f))
		.sort()
		.map(
			(f) =>
				JSON.parse(readFileSync(path.join(dir, f), "utf8")) as PartManifest,
		);
	if (manifests.length === 0) throw new Error(`no part manifests in ${dir}`);
	const [first] = manifests;
	const count = first.part.count;
	const seen = new Set<number>();
	const seeds: number[] = [];
	for (const m of manifests) {
		if (m.env !== first.env || m.part.count !== count)
			throw new Error(
				`${manifestName(m.part)} is env ${m.env} in ${m.part.count} parts; ${manifestName(first.part)} is env ${first.env} in ${count}.`,
			);
		for (const s of m.seeds) {
			if (seen.has(s)) throw new Error(`seed ${s} is in two parts`);
			seen.add(s);
			seeds.push(s);
		}
	}
	const indices = new Set(manifests.map((m) => m.part.index));
	const missing = Array.from({ length: count }, (_, i) => i).filter(
		(i) => !indices.has(i),
	);
	if (missing.length)
		throw new Error(
			`missing parts ${missing.map((i) => `${i}/${count}`).join(", ")}`,
		);
	return {
		env: first.env,
		seeds,
		samples: manifests.reduce((n, m) => n + m.samples, 0),
		shards: manifests.flatMap((m) => m.shards),
		parts: count,
	};
}
