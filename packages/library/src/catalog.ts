/**
 * The curated catalog: one JSON file per media item under
 * `catalog/<kind>/<slug>.json`. The folder is the kind and the path is the
 * item's name (`hdri/studio-small-09`); the file says what it is, under
 * what license, and where its bytes come from: a pinned download, or a
 * synth recipe the build renders itself.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CODE_KINDS,
	isItemName,
	isLibraryKind,
	type LibraryKind,
	type LibraryLicense,
} from "framefields/library";
import type { SynthRecipe } from "./synth.js";

export interface CatalogSource {
	/** Where the original file downloads from. */
	url: string;
	/** Pinned on first download (`pnpm library --pin` writes it back). */
	sha256?: string;
	size?: number;
	/** The file's extension, e.g. `hdr`, `mp3`. */
	ext: string;
}

export interface CatalogEntry {
	name: string;
	kind: LibraryKind;
	title: string;
	summary: string;
	tags: string[];
	/** Bumped by hand when the item's bytes or text change. */
	version: number;
	license: LibraryLicense;
	source?: CatalogSource;
	synth?: SynthRecipe;
	/** Plays seamlessly on repeat. */
	loop?: boolean;
	/** The catalog file it was read from, for messages and `--pin`. */
	file: string;
}

function fail(file: string, message: string): never {
	throw new Error(`${file}: ${message}`);
}

/** Validates one catalog file's content. */
export function parseEntry(
	file: string,
	kind: string,
	slug: string,
	raw: unknown,
): CatalogEntry {
	if (!isLibraryKind(kind) || CODE_KINDS.has(kind))
		fail(
			file,
			`"${kind}" is not a media kind (code comes from the component registry)`,
		);
	const name = `${kind}/${slug}`;
	if (!isItemName(name))
		fail(file, `"${slug}" is not a valid item name (a-z, 0-9, -)`);
	if (typeof raw !== "object" || raw === null) fail(file, "must be an object");
	const e = raw as Record<string, unknown>;
	const text = (key: string, max: number) => {
		const v = e[key];
		if (typeof v !== "string" || v.length === 0 || v.length > max)
			fail(file, `"${key}" must be text of at most ${max} characters`);
		return v;
	};
	const tags = e.tags;
	if (
		!Array.isArray(tags) ||
		!tags.every((t) => typeof t === "string" && /^[a-z0-9-]+$/.test(t))
	)
		fail(file, '"tags" must be lowercase words, e.g. ["studio", "soft-light"]');
	if (!Number.isSafeInteger(e.version) || (e.version as number) < 1)
		fail(file, '"version" must be a whole number from 1');
	const license = e.license as LibraryLicense | undefined;
	if (
		!license ||
		typeof license.id !== "string" ||
		typeof license.commercial !== "boolean"
	)
		fail(file, '"license" needs "id" and "commercial"');
	if ((e.source === undefined) === (e.synth === undefined))
		fail(
			file,
			'needs exactly one of "source" (a download) or "synth" (a recipe)',
		);
	const source = e.source as CatalogSource | undefined;
	if (
		source &&
		(typeof source.url !== "string" ||
			!/^https:\/\//.test(source.url) ||
			!/^[a-z0-9]+$/.test(source.ext))
	)
		fail(file, '"source" needs an https "url" and an "ext"');
	if (source?.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(source.sha256))
		fail(file, '"source.sha256" must be 64 hex digits');
	return {
		name,
		kind,
		title: text("title", 80),
		summary: text("summary", 200),
		tags: tags as string[],
		version: e.version as number,
		license,
		...(source && { source }),
		...(e.synth !== undefined && { synth: e.synth as SynthRecipe }),
		...(e.loop === true && { loop: true }),
		file,
	};
}

/** Every entry under `dir` (`<kind>/<slug>.json`), sorted by name. */
export function readCatalog(dir: string): CatalogEntry[] {
	const entries: CatalogEntry[] = [];
	for (const kind of readdirSync(dir, { withFileTypes: true })) {
		if (!kind.isDirectory()) continue;
		for (const f of readdirSync(join(dir, kind.name))) {
			if (!f.endsWith(".json")) continue;
			const file = join(dir, kind.name, f);
			entries.push(
				parseEntry(
					file,
					kind.name,
					f.slice(0, -5),
					JSON.parse(readFileSync(file, "utf8")),
				),
			);
		}
	}
	return entries.sort((a, b) => a.name.localeCompare(b.name));
}
