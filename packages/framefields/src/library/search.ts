/**
 * Search over a library index, the same in the CLI, the desktop app and
 * anything else holding `index.json`: every word must match somewhere
 * (name, title, tags, summary), and the facets narrow the rest.
 */
import type { RegistryEntry } from "./registry.js";
import type { LibraryKind } from "./types.js";

export interface LibraryQuery {
	/** Words, all of which must match: `upbeat synth`. */
	text?: string;
	/** One kind or several. */
	kind?: LibraryKind | readonly LibraryKind[];
	/** Tags every result has. */
	tags?: readonly string[];
	/** Seconds. Items without a duration don't pass a duration filter. */
	minDuration?: number;
	maxDuration?: number;
	minBpm?: number;
	maxBpm?: number;
	loop?: boolean;
	alpha?: boolean;
	/** Only items licensed for commercial work. */
	commercial?: boolean;
}

const words = (text: string) =>
	text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/** How well `word` matches the entry; 0 is no match. */
function wordScore(entry: RegistryEntry, word: string): number {
	const tags = entry.tags.map((t) => t.toLowerCase());
	if (tags.includes(word)) return 4;
	const name = words(`${entry.name} ${entry.title} ${entry.label ?? ""}`);
	if (name.includes(word)) return 3;
	if (tags.some((t) => t.startsWith(word))) return 2;
	if (name.some((n) => n.startsWith(word))) return 2;
	return words(entry.summary).some((s) => s.startsWith(word)) ? 1 : 0;
}

const within = (value: number | undefined, min?: number, max?: number) =>
	(min === undefined && max === undefined) ||
	(value !== undefined &&
		(min === undefined || value >= min) &&
		(max === undefined || value <= max));

/** Whether `entry` passes every facet in `query` (text aside). */
export function matchesFacets(
	entry: RegistryEntry,
	query: LibraryQuery,
): boolean {
	const kinds =
		query.kind === undefined
			? undefined
			: typeof query.kind === "string"
				? [query.kind]
				: query.kind;
	const facets = entry.facets ?? {};
	return (
		(!kinds ||
			kinds.length === 0 ||
			kinds.includes(entry.kind ?? "component")) &&
		(query.tags ?? []).every((t) =>
			entry.tags.some((e) => e.toLowerCase() === t.toLowerCase()),
		) &&
		within(facets.duration, query.minDuration, query.maxDuration) &&
		within(facets.bpm, query.minBpm, query.maxBpm) &&
		(query.loop === undefined || (facets.loop ?? false) === query.loop) &&
		(query.alpha === undefined || (facets.alpha ?? false) === query.alpha) &&
		(!query.commercial || entry.license?.commercial === true)
	);
}

/** The entries that match, best first (alphabetical without words). */
export function searchLibrary<E extends RegistryEntry>(
	entries: readonly E[],
	query: LibraryQuery = {},
): E[] {
	const wanted = words(query.text ?? "");
	const scored: Array<{ entry: E; score: number }> = [];
	for (const entry of entries) {
		if (!matchesFacets(entry, query)) continue;
		let score = 0;
		let all = true;
		for (const word of wanted) {
			const s = wordScore(entry, word);
			if (s === 0) {
				all = false;
				break;
			}
			score += s;
		}
		if (all) scored.push({ entry, score });
	}
	return scored
		.sort(
			(a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name),
		)
		.map((s) => s.entry);
}

/** How many entries of each kind match `query` with its kind filter lifted: the category counts. */
export function countByKind(
	entries: readonly RegistryEntry[],
	query: LibraryQuery = {},
): Partial<Record<LibraryKind, number>> {
	const counts: Partial<Record<LibraryKind, number>> = {};
	for (const e of searchLibrary(entries, { ...query, kind: undefined })) {
		const kind = e.kind ?? "component";
		counts[kind] = (counts[kind] ?? 0) + 1;
	}
	return counts;
}
