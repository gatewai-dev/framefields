/**
 * `framefields library [words…]`: search the library on framefields.dev
 * (music, SFX, HDRIs, backgrounds, templates, shaders, VFX …). Plain
 * components aren't listed here: `framefields list` has them.
 * `framefields add <name>` installs what it finds.
 */
import type { Registry, RegistryEntry } from "../library/registry.js";
import { type LibraryQuery, searchLibrary } from "../library/search.js";
import {
	isLibraryKind,
	KIND_LABELS,
	LIBRARY_KINDS,
	type LibraryKind,
} from "../library/types.js";

export interface LibraryFlags {
	kind?: string[];
	tag?: string[];
	"min-duration"?: string;
	"max-duration"?: string;
	bpm?: string;
	loop?: boolean;
	commercial?: boolean;
	json?: boolean;
}

/** The flags as a query; throws on a value that can't be one. */
export function libraryQuery(
	words: string[],
	flags: LibraryFlags,
): LibraryQuery {
	const kinds = (flags.kind ?? []).flatMap((k) => k.split(","));
	for (const k of kinds)
		if (!isLibraryKind(k))
			throw new Error(
				`Unknown kind "${k}". Kinds: ${LIBRARY_KINDS.join(", ")}.`,
			);
	const seconds = (flag: "min-duration" | "max-duration") => {
		const value = flags[flag];
		if (value === undefined) return undefined;
		const n = Number(value);
		if (!Number.isFinite(n) || n < 0)
			throw new Error(`--${flag} takes seconds, e.g. --${flag} 30`);
		return n;
	};
	const bpm = flags.bpm?.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/);
	if (flags.bpm !== undefined && !bpm)
		throw new Error(
			"--bpm takes a tempo or a range, e.g. --bpm 120 or --bpm 110-130",
		);
	const query: LibraryQuery = {
		text: words.join(" "),
		kind: kinds as LibraryKind[],
		tags: flags.tag,
		minDuration: seconds("min-duration"),
		maxDuration: seconds("max-duration"),
		loop: flags.loop,
		commercial: flags.commercial,
	};
	if (bpm) {
		query.minBpm = Number(bpm[1]);
		query.maxBpm = Number(bpm[2] ?? bpm[1]);
	}
	return query;
}

/** One line per result: name, kind, what it is, and its facets. */
export function formatEntries(entries: readonly RegistryEntry[]): string[] {
	const width = Math.min(40, Math.max(0, ...entries.map((e) => e.name.length)));
	return entries.map((e) => {
		const kind = KIND_LABELS[e.kind ?? "component"];
		const facts = [
			e.facets?.duration !== undefined && `${e.facets.duration.toFixed(1)} s`,
			e.facets?.bpm !== undefined && `${Math.round(e.facets.bpm)} bpm`,
			e.facets?.loop && "loops",
			e.license?.id,
		].filter(Boolean);
		const tail = facts.length > 0 ? ` (${facts.join(", ")})` : "";
		return `${e.name.padEnd(width)}  ${kind.padEnd(11)}  ${e.summary}${tail}`;
	});
}

export async function runLibrary(
	words: string[],
	flags: LibraryFlags,
	registry: Registry,
	log: (line: string) => void,
): Promise<number> {
	let query: LibraryQuery;
	try {
		query = libraryQuery(words, flags);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n`);
		return 1;
	}
	let index: RegistryEntry[];
	try {
		index = await registry.index();
	} catch (err) {
		process.stderr.write(
			`Can't read the library at ${registry.source}: ${(err as Error).message}\n`,
		);
		return 1;
	}
	const found = searchLibrary(index, query);
	if (flags.json) {
		log(
			JSON.stringify({
				schemaVersion: 1,
				source: registry.source,
				items: found,
			}),
		);
		return 0;
	}
	if (found.length === 0) {
		log("Nothing in the library matches.");
		return 0;
	}
	for (const line of formatEntries(found)) log(line);
	log(`\nAdd one with \`framefields add ${found[0]?.name}\`.`);
	return 0;
}
